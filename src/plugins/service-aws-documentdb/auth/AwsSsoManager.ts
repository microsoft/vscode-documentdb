/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    GetRoleCredentialsCommand,
    paginateListAccountRoles,
    paginateListAccounts,
    SSOClient,
} from '@aws-sdk/client-sso';
import {
    CreateTokenCommand,
    RegisterClientCommand,
    SSOOIDCClient,
    StartDeviceAuthorizationCommand,
} from '@aws-sdk/client-sso-oidc';
import { type AwsCredentialIdentity } from '@aws-sdk/types';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { type AwsSsoSecrets } from '../credentials/awsCredentialStore';
import { type AwsSsoAccount, type AwsSsoPoll, type AwsSsoStart } from '../types';
import { abortError, AwsInteractionRequiredError, AwsValidationError, errorName, throwIfAborted } from './errors';

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const SKEW_MS = 60_000;

interface SsoFlow {
    startUrl: string;
    region: string;
    controller: AbortController;
    cleanup: () => void;
    timer?: ReturnType<typeof setTimeout>;
    clientId?: string;
    clientSecret?: string;
    clientSecretExpiresAt?: number;
    deviceCode?: string;
    deadline: number;
    intervalSeconds: number;
    nextPollAt: number;
    polling: boolean;
    secrets?: AwsSsoSecrets;
    accounts?: AwsSsoAccount[];
}

export interface StagedSso {
    startUrl: string;
    region: string;
    secrets: AwsSsoSecrets;
    assertCurrent: () => void;
}

export class AwsSsoManager {
    private readonly flows = new Map<string, SsoFlow>();

    private flow(id: string): SsoFlow {
        const flow = this.flows.get(id);
        if (!flow || flow.controller.signal.aborted || Date.now() >= flow.deadline) {
            this.cancel(id);
            throw new AwsInteractionRequiredError();
        }
        return flow;
    }

    private assertCurrent(id: string, flow: SsoFlow): void {
        throwIfAborted(flow.controller.signal);
        if (this.flow(id) !== flow) {
            throw abortError();
        }
    }

    private async withSignal<T>(
        flow: SsoFlow,
        signal: AbortSignal | undefined,
        operation: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
        throwIfAborted(signal);
        const controller = new AbortController();
        const abort = (): void => controller.abort();
        flow.controller.signal.addEventListener('abort', abort, { once: true });
        signal?.addEventListener('abort', abort, { once: true });
        try {
            throwIfAborted(flow.controller.signal);
            return await operation(controller.signal);
        } finally {
            flow.controller.signal.removeEventListener('abort', abort);
            signal?.removeEventListener('abort', abort);
        }
    }

    public async begin(startUrl: string, region: string, signal?: AbortSignal): Promise<AwsSsoStart> {
        throwIfAborted(signal);
        let url: URL;
        try {
            url = new URL(startUrl);
        } catch {
            throw new AwsValidationError(vscode.l10n.t('Enter a valid HTTPS AWS SSO start URL.'));
        }
        if (url.protocol !== 'https:' || url.username || url.password || !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region)) {
            throw new AwsValidationError(vscode.l10n.t('Enter a valid HTTPS AWS SSO start URL and AWS region.'));
        }
        if (this.flows.size >= 20) {
            throw new AwsValidationError(
                vscode.l10n.t('Too many AWS sign-ins are pending. Cancel an existing sign-in and retry.'),
            );
        }
        const id = randomUUID();
        const controller = new AbortController();
        const onAbort = (): void => this.cancel(id);
        signal?.addEventListener('abort', onAbort, { once: true });
        const flow: SsoFlow = {
            startUrl: url.href,
            region,
            controller,
            cleanup: (): void => signal?.removeEventListener('abort', onAbort),
            deadline: Date.now() + 10 * 60_000,
            intervalSeconds: 5,
            nextPollAt: 0,
            polling: false,
        };
        this.flows.set(id, flow);
        flow.timer = setTimeout(() => this.cancel(id), 10 * 60_000);
        flow.timer.unref();
        const client = new SSOOIDCClient({ region, maxAttempts: 2 });
        try {
            const registration = await client.send(
                new RegisterClientCommand({
                    clientName: 'vscode-documentdb',
                    clientType: 'public',
                    scopes: ['sso:account:access'],
                    grantTypes: [DEVICE_GRANT, 'refresh_token'],
                }),
                { abortSignal: controller.signal },
            );
            this.assertCurrent(id, flow);
            if (!registration.clientId || !registration.clientSecret || !registration.clientSecretExpiresAt) {
                throw new AwsInteractionRequiredError();
            }
            flow.clientId = registration.clientId;
            flow.clientSecret = registration.clientSecret;
            flow.clientSecretExpiresAt = registration.clientSecretExpiresAt * 1000;
            const authorization = await client.send(
                new StartDeviceAuthorizationCommand({
                    clientId: registration.clientId,
                    clientSecret: registration.clientSecret,
                    startUrl: flow.startUrl,
                }),
                { abortSignal: controller.signal },
            );
            this.assertCurrent(id, flow);
            const verificationUri = authorization.verificationUriComplete ?? authorization.verificationUri;
            if (!authorization.deviceCode || !authorization.userCode || !verificationUri) {
                throw new AwsInteractionRequiredError();
            }
            flow.deviceCode = authorization.deviceCode;
            flow.intervalSeconds = Math.max(authorization.interval ?? 5, 1);
            flow.deadline = Date.now() + (authorization.expiresIn ?? 600) * 1000;
            flow.nextPollAt = Date.now() + flow.intervalSeconds * 1000;
            clearTimeout(flow.timer);
            flow.timer = setTimeout(() => this.cancel(id), Math.max(0, flow.deadline - Date.now()));
            flow.timer.unref();
            return {
                flowId: id,
                verificationUri,
                userCode: authorization.userCode,
                intervalSeconds: flow.intervalSeconds,
            };
        } catch (error) {
            this.cancel(id);
            throw error;
        } finally {
            client.destroy();
        }
    }

    public async poll(id: string, signal?: AbortSignal): Promise<AwsSsoPoll> {
        throwIfAborted(signal);
        const flow = this.flow(id);
        if (flow.accounts) {
            return { status: 'authorized', accounts: flow.accounts.map((account) => ({ ...account })) };
        }
        if (flow.polling || (!flow.secrets && Date.now() < flow.nextPollAt)) {
            return { status: 'pending' };
        }
        flow.polling = true;
        try {
            return await this.withSignal(flow, signal, async (abortSignal): Promise<AwsSsoPoll> => {
                if (!flow.secrets) {
                    const client = new SSOOIDCClient({ region: flow.region, maxAttempts: 1 });
                    try {
                        const token = await client.send(
                            new CreateTokenCommand({
                                clientId: flow.clientId,
                                clientSecret: flow.clientSecret,
                                deviceCode: flow.deviceCode,
                                grantType: DEVICE_GRANT,
                            }),
                            { abortSignal },
                        );
                        this.assertCurrent(id, flow);
                        throwIfAborted(abortSignal);
                        if (!token.accessToken || !flow.clientId || !flow.clientSecret || !flow.clientSecretExpiresAt) {
                            throw new AwsInteractionRequiredError();
                        }
                        flow.secrets = {
                            kind: 'sso',
                            clientId: flow.clientId,
                            clientSecret: flow.clientSecret,
                            clientSecretExpiresAt: flow.clientSecretExpiresAt,
                            accessToken: token.accessToken,
                            accessTokenExpiresAt: Date.now() + (token.expiresIn ?? 3600) * 1000,
                            refreshToken: token.refreshToken,
                        };
                        flow.deviceCode = undefined;
                        flow.deadline = Math.min(flow.secrets.accessTokenExpiresAt, Date.now() + 30 * 60_000);
                        clearTimeout(flow.timer);
                        flow.timer = setTimeout(() => this.cancel(id), Math.max(0, flow.deadline - Date.now()));
                        flow.timer.unref();
                    } catch (error) {
                        this.assertCurrent(id, flow);
                        throwIfAborted(abortSignal);
                        if (
                            errorName(error) === 'AuthorizationPendingException' ||
                            errorName(error) === 'SlowDownException'
                        ) {
                            if (errorName(error) === 'SlowDownException') {
                                flow.intervalSeconds += 5;
                            }
                            flow.nextPollAt = Date.now() + flow.intervalSeconds * 1000;
                            return { status: 'pending' };
                        }
                        throw error;
                    } finally {
                        client.destroy();
                    }
                }
                const client = new SSOClient({ region: flow.region, maxAttempts: 2 });
                try {
                    const accounts: AwsSsoAccount[] = [];
                    for await (const page of paginateListAccounts(
                        { client, stopOnSameToken: true },
                        { accessToken: flow.secrets.accessToken },
                        { abortSignal },
                    )) {
                        this.assertCurrent(id, flow);
                        throwIfAborted(abortSignal);
                        for (const account of page.accountList ?? []) {
                            if (account.accountId) {
                                accounts.push({
                                    accountId: account.accountId,
                                    accountName: account.accountName ?? account.accountId,
                                });
                            }
                        }
                    }
                    flow.accounts = accounts;
                    return { status: 'authorized', accounts: accounts.map((account) => ({ ...account })) };
                } finally {
                    client.destroy();
                }
            });
        } finally {
            flow.polling = false;
        }
    }

    public async roles(id: string, accountId: string, signal?: AbortSignal): Promise<string[]> {
        const flow = this.flow(id);
        if (!flow.secrets || !flow.accounts?.some((account) => account.accountId === accountId)) {
            throw new AwsInteractionRequiredError();
        }
        const accessToken = flow.secrets.accessToken;
        return this.withSignal(flow, signal, async (abortSignal): Promise<string[]> => {
            const client = new SSOClient({ region: flow.region, maxAttempts: 2 });
            try {
                const roles = new Set<string>();
                for await (const page of paginateListAccountRoles(
                    { client, stopOnSameToken: true },
                    { accountId, accessToken },
                    { abortSignal },
                )) {
                    this.assertCurrent(id, flow);
                    throwIfAborted(abortSignal);
                    for (const role of page.roleList ?? []) {
                        if (role.roleName) {
                            roles.add(role.roleName);
                        }
                    }
                }
                return [...roles].sort();
            } finally {
                client.destroy();
            }
        });
    }

    public staged(id: string, accountId: string): StagedSso {
        const flow = this.flow(id);
        if (!flow.secrets || !flow.accounts?.some((account) => account.accountId === accountId)) {
            throw new AwsInteractionRequiredError();
        }
        return {
            region: flow.region,
            startUrl: flow.startUrl,
            secrets: { ...flow.secrets },
            assertCurrent: (): void => this.assertCurrent(id, flow),
        };
    }

    public cancel(id: string): void {
        const flow = this.flows.get(id);
        if (flow) {
            this.flows.delete(id);
            flow.controller.abort();
            flow.cleanup();
            clearTimeout(flow.timer);
            flow.secrets = undefined;
            flow.deviceCode = undefined;
            flow.clientSecret = undefined;
        }
    }

    public dispose(): void {
        for (const id of this.flows.keys()) {
            this.cancel(id);
        }
    }
}

export async function resolveSsoCredentials(
    stored: AwsSsoSecrets,
    region: string,
    accountId: string,
    roleName: string,
    signal?: AbortSignal,
): Promise<{ credentials: AwsCredentialIdentity; secrets: AwsSsoSecrets }> {
    throwIfAborted(signal);
    let secrets = { ...stored };
    if (secrets.accessTokenExpiresAt - Date.now() < SKEW_MS) {
        if (!secrets.refreshToken || secrets.clientSecretExpiresAt <= Date.now()) {
            throw new AwsInteractionRequiredError();
        }
        const oidc = new SSOOIDCClient({ region, maxAttempts: 2 });
        try {
            const response = await oidc.send(
                new CreateTokenCommand({
                    clientId: secrets.clientId,
                    clientSecret: secrets.clientSecret,
                    refreshToken: secrets.refreshToken,
                    grantType: 'refresh_token',
                }),
                { abortSignal: signal },
            );
            throwIfAborted(signal);
            if (!response.accessToken) {
                throw new AwsInteractionRequiredError();
            }
            secrets = {
                ...secrets,
                accessToken: response.accessToken,
                accessTokenExpiresAt: Date.now() + (response.expiresIn ?? 3600) * 1000,
                refreshToken: response.refreshToken ?? secrets.refreshToken,
            };
        } finally {
            oidc.destroy();
        }
    }
    const client = new SSOClient({ region, maxAttempts: 2 });
    try {
        const response = await client.send(
            new GetRoleCredentialsCommand({
                accessToken: secrets.accessToken,
                accountId,
                roleName,
            }),
            { abortSignal: signal },
        );
        throwIfAborted(signal);
        const role = response.roleCredentials;
        if (
            !role?.accessKeyId ||
            !role.secretAccessKey ||
            !role.sessionToken ||
            !role.expiration ||
            role.expiration <= Date.now()
        ) {
            throw new AwsInteractionRequiredError();
        }
        return {
            credentials: {
                accessKeyId: role.accessKeyId,
                secretAccessKey: role.secretAccessKey,
                sessionToken: role.sessionToken,
                expiration: new Date(role.expiration),
            },
            secrets,
        };
    } finally {
        client.destroy();
    }
}
