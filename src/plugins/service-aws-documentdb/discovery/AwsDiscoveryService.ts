/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AwsCredentialIdentity } from '@aws-sdk/types';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { nonNullValue } from '../../../utils/nonNull';
import { discoverRegion, verifyIdentity } from '../api/documentDb';
import { AwsSsoManager, resolveSsoCredentials, type StagedSso } from '../auth/AwsSsoManager';
import {
    abortable,
    abortError,
    AwsInteractionRequiredError,
    AwsValidationError,
    errorName,
    failureKind,
    safeAwsError,
    throwIfAborted,
} from '../auth/errors';
import { listAwsProfiles, profileProvider } from '../auth/profiles';
import { AwsCredentialStore, type AwsCredentialSecrets, type AwsKeySecrets } from '../credentials/awsCredentialStore';
import {
    type AwsCluster,
    type AwsCredentialInput,
    type AwsCredentialRecord,
    type AwsDiscoveryFailure,
    type AwsDiscoverySnapshot,
    type AwsProfile,
    type AwsSsoPoll,
    type AwsSsoStart,
} from '../types';

export { AwsInteractionRequiredError } from '../auth/errors';

export interface AwsDiscoveryDependencies {
    store?: AwsCredentialStore;
    sso?: AwsSsoManager;
    verifyIdentity?: typeof verifyIdentity;
    discoverRegion?: typeof discoverRegion;
    profileProvider?: typeof profileProvider;
    listProfiles?: typeof listAwsProfiles;
    resolveSsoCredentials?: typeof resolveSsoCredentials;
}

interface CachedIdentity {
    identity: AwsCredentialIdentity;
    cachedAt: number;
}

interface Refresh {
    controller: AbortController;
    promise: Promise<AwsCredentialIdentity>;
}

function cloneSnapshot(snapshot: AwsDiscoverySnapshot): AwsDiscoverySnapshot {
    return {
        clusters: snapshot.clusters.map((cluster) => ({ ...cluster })),
        errors: snapshot.errors.map((error) => ({ ...error })),
    };
}

async function bounded<T, R>(items: T[], operation: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = [];
    let next = 0;
    const worker = async (): Promise<void> => {
        while (next < items.length) {
            const index = next++;
            results[index] = await operation(items[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
    return results;
}

function keyIdentity(secrets: AwsKeySecrets): AwsCredentialIdentity {
    if (secrets.expiresAt !== undefined && secrets.expiresAt <= Date.now()) {
        throw new AwsInteractionRequiredError();
    }
    return {
        accessKeyId: secrets.accessKeyId,
        secretAccessKey: secrets.secretAccessKey,
        sessionToken: secrets.sessionToken,
        expiration: secrets.expiresAt === undefined ? undefined : new Date(secrets.expiresAt),
    };
}

function validateInput(input: AwsCredentialInput): void {
    if (
        !['profile', 'accessKey', 'sso', 'temporary'].includes(input.authMethod) ||
        !Array.isArray(input.regions) ||
        input.regions.length === 0 ||
        input.regions.length > 50 ||
        input.regions.some((region) => !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region))
    ) {
        throw new AwsValidationError(vscode.l10n.t('Choose an AWS sign-in method and at least one valid region.'));
    }
    if (input.label && input.label.length > 200) {
        throw new AwsValidationError(vscode.l10n.t('The credential label must be 200 characters or fewer.'));
    }
    if (input.authMethod === 'profile' && !input.profile?.trim()) {
        throw new AwsValidationError(vscode.l10n.t('Select an AWS profile.'));
    }
    if (
        (input.authMethod === 'accessKey' || input.authMethod === 'temporary') &&
        (!input.accessKeyId?.trim() || !input.secretAccessKey?.trim())
    ) {
        throw new AwsValidationError(vscode.l10n.t('Enter the AWS access key ID and secret access key.'));
    }
    if (input.authMethod === 'temporary' && !input.sessionToken?.trim()) {
        throw new AwsValidationError(vscode.l10n.t('Enter the AWS session token for temporary credentials.'));
    }
    if (input.authMethod === 'accessKey' && input.sessionToken) {
        throw new AwsValidationError(vscode.l10n.t('Use Temporary credentials when providing an AWS session token.'));
    }
    if (
        input.expiration &&
        (!Number.isFinite(Date.parse(input.expiration)) || Date.parse(input.expiration) <= Date.now())
    ) {
        throw new AwsValidationError(vscode.l10n.t('Enter a valid future expiration time for the AWS credentials.'));
    }
    if (
        input.authMethod === 'sso' &&
        (!input.ssoFlowId || !/^\d{12}$/.test(input.accountId ?? '') || !input.roleName?.trim())
    ) {
        throw new AwsValidationError(vscode.l10n.t('Complete AWS SSO sign-in and select an account and role.'));
    }
}

export class AwsDiscoveryService {
    private readonly store: AwsCredentialStore;
    private readonly sso: AwsSsoManager;
    private readonly verify: typeof verifyIdentity;
    private readonly discover: typeof discoverRegion;
    private readonly profiles: typeof listAwsProfiles;
    private readonly provider: typeof profileProvider;
    private readonly resolveSso: typeof resolveSsoCredentials;
    private readonly generations = new Map<string, number>();
    private readonly identities = new Map<string, CachedIdentity>();
    private readonly refreshes = new Map<string, Refresh>();
    private readonly operations = new Set<AbortController>();
    private readonly scans = new Set<AbortController>();
    private snapshot?: { value: AwsDiscoverySnapshot; at: number };
    private revision = 0;
    private disposed = false;

    constructor(dependencies: AwsDiscoveryDependencies = {}) {
        this.store = dependencies.store ?? new AwsCredentialStore();
        this.sso = dependencies.sso ?? new AwsSsoManager();
        this.verify = dependencies.verifyIdentity ?? verifyIdentity;
        this.discover = dependencies.discoverRegion ?? discoverRegion;
        this.profiles = dependencies.listProfiles ?? listAwsProfiles;
        this.provider = dependencies.profileProvider ?? profileProvider;
        this.resolveSso = dependencies.resolveSsoCredentials ?? resolveSsoCredentials;
    }

    private ensureActive(): void {
        if (this.disposed) {
            throw abortError();
        }
    }

    private async operation<T>(
        signal: AbortSignal | undefined,
        run: (controller: AbortController) => Promise<T>,
    ): Promise<T> {
        this.ensureActive();
        throwIfAborted(signal);
        const controller = new AbortController();
        const abort = (): void => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        this.operations.add(controller);
        try {
            return await run(controller);
        } catch (error) {
            throw safeAwsError(error);
        } finally {
            signal?.removeEventListener('abort', abort);
            this.operations.delete(controller);
        }
    }

    private generation(id: string): number {
        return this.generations.get(id) ?? 0;
    }

    private assertCurrent(id: string, generation: number, signal?: AbortSignal): void {
        this.ensureActive();
        throwIfAborted(signal);
        if (this.generation(id) !== generation) {
            throw abortError();
        }
    }

    private invalidateSnapshot(): void {
        this.revision++;
        this.snapshot = undefined;
        for (const scan of this.scans) {
            scan.abort();
        }
    }

    public invalidate(id?: string): void {
        this.invalidateSnapshot();
        const ids = id
            ? [id]
            : new Set([...this.generations.keys(), ...this.identities.keys(), ...this.refreshes.keys()]);
        for (const entry of ids) {
            this.generations.set(entry, this.generation(entry) + 1);
            this.identities.delete(entry);
            this.refreshes.get(entry)?.controller.abort();
            this.refreshes.delete(entry);
        }
    }

    public async listCredentials(): Promise<AwsCredentialRecord[]> {
        return this.operation(undefined, async (): Promise<AwsCredentialRecord[]> => this.store.list());
    }

    public async listProfiles(): Promise<AwsProfile[]> {
        return this.operation(undefined, async (): Promise<AwsProfile[]> => this.profiles());
    }

    public async verifyAndSave(
        input: AwsCredentialInput,
        signal?: AbortSignal,
        credentialId?: string,
    ): Promise<AwsCredentialRecord> {
        return this.operation(signal, async (controller): Promise<AwsCredentialRecord> => {
            validateInput(input);
            const id = credentialId ?? randomUUID();
            const generation = this.generation(id);
            this.generations.set(id, generation);
            if (credentialId && !(await this.store.list()).some((record) => record.id === id)) {
                throw new AwsValidationError(
                    vscode.l10n.t('This AWS credential was removed. Add a new credential instead.'),
                );
            }
            const assertCurrent = (): void => this.assertCurrent(id, generation, controller.signal);
            assertCurrent();
            let identity: AwsCredentialIdentity;
            let secrets: AwsCredentialSecrets | undefined;
            let staged: StagedSso | undefined;
            switch (input.authMethod) {
                case 'profile':
                    identity = await abortable(
                        this.provider(
                            nonNullValue(input.profile, 'input.profile', 'AwsDiscoveryService.ts').trim(),
                            input.regions[0],
                            true,
                            controller.signal,
                        )(),
                        controller.signal,
                    );
                    break;
                case 'accessKey':
                case 'temporary':
                    secrets = {
                        kind: 'keys',
                        accessKeyId: nonNullValue(
                            input.accessKeyId,
                            'input.accessKeyId',
                            'AwsDiscoveryService.ts',
                        ).trim(),
                        secretAccessKey: nonNullValue(
                            input.secretAccessKey,
                            'input.secretAccessKey',
                            'AwsDiscoveryService.ts',
                        ).trim(),
                        sessionToken:
                            input.authMethod === 'temporary'
                                ? nonNullValue(
                                      input.sessionToken,
                                      'input.sessionToken',
                                      'AwsDiscoveryService.ts',
                                  ).trim()
                                : undefined,
                        expiresAt:
                            input.authMethod === 'temporary' && input.expiration
                                ? Date.parse(input.expiration)
                                : undefined,
                    };
                    identity = keyIdentity(secrets);
                    break;
                case 'sso': {
                    const flowId = nonNullValue(input.ssoFlowId, 'input.ssoFlowId', 'AwsDiscoveryService.ts');
                    const accountId = nonNullValue(input.accountId, 'input.accountId', 'AwsDiscoveryService.ts');
                    const roleName = nonNullValue(input.roleName, 'input.roleName', 'AwsDiscoveryService.ts');
                    staged = this.sso.staged(flowId, accountId);
                    const resolved = await this.resolveSso(
                        staged.secrets,
                        staged.region,
                        accountId,
                        roleName,
                        controller.signal,
                    );
                    identity = resolved.credentials;
                    secrets = resolved.secrets;
                    staged.assertCurrent();
                    break;
                }
            }
            assertCurrent();
            const verified = await this.verify(identity, input.regions[0], controller.signal);
            assertCurrent();
            if (input.authMethod === 'sso' && verified.accountId !== input.accountId) {
                throw new AwsValidationError(
                    vscode.l10n.t('The verified AWS identity does not match the selected SSO account.'),
                );
            }
            const record: AwsCredentialRecord = {
                id,
                label:
                    input.label?.trim() ||
                    (input.authMethod === 'profile' ? input.profile?.trim() : undefined) ||
                    vscode.l10n.t('AWS account {0}', verified.accountId),
                authMethod: input.authMethod,
                regions: [...new Set(input.regions)],
                accountId: verified.accountId,
                arn: verified.arn,
                profile: input.authMethod === 'profile' ? input.profile?.trim() : undefined,
                startUrl: staged?.startUrl,
                ssoRegion: staged?.region,
                roleName: input.authMethod === 'sso' ? input.roleName : undefined,
                expiresAt: identity.expiration?.getTime(),
            };
            await this.store.save(record, secrets, (): void => {
                assertCurrent();
                staged?.assertCurrent();
            });
            // Identity success is enough to accept an entry. Regional discovery reports permission
            // failures independently; an empty or wholly denied scan must not discard this identity.
            assertCurrent();
            this.invalidate(id);
            this.identities.set(id, { identity, cachedAt: Date.now() });
            if (input.ssoFlowId) {
                this.sso.cancel(input.ssoFlowId);
            }
            return { ...record, regions: [...record.regions] };
        });
    }

    private async credentials(record: AwsCredentialRecord, signal: AbortSignal): Promise<AwsCredentialIdentity> {
        const cached = this.identities.get(record.id);
        if (
            cached &&
            (cached.identity.expiration
                ? cached.identity.expiration.getTime() - Date.now() > 60_000
                : Date.now() - cached.cachedAt < 5 * 60_000)
        ) {
            return cached.identity;
        }
        let refresh = this.refreshes.get(record.id);
        if (!refresh) {
            const controller = new AbortController();
            const generation = this.generation(record.id);
            this.generations.set(record.id, generation);
            const assertCurrent = (): void => this.assertCurrent(record.id, generation, controller.signal);
            const resolve = async (): Promise<AwsCredentialIdentity> => {
                assertCurrent();
                let identity: AwsCredentialIdentity;
                if (record.authMethod === 'profile' && record.profile) {
                    identity = await abortable(
                        this.provider(record.profile, record.regions[0], false, controller.signal)(),
                        controller.signal,
                    );
                } else {
                    const secrets = await this.store.secrets(record.id);
                    assertCurrent();
                    if (secrets?.kind === 'keys') {
                        identity = keyIdentity(secrets);
                    } else if (secrets?.kind === 'sso' && record.ssoRegion && record.roleName) {
                        const resolved = await this.resolveSso(
                            secrets,
                            record.ssoRegion,
                            record.accountId,
                            record.roleName,
                            controller.signal,
                        );
                        assertCurrent();
                        identity = resolved.credentials;
                        if (
                            resolved.secrets.accessToken !== secrets.accessToken ||
                            resolved.secrets.accessTokenExpiresAt !== secrets.accessTokenExpiresAt ||
                            resolved.secrets.refreshToken !== secrets.refreshToken ||
                            identity.expiration?.getTime() !== record.expiresAt
                        ) {
                            await this.store.save(
                                { ...record, expiresAt: identity.expiration?.getTime() },
                                resolved.secrets,
                                assertCurrent,
                            );
                        }
                    } else {
                        throw new AwsInteractionRequiredError();
                    }
                }
                assertCurrent();
                this.identities.set(record.id, { identity, cachedAt: Date.now() });
                return identity;
            };
            const promise = resolve().finally((): void => {
                if (this.refreshes.get(record.id)?.controller === controller) {
                    this.refreshes.delete(record.id);
                }
            });
            refresh = { controller, promise };
            this.refreshes.set(record.id, refresh);
        }
        return abortable(refresh.promise, signal);
    }

    public async listAll(force = false, signal?: AbortSignal): Promise<AwsDiscoverySnapshot> {
        return this.operation(signal, async (controller): Promise<AwsDiscoverySnapshot> => {
            if (force) {
                this.invalidateSnapshot();
            }
            if (this.snapshot && Date.now() - this.snapshot.at < 60_000) {
                return cloneSnapshot(this.snapshot.value);
            }
            const revision = this.revision;
            this.scans.add(controller);
            const assertCurrent = (): void => {
                this.ensureActive();
                throwIfAborted(controller.signal);
                if (revision !== this.revision) {
                    throw abortError();
                }
            };
            try {
                const records = await this.store.list();
                assertCurrent();
                const errors: AwsDiscoveryFailure[] = [];
                const sessions = await bounded(
                    records,
                    async (
                        record,
                    ): Promise<{ record: AwsCredentialRecord; identity: AwsCredentialIdentity } | undefined> => {
                        assertCurrent();
                        try {
                            const identity = await this.credentials(record, controller.signal);
                            assertCurrent();
                            return { record, identity };
                        } catch (error) {
                            assertCurrent();
                            if (errorName(error) === 'AbortError') {
                                throw error;
                            }
                            errors.push({
                                credentialId: record.id,
                                kind: failureKind(error),
                                message: safeAwsError(error).message,
                            });
                            return undefined;
                        }
                    },
                );
                const jobs = sessions.flatMap((session) =>
                    session ? session.record.regions.map((region) => ({ ...session, region })) : [],
                );
                const regional = await bounded(jobs, async ({ record, identity, region }): Promise<AwsCluster[]> => {
                    assertCurrent();
                    try {
                        const clusters = await this.discover(record, identity, region, controller.signal);
                        assertCurrent();
                        return clusters;
                    } catch (error) {
                        assertCurrent();
                        if (errorName(error) === 'AbortError') {
                            throw error;
                        }
                        errors.push({
                            credentialId: record.id,
                            region,
                            kind: failureKind(error),
                            message: safeAwsError(error).message,
                        });
                        return [];
                    }
                });
                assertCurrent();
                const unique = new Map<string, AwsCluster>();
                for (const cluster of regional.flat()) {
                    if (!unique.has(cluster.arn)) {
                        unique.set(cluster.arn, cluster);
                    }
                }
                const snapshot = { clusters: [...unique.values()], errors };
                this.snapshot = { value: cloneSnapshot(snapshot), at: Date.now() };
                return snapshot;
            } finally {
                this.scans.delete(controller);
            }
        });
    }

    public async removeCredential(id: string): Promise<void> {
        this.invalidate(id);
        await this.operation(undefined, async (): Promise<void> => this.store.remove(id));
    }

    public async beginSso(startUrl: string, ssoRegion: string, signal?: AbortSignal): Promise<AwsSsoStart> {
        return this.operation(
            signal,
            async (controller): Promise<AwsSsoStart> => this.sso.begin(startUrl, ssoRegion, controller.signal),
        );
    }

    public async pollSso(flowId: string, signal?: AbortSignal): Promise<AwsSsoPoll> {
        return this.operation(
            signal,
            async (controller): Promise<AwsSsoPoll> => this.sso.poll(flowId, controller.signal),
        );
    }

    public async listSsoRoles(flowId: string, accountId: string, signal?: AbortSignal): Promise<string[]> {
        return this.operation(
            signal,
            async (controller): Promise<string[]> => this.sso.roles(flowId, accountId, controller.signal),
        );
    }

    public cancelSso(flowId: string): void {
        this.sso.cancel(flowId);
    }

    public dispose(): void {
        this.disposed = true;
        this.invalidate();
        for (const operation of this.operations) {
            operation.abort();
        }
        this.sso.dispose();
        this.store.dispose();
        this.generations.clear();
    }
}

export const awsDiscoveryService = new AwsDiscoveryService();
