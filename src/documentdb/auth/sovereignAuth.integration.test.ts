/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ITelemetryContext } from '@microsoft/vscode-azext-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { CredentialCache, type CachedClusterCredentials } from '../CredentialCache';
import { PlaygroundEvaluator } from '../playground/PlaygroundEvaluator';
import { type MainToWorkerMessage, type WorkerToMainMessage } from '../playground/workerTypes';
import { ShellSessionManager } from '../shell/ShellSessionManager';
import { AuthMethodId } from './AuthMethod';
import { resetEntraTokenFailuresForTests } from './entraErrors/entraTokenFailures';
import { ManagedIdentityAuthHandler } from './ManagedIdentityAuthHandler';
import { MicrosoftEntraIDAuthHandler } from './MicrosoftEntraIDAuthHandler';

const getSession = vi.hoisted(() => vi.fn());
const getManagedToken = vi.hoisted(() => vi.fn());
const postedMessages = vi.hoisted((): MainToWorkerMessage[] => []);
const events = vi.hoisted((): { eventName: string; telemetry: ITelemetryContext }[] => []);

vi.mock('../../extensionVariables', () => ({
    ext: {
        context: { extensionPath: '/extension-root' },
        outputChannel: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    },
}));

vi.mock('@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode', () => ({
    getSessionFromVSCode: getSession,
}));

vi.mock('./managedIdentityTokenProvider', () => ({ getManagedIdentityAccessToken: getManagedToken }));

vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@microsoft/vscode-azext-utils')>()),
    callWithTelemetryAndErrorHandling: async (
        eventName: string,
        callback: (context: { telemetry: ITelemetryContext; errorHandling: Record<string, boolean> }) => Promise<unknown>,
    ): Promise<unknown> => {
        const telemetry: ITelemetryContext = { properties: {}, measurements: {} };
        const result = await callback({ telemetry, errorHandling: {} });
        events.push({ eventName, telemetry });
        return result;
    },
}));

// Only the worker transport is simulated; managers, credential lookup, and audience resolvers are real.
vi.mock('worker_threads', async () => {
    const { EventEmitter } = await import('events');
    return {
        Worker: class extends EventEmitter {
            private initRequestId = '';

            public constructor() {
                super();
            }

            public postMessage(message: MainToWorkerMessage): void {
                postedMessages.push(message);
                if (message.type === 'init') {
                    this.initRequestId = message.requestId;
                    this.reply({
                        type: 'tokenRequest',
                        requestId: 'token-request',
                        source: message.authMechanism === 'ManagedIdentity' ? 'managedIdentity' : 'vscode',
                        tenantId: message.tenantId,
                        clientId: message.managedIdentityClientId,
                    });
                } else if (message.type === 'tokenResponse' || message.type === 'tokenError') {
                    this.reply({
                        type: 'initResult',
                        requestId: this.initRequestId,
                        success: message.type === 'tokenResponse',
                        error: message.type === 'tokenError' ? message.error : undefined,
                    });
                } else if (message.type === 'eval') {
                    this.reply({
                        type: 'evalResult', requestId: message.requestId,
                        result: { type: 'number', printable: '1', durationMs: 0 },
                    });
                }
            }

            private reply(message: WorkerToMainMessage): void {
                queueMicrotask(() => this.emit('message', message));
            }

            public async terminate(): Promise<number> {
                return 0;
            }
        },
    };
});

const clusterId = 'private-cluster';
const clouds = [
    {
        setting: 'USGovernment', suffix: 'us', category: 'usgov', cloud: 'AzureUSGovernment',
        scope: 'https://ossrdbms-aad.database.usgovcloudapi.net/.default',
    },
    {
        setting: 'ChinaCloud', suffix: 'cn', category: 'china', cloud: 'AzureChinaCloud',
        scope: 'https://ossrdbms-aad.database.chinacloudapi.cn/.default',
    },
] as const;

let selectedCloud = 'USGovernment';

function credentials(authMechanism: AuthMethodId, suffix: string): CachedClusterCredentials {
    return {
        clusterId,
        connectionString: `mongodb://private-cluster.mongocluster.cosmos.azure.${suffix}:10255/`,
        authMechanism,
        entraIdConfig: { tenantId: 'private-tenant' },
        managedIdentityConfig: { tenantId: 'private-tenant', clientId: 'private-client' },
    };
}

describe('sovereign authentication with real audience resolvers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        postedMessages.length = 0;
        events.length = 0;
        selectedCloud = 'USGovernment';
        resetEntraTokenFailuresForTests();
        getSession.mockResolvedValue({ accessToken: 'private-token', account: { label: 'private-account' } });
        getManagedToken.mockResolvedValue({ accessToken: 'private-token', expiresOnTimestamp: Date.now() + 3_600_000 });
        const configuration = { get: vi.fn(), inspect: vi.fn(), has: vi.fn(), update: vi.fn() };
        configuration.get.mockImplementation((key: string): unknown => key === 'environment' ? selectedCloud : undefined);
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(configuration);
    });

    afterEach(() => {
        CredentialCache.deleteCredentials(clusterId);
        resetEntraTokenFailuresForTests();
    });

    it.each(clouds)('requests the real $setting interactive scope and allowlist', async (cloud) => {
        selectedCloud = cloud.setting;
        const startupProperties: Record<string, string> = {};
        const { options } = await new MicrosoftEntraIDAuthHandler(
            credentials(AuthMethodId.MicrosoftEntraID, cloud.suffix),
        ).configureAuth(undefined, { startupCorrelationId: 'startup-id', surface: 'extension', startupProperties });
        expect(getSession).toHaveBeenCalledExactlyOnceWith([cloud.scope], 'private-tenant', { createIfNone: true });
        expect(options.authMechanismProperties?.ALLOWED_HOSTS).toEqual([`*.azure.${cloud.suffix}`]);
        expect(startupProperties).toEqual({
            cloudCategory: cloud.category, tokenResourceReason: 'setting', configuredCloud: cloud.cloud,
            hostCloud: cloud.cloud, errorKind: 'none',
        });
        expect(JSON.stringify(startupProperties)).not.toMatch(/private|https|authority/);
    });

    it.each(clouds)('requests the real azure.$suffix managed identity scope independently of VS Code', async (cloud) => {
        selectedCloud = cloud.setting === 'USGovernment' ? 'ChinaCloud' : 'USGovernment';
        const { options } = await new ManagedIdentityAuthHandler(
            credentials(AuthMethodId.ManagedIdentity, cloud.suffix),
        ).configureAuth();
        expect(getManagedToken).not.toHaveBeenCalled();
        expect(options.authMechanismProperties?.ALLOWED_HOSTS).toEqual([`*.azure.${cloud.suffix}`]);
        const callback = options.authMechanismProperties?.OIDC_CALLBACK;
        if (!callback) {
            throw new Error('Expected the OIDC token callback');
        }
        expect(await callback({ version: 1, timeoutContext: new AbortController().signal })).toMatchObject({
            accessToken: 'private-token',
        });
        expect(getManagedToken).toHaveBeenCalledExactlyOnceWith(
            [cloud.scope], 'private-client', 'private-tenant', expect.any(String), undefined,
        );
        expect(getSession).not.toHaveBeenCalled();
    });

    it.each([
        ['shell', AuthMethodId.MicrosoftEntraID],
        ['playground', AuthMethodId.MicrosoftEntraID],
        ['shell', AuthMethodId.ManagedIdentity],
        ['playground', AuthMethodId.ManagedIdentity],
    ] as const)('resolves Government from the %s %s worker tokenRequest path', async (surface, authMethod) => {
        const stored = credentials(authMethod, 'us');
        CredentialCache.setAuthCredentials(
            clusterId, authMethod, stored.connectionString, undefined, undefined,
            stored.entraIdConfig, stored.managedIdentityConfig,
        );
        selectedCloud = authMethod === AuthMethodId.ManagedIdentity ? 'ChinaCloud' : 'USGovernment';
        const manager = surface === 'shell'
            ? new ShellSessionManager({ clusterId, clusterDisplayName: 'Test cluster', databaseName: 'test' })
            : new PlaygroundEvaluator();
        try {
            if (manager instanceof ShellSessionManager) {
                await manager.initialize();
            } else {
                await manager.evaluate({ clusterId, clusterDisplayName: 'Test cluster', databaseName: 'test' }, '1');
            }
            expect(postedMessages).toContainEqual(expect.objectContaining({
                type: 'init', connectionString: stored.connectionString, oidcAllowedHosts: ['*.azure.us'],
            }));
            expect(postedMessages).toContainEqual({
                type: 'tokenResponse', requestId: 'token-request', accessToken: 'private-token',
            });
            const provider = authMethod === AuthMethodId.ManagedIdentity ? getManagedToken : getSession;
            expect(provider.mock.calls[0]?.[0]).toEqual([clouds[0].scope]);
            const startup = events.find((event) => event.eventName === 'worker.startup');
            expect(startup?.telemetry.properties).toMatchObject({
                surface, authMethod, startupOutcome: 'succeeded', cloudCategory: 'usgov',
                tokenResourceReason: authMethod === AuthMethodId.ManagedIdentity ? 'host' : 'setting',
                hostCloud: 'AzureUSGovernment', errorKind: 'none',
            });
            expect(JSON.stringify(startup)).not.toMatch(/private|https|authority/);
        } finally {
            manager.dispose();
        }
    });
});
