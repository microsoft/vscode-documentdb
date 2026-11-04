/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type callWithTelemetryAndErrorHandling, type ITelemetryContext } from '@microsoft/vscode-azext-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { CredentialCache, type CachedClusterCredentials } from '../CredentialCache';
import { PlaygroundEvaluator } from '../playground/PlaygroundEvaluator';
import { type MainToWorkerMessage, type WorkerToMainMessage } from '../playground/workerTypes';
import { ShellSessionManager } from '../shell/ShellSessionManager';
import { AuthMethodId } from './AuthMethod';
import { getRecentEntraTokenFailure, resetEntraTokenFailuresForTests } from './entraErrors/entraTokenFailures';
import { ManagedIdentityAuthHandler } from './ManagedIdentityAuthHandler';
import { MicrosoftEntraIDAuthHandler } from './MicrosoftEntraIDAuthHandler';

interface TokenWorker {
    requestToken(requestId: string): void;
}

const workers = vi.hoisted((): TokenWorker[] => []);
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
    ...(await importOriginal<{ callWithTelemetryAndErrorHandling: typeof callWithTelemetryAndErrorHandling }>()),
    callWithTelemetryAndErrorHandling: async (
        eventName: string,
        callback: (context: {
            telemetry: ITelemetryContext;
            errorHandling: Record<string, boolean>;
        }) => Promise<unknown>,
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
            private initRequestId: string | undefined;
            private tokenRequest: Extract<WorkerToMainMessage, { type: 'tokenRequest' }> | undefined;

            public constructor() {
                super();
                workers.push(this);
            }

            public postMessage(message: MainToWorkerMessage): void {
                postedMessages.push(message);
                if (message.type === 'init') {
                    this.initRequestId = message.requestId;
                    this.tokenRequest = {
                        type: 'tokenRequest',
                        requestId: 'token-request',
                        source: message.authMechanism === 'ManagedIdentity' ? 'managedIdentity' : 'vscode',
                        tenantId: message.tenantId,
                        clientId: message.managedIdentityClientId,
                    };
                    if (requestTokenOnInit) {
                        this.requestToken('token-request');
                    } else {
                        this.reply({ type: 'initResult', requestId: this.initRequestId, success: true });
                        this.initRequestId = undefined;
                    }
                } else if ((message.type === 'tokenResponse' || message.type === 'tokenError') && this.initRequestId) {
                    this.reply({
                        type: 'initResult',
                        requestId: this.initRequestId,
                        success: message.type === 'tokenResponse',
                        error: message.type === 'tokenError' ? message.error : undefined,
                    });
                    this.initRequestId = undefined;
                } else if (message.type === 'eval') {
                    this.reply({
                        type: 'evalResult',
                        requestId: message.requestId,
                        result: { type: 'number', printable: '1', durationMs: 0 },
                    });
                }
            }

            public requestToken(requestId: string): void {
                if (!this.tokenRequest) {
                    throw new Error('Worker has not received its init message');
                }
                this.reply({ ...this.tokenRequest, requestId });
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
        setting: 'USGovernment',
        suffix: 'us',
        category: 'usgov',
        cloud: 'AzureUSGovernment',
        scope: 'https://ossrdbms-aad.database.usgovcloudapi.net/.default',
    },
    {
        setting: 'ChinaCloud',
        suffix: 'cn',
        category: 'china',
        cloud: 'AzureChinaCloud',
        scope: 'https://ossrdbms-aad.database.chinacloudapi.cn/.default',
    },
] as const;

const workerSessions = [
    ['shell', AuthMethodId.MicrosoftEntraID],
    ['playground', AuthMethodId.MicrosoftEntraID],
    ['shell', AuthMethodId.ManagedIdentity],
    ['playground', AuthMethodId.ManagedIdentity],
] as const;

let selectedCloud = 'USGovernment';
let customEndpoint: string | undefined;
let requestTokenOnInit = true;

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
        workers.length = 0;
        customEndpoint = undefined;
        requestTokenOnInit = true;
        events.length = 0;
        selectedCloud = 'USGovernment';
        resetEntraTokenFailuresForTests();
        getSession.mockResolvedValue({ accessToken: 'private-token', account: { label: 'private-account' } });
        getManagedToken.mockResolvedValue({ accessToken: 'private-token', expiresOnTimestamp: Date.now() + 3_600_000 });
        const configuration = { get: vi.fn(), inspect: vi.fn(), has: vi.fn(), update: vi.fn() };
        configuration.get.mockImplementation((key: string, defaultValue?: unknown): unknown => {
            if (key === 'environment') {
                return selectedCloud;
            }
            if (key === 'documentDB.customEnvironment') {
                return { ossrdbmsEndpoint: customEndpoint };
            }
            return defaultValue;
        });
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
            cloudCategory: cloud.category,
            tokenResourceReason: 'setting',
            configuredCloud: cloud.cloud,
            hostCloud: cloud.cloud,
            errorKind: 'none',
        });
        expect(JSON.stringify(startupProperties)).not.toMatch(/private|https|authority/);
    });

    it.each(clouds)(
        'requests the real azure.$suffix managed identity scope independently of VS Code',
        async (cloud) => {
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
                [cloud.scope],
                'private-client',
                'private-tenant',
                expect.any(String),
                undefined,
            );
            expect(getSession).not.toHaveBeenCalled();
        },
    );

    it.each(workerSessions)(
        'resolves Government from the %s %s worker tokenRequest path',
        async (surface, authMethod) => {
            const stored = credentials(authMethod, 'us');
            CredentialCache.setAuthCredentials(
                clusterId,
                authMethod,
                stored.connectionString,
                undefined,
                undefined,
                stored.entraIdConfig,
                stored.managedIdentityConfig,
            );
            selectedCloud = authMethod === AuthMethodId.ManagedIdentity ? 'ChinaCloud' : 'USGovernment';
            const manager =
                surface === 'shell'
                    ? new ShellSessionManager({ clusterId, clusterDisplayName: 'Test cluster', databaseName: 'test' })
                    : new PlaygroundEvaluator();
            try {
                if (manager instanceof ShellSessionManager) {
                    await manager.initialize();
                } else {
                    await manager.evaluate(
                        { clusterId, clusterDisplayName: 'Test cluster', databaseName: 'test' },
                        '1',
                    );
                }
                expect(postedMessages).toContainEqual(
                    expect.objectContaining({
                        type: 'init',
                        connectionString: stored.connectionString,
                        oidcAllowedHosts: ['*.azure.us'],
                    }),
                );
                expect(postedMessages).toContainEqual({
                    type: 'tokenResponse',
                    requestId: 'token-request',
                    accessToken: 'private-token',
                });
                const provider = authMethod === AuthMethodId.ManagedIdentity ? getManagedToken : getSession;
                expect(provider.mock.calls[0]?.[0]).toEqual([clouds[0].scope]);
                const startup = events.find((event) => event.eventName === 'worker.startup');
                expect(startup?.telemetry.properties).toMatchObject({
                    surface,
                    authMethod,
                    startupOutcome: 'succeeded',
                    cloudCategory: 'usgov',
                    tokenResourceReason: authMethod === AuthMethodId.ManagedIdentity ? 'host' : 'setting',
                    hostCloud: 'AzureUSGovernment',
                    errorKind: 'none',
                });
                expect(JSON.stringify(startup)).not.toMatch(/private|https|authority/);
            } finally {
                manager.dispose();
            }
        },
    );

    describe.each(workerSessions)('%s %s worker lifetime', (surface, authMethod) => {
        let manager: ShellSessionManager | PlaygroundEvaluator;
        const connection = { clusterId, clusterDisplayName: 'Test cluster', databaseName: 'test' };
        const provider = authMethod === AuthMethodId.ManagedIdentity ? getManagedToken : getSession;

        function storeCredentials(suffix: string): void {
            const stored = credentials(authMethod, suffix);
            CredentialCache.setAuthCredentials(
                clusterId,
                authMethod,
                stored.connectionString,
                undefined,
                undefined,
                stored.entraIdConfig,
                stored.managedIdentityConfig,
            );
        }

        async function initializeSession(): Promise<void> {
            if (manager instanceof ShellSessionManager) {
                await manager.initialize();
            } else {
                await manager.evaluate(connection, '1');
            }
        }

        async function refreshToken(worker: TokenWorker, requestId: string): Promise<void> {
            worker.requestToken(requestId);
            await vi.waitFor(() => {
                expect(postedMessages).toContainEqual(
                    expect.objectContaining({ requestId, type: expect.stringMatching(/^token(Response|Error)$/) }),
                );
            });
        }

        beforeEach(() => {
            storeCredentials('us');
            manager = surface === 'shell' ? new ShellSessionManager(connection) : new PlaygroundEvaluator();
        });

        afterEach(() => manager.dispose());

        it('refreshes with the original scope after credentials are evicted', async () => {
            await initializeSession();
            CredentialCache.deleteCredentials(clusterId);

            await refreshToken(workers[0], 'refresh-request');

            expect(postedMessages).toContainEqual({
                type: 'tokenResponse',
                requestId: 'refresh-request',
                accessToken: 'private-token',
            });
            expect(provider.mock.calls.map((call) => call[0])).toEqual([[clouds[0].scope], [clouds[0].scope]]);
        });

        it('keeps the first audience after cloud configuration changes', async () => {
            await initializeSession();
            if (authMethod === AuthMethodId.ManagedIdentity) {
                customEndpoint = clouds[1].scope.replace('/.default', '');
            } else {
                selectedCloud = 'ChinaCloud';
            }
            if (manager instanceof PlaygroundEvaluator) {
                await manager.evaluate(connection, '1');
            }

            await refreshToken(workers[0], 'refresh-request');

            expect(workers).toHaveLength(1);
            expect(postedMessages).toContainEqual({
                type: 'tokenResponse',
                requestId: 'refresh-request',
                accessToken: 'private-token',
            });
            expect(provider.mock.calls.map((call) => call[0])).toEqual([[clouds[0].scope], [clouds[0].scope]]);
        });

        it('retries audience resolution after a resolution failure', async () => {
            requestTokenOnInit = false;
            await initializeSession();
            if (authMethod === AuthMethodId.ManagedIdentity) {
                customEndpoint = 'not-an-https-resource';
            } else {
                selectedCloud = 'ChinaCloud';
            }

            await refreshToken(workers[0], 'failed-resolution');

            expect(postedMessages).toContainEqual({
                type: 'tokenError',
                requestId: 'failed-resolution',
                error: expect.stringContaining(authMethod === AuthMethodId.ManagedIdentity ? 'HTTPS' : 'signed in'),
            });
            expect(provider).not.toHaveBeenCalled();
            expect(getRecentEntraTokenFailure(clusterId)).toBeUndefined();

            customEndpoint = undefined;
            selectedCloud = 'USGovernment';
            await refreshToken(workers[0], 'retry-resolution');

            expect(postedMessages).toContainEqual({
                type: 'tokenResponse',
                requestId: 'retry-resolution',
                accessToken: 'private-token',
            });
            expect(provider.mock.calls[0]?.[0]).toEqual([clouds[0].scope]);
        });

        it('replaces the captured connection and audience when a new worker starts', async () => {
            await initializeSession();
            manager.killWorker();
            storeCredentials('cn');
            selectedCloud = 'ChinaCloud';

            await initializeSession();
            CredentialCache.deleteCredentials(clusterId);
            await refreshToken(workers[1], 'replacement-refresh');

            expect(workers).toHaveLength(2);
            expect(postedMessages).toContainEqual({
                type: 'tokenResponse',
                requestId: 'replacement-refresh',
                accessToken: 'private-token',
            });
            expect(provider.mock.calls.map((call) => call[0])).toEqual([
                [clouds[0].scope],
                [clouds[1].scope],
                [clouds[1].scope],
            ]);
        });

        it('ignores a late token failure after the replacement worker succeeds', async () => {
            await initializeSession();
            let failToken: (error: Error) => void = () => {
                throw new Error('Expected the old token call to start');
            };
            provider.mockImplementationOnce(
                (): Promise<never> =>
                    new Promise<never>((_resolve, reject) => {
                        failToken = reject;
                    }),
            );
            workers[0].requestToken('late-failure');
            await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2));
            manager.killWorker();
            await initializeSession();
            expect(getRecentEntraTokenFailure(clusterId)).toBeUndefined();

            failToken(new Error('AADSTS65002: old worker token failed'));
            await new Promise<void>((resolve) => setImmediate(resolve));

            expect(getRecentEntraTokenFailure(clusterId)).toBeUndefined();
            expect(postedMessages).not.toContainEqual(expect.objectContaining({ requestId: 'late-failure' }));
        });

        it('does not let a late token success clear a newer failure', async () => {
            await initializeSession();
            let finishToken: () => void = () => {
                throw new Error('Expected the old token call to start');
            };
            provider.mockImplementationOnce(
                (): Promise<{ accessToken: string; account: { label: string } }> =>
                    new Promise((resolve) => {
                        finishToken = (): void =>
                            resolve({ accessToken: 'old-token', account: { label: 'old-account' } });
                    }),
            );
            workers[0].requestToken('late-success');
            await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2));
            manager.killWorker();
            await initializeSession();
            provider.mockRejectedValueOnce(new Error('AADSTS65002: current worker token failed'));
            await refreshToken(workers[1], 'newer-failure');
            const failure = getRecentEntraTokenFailure(clusterId);
            expect(failure).toMatchObject({
                cloudCategory: 'usgov',
                authMethod: authMethod === AuthMethodId.ManagedIdentity ? 'managedIdentity' : 'interactive',
            });

            finishToken();
            await new Promise<void>((resolve) => setImmediate(resolve));

            expect(getRecentEntraTokenFailure(clusterId)).toBe(failure);
            expect(postedMessages).not.toContainEqual(expect.objectContaining({ requestId: 'late-success' }));
        });

        it('does not let a stale audience resolution seed the replacement worker memo', async () => {
            requestTokenOnInit = false;
            await initializeSession();
            workers[0].requestToken('late-resolution');

            await new Promise<void>((resolve, reject) => {
                // Replace the worker before the old resolver's await continuation runs.
                queueMicrotask(() => {
                    manager.killWorker();
                    storeCredentials('cn');
                    selectedCloud = 'ChinaCloud';
                    void initializeSession().then(resolve, reject);
                });
            });

            await new Promise<void>((resolve) => setImmediate(resolve));
            await refreshToken(workers[1], 'replacement-refresh');

            expect(workers).toHaveLength(2);
            expect(provider.mock.calls.at(-1)?.[0]).toEqual([clouds[1].scope]);
            expect(postedMessages).not.toContainEqual(expect.objectContaining({ requestId: 'late-resolution' }));
        });
    });
});
