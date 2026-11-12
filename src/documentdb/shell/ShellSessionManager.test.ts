/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as vscode from 'vscode';
import { type AuthenticationSession } from 'vscode';
import { ext } from '../../extensionVariables';
import { AuthMethodId } from '../auth/AuthMethod';
import type * as documentdbTokenResource from '../auth/documentdbTokenResource';
import {
    resolveInteractiveTokenResource,
    resolveManagedIdentityTokenResource,
    TokenResourceResolutionError,
} from '../auth/documentdbTokenResource';
import { EntraErrorExplainer } from '../auth/entraErrors/EntraErrorExplainer';
import {
    getRecentEntraTokenFailure,
    recordEntraTokenFailure,
    resetEntraTokenFailuresForTests,
} from '../auth/entraErrors/entraTokenFailures';
import { CredentialCache } from '../CredentialCache';
import { PlaygroundEvaluator } from '../playground/PlaygroundEvaluator';
import { type WorkerSessionCallbacks } from '../playground/WorkerSessionManager';
import { type MainToWorkerMessage, type WorkerToMainMessage } from '../playground/workerTypes';
import { ConnectionStartupTimings } from '../utils/ConnectionStartupTimings';
import { ShellSessionManager } from './ShellSessionManager';

const mockGetSessionFromVSCode = vi.fn();
const mockGetManagedIdentityAccessToken = vi.fn();
let workerCallbacks: WorkerSessionCallbacks;
let workerClusterId: string | undefined;
let requestTokenOnInit = false;

vi.mock('../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            trace: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        },
    },
}));

vi.mock('@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode', () => ({
    getSessionFromVSCode: (...args: unknown[]) => mockGetSessionFromVSCode(...args),
}));

vi.mock('../auth/managedIdentityTokenProvider', () => ({
    getManagedIdentityAccessToken: (...args: unknown[]) => mockGetManagedIdentityAccessToken(...args),
}));

vi.mock('../auth/documentdbTokenResource', async (importOriginal) => ({
    ...(await importOriginal<typeof documentdbTokenResource>()),
    resolveInteractiveTokenResource: vi.fn(),
    resolveManagedIdentityTokenResource: vi.fn(),
}));

vi.mock('../playground/WorkerSessionManager', () => ({
    WorkerSessionManager: vi.fn().mockImplementation(function (callbacks: WorkerSessionCallbacks) {
        workerCallbacks = callbacks;
        return {
            ensureWorker: vi.fn(
                async (clusterId: string, initMessage: MainToWorkerMessage & { type: 'init' }): Promise<void> => {
                    workerClusterId = clusterId;
                    if (!requestTokenOnInit || initMessage.authMechanism !== 'MicrosoftEntraID') {
                        return;
                    }

                    const tokenRequest: Extract<WorkerToMainMessage, { type: 'tokenRequest' }> = {
                        type: 'tokenRequest',
                        requestId: 'token-request',
                        source: 'vscode',
                        tenantId: initMessage.tenantId,
                    };
                    await workerCallbacks.onTokenRequest?.(
                        tokenRequest,
                        (_response: MainToWorkerMessage): void => undefined,
                        () => true,
                    );
                },
            ),
            isConnectedTo: vi.fn(() => false),
            sendEval: vi.fn().mockResolvedValue({ result: { type: 'number', printable: '1', durationMs: 0 } }),
            get isAlive(): boolean {
                return true;
            },
            get workerState(): string {
                return 'ready';
            },
            get workerClusterId(): string | undefined {
                return workerClusterId;
            },
            dispose: vi.fn(),
        };
    }),
}));

describe('ShellSessionManager', () => {
    const clusterId = 'test-cluster-id';

    beforeEach(() => {
        vi.clearAllMocks();
        resetEntraTokenFailuresForTests();
        workerClusterId = clusterId;
        requestTokenOnInit = false;
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            get: vi.fn(),
            inspect: vi.fn(),
        } as unknown as vscode.WorkspaceConfiguration);
        const publicResolution = {
            resource: 'https://ossrdbms-aad.database.windows.net',
            scope: 'https://ossrdbms-aad.database.windows.net/.default',
            cloudCategory: 'public',
            reason: 'setting',
            details: {
                flow: 'interactive',
                tokenResource: 'https://ossrdbms-aad.database.windows.net',
            },
        } as const;
        vi.mocked(resolveInteractiveTokenResource).mockResolvedValue(publicResolution);
        vi.mocked(resolveManagedIdentityTokenResource).mockResolvedValue({ ...publicResolution, reason: 'host' });
        CredentialCache.setAuthCredentials(
            clusterId,
            AuthMethodId.MicrosoftEntraID,
            'mongodb://test-host.mongocluster.cosmos.azure.com:27017',
            undefined,
            undefined,
            { tenantId: 'test-tenant-id' },
        );
    });

    afterEach(() => {
        CredentialCache.deleteCredentials(clusterId);
        resetEntraTokenFailuresForTests();
    });

    async function initializeSession(
        manager: ShellSessionManager | PlaygroundEvaluator,
        source?: 'vscode' | 'managedIdentity',
    ): Promise<void> {
        if (source) {
            const credentials = CredentialCache.getCredentials(clusterId)!;
            CredentialCache.setAuthCredentials(
                clusterId,
                source === 'managedIdentity' ? AuthMethodId.ManagedIdentity : AuthMethodId.MicrosoftEntraID,
                credentials.connectionString,
                undefined,
                undefined,
                credentials.entraIdConfig,
                credentials.managedIdentityConfig,
            );
        }
        if (manager instanceof ShellSessionManager) {
            await manager.initialize();
        } else {
            await manager.evaluate({ clusterId, clusterDisplayName: 'Test Cluster', databaseName: 'test' }, '1');
        }
    }

    describe.each(['shell', 'playground'] as const)('%s relay destination enforcement', (surface) => {
        function createManager(): ShellSessionManager | PlaygroundEvaluator {
            return surface === 'shell'
                ? new ShellSessionManager({ clusterId, clusterDisplayName: 'Test Cluster', databaseName: 'test' })
                : new PlaygroundEvaluator();
        }

        it.each([AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity])(
            'binds %s source, tenant, client and destination to the original session, not forged requests or cache',
            async (authMethod): Promise<void> => {
                const original = 'mongodb://original.mongocluster.cosmos.azure.com/';
                CredentialCache.setAuthCredentials(
                    clusterId,
                    authMethod,
                    original,
                    undefined,
                    undefined,
                    { tenantId: 'original-tenant' },
                    { tenantId: 'original-tenant', clientId: 'original-client' },
                );
                const manager = createManager();
                await initializeSession(manager);
                CredentialCache.setAuthCredentials(
                    clusterId,
                    AuthMethodId.ManagedIdentity,
                    'mongodb://attacker.cloudapp.azure.com/',
                    undefined,
                    undefined,
                    { tenantId: 'cache-tenant' },
                    { tenantId: 'cache-tenant', clientId: 'cache-client' },
                );
                const provider =
                    authMethod === AuthMethodId.ManagedIdentity
                        ? mockGetManagedIdentityAccessToken
                        : mockGetSessionFromVSCode;
                provider.mockResolvedValue({ accessToken: 'private-token', account: { label: 'private-account' } });
                const postResponse = vi.fn();
                const forged = {
                    type: 'tokenRequest',
                    requestId: 'forged-request',
                    source: authMethod === AuthMethodId.ManagedIdentity ? 'vscode' : 'managedIdentity',
                    tenantId: 'forged-tenant',
                    clientId: 'forged-client',
                } as const;
                await workerCallbacks.onTokenRequest?.(forged, postResponse, () => true);
                await workerCallbacks.onTokenRequest?.({ ...forged, requestId: 'refresh' }, postResponse, () => true);
                expect(provider).toHaveBeenCalledTimes(2);
                if (authMethod === AuthMethodId.ManagedIdentity) {
                    expect(resolveManagedIdentityTokenResource).toHaveBeenCalledExactlyOnceWith(original);
                    expect(mockGetSessionFromVSCode).not.toHaveBeenCalled();
                    expect(provider).toHaveBeenCalledWith(
                        ['https://ossrdbms-aad.database.windows.net/.default'],
                        'original-client',
                        'original-tenant',
                        expect.any(String),
                        undefined,
                    );
                } else {
                    expect(resolveInteractiveTokenResource).toHaveBeenCalledExactlyOnceWith(original);
                    expect(mockGetManagedIdentityAccessToken).not.toHaveBeenCalled();
                    expect(provider).toHaveBeenCalledWith(
                        ['https://ossrdbms-aad.database.windows.net/.default'],
                        'original-tenant',
                        { createIfNone: true },
                    );
                }
                expect(postResponse).toHaveBeenLastCalledWith({
                    type: 'tokenResponse',
                    requestId: 'refresh',
                    accessToken: 'private-token',
                });
                manager.dispose();
            },
        );

        it.each([AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity])(
            'rejects a mixed saved %s session before audience resolution, IMDS or tokens',
            async (authMethod): Promise<void> => {
                CredentialCache.setAuthCredentials(
                    clusterId,
                    authMethod,
                    'mongodb://cluster.mongocluster.cosmos.azure.com,attacker.cloudapp.azure.com/',
                );
                const manager = createManager();
                await initializeSession(manager);
                const postResponse = vi.fn();
                const startupProperties: Record<string, string> = {};
                await workerCallbacks.onTokenRequest?.(
                    { type: 'tokenRequest', requestId: 'rejected' },
                    postResponse,
                    () => true,
                    undefined,
                    { startupCorrelationId: 'startup-id', surface, startupProperties },
                );
                expect(resolveInteractiveTokenResource).not.toHaveBeenCalled();
                expect(resolveManagedIdentityTokenResource).not.toHaveBeenCalled();
                expect(mockGetSessionFromVSCode).not.toHaveBeenCalled();
                expect(mockGetManagedIdentityAccessToken).not.toHaveBeenCalled();
                expect(postResponse).toHaveBeenCalledExactlyOnceWith({
                    type: 'tokenError',
                    requestId: 'rejected',
                    error: "Microsoft Entra ID isn't allowed for this server.",
                    errorName: 'EntraDestinationRejectedError',
                });
                expect(startupProperties).toEqual({
                    entraDestinationClass: 'otherAzure',
                    microsoftCloudDomain: 'true',
                    serviceLabel: 'false',
                });
                manager.dispose();
            },
        );

        it.each([AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity])(
            'rechecks current machine trust for %s refresh even when the cache now contains an approved destination',
            async (authMethod): Promise<void> => {
                let suffix: unknown = '.database.example.com';
                vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
                    get: vi.fn(),
                    inspect: vi.fn(() => ({ globalValue: { hostnameSuffix: suffix } })),
                } as unknown as vscode.WorkspaceConfiguration);
                CredentialCache.setAuthCredentials(clusterId, authMethod, 'mongodb://original.database.example.com/');
                const manager = createManager();
                await initializeSession(manager);
                const provider =
                    authMethod === AuthMethodId.ManagedIdentity
                        ? mockGetManagedIdentityAccessToken
                        : mockGetSessionFromVSCode;
                provider.mockResolvedValue({ accessToken: 'private-token', account: { label: 'private-account' } });
                const postResponse = vi.fn();
                await workerCallbacks.onTokenRequest?.(
                    { type: 'tokenRequest', requestId: 'first' },
                    postResponse,
                    () => true,
                );
                expect(provider).toHaveBeenCalledTimes(1);
                CredentialCache.setAuthCredentials(
                    clusterId,
                    authMethod,
                    'mongodb://cluster.mongocluster.cosmos.azure.com/',
                );
                suffix = undefined;
                await workerCallbacks.onTokenRequest?.(
                    { type: 'tokenRequest', requestId: 'refresh' },
                    postResponse,
                    () => true,
                );
                expect(provider).toHaveBeenCalledTimes(1);
                expect(
                    vi.mocked(resolveInteractiveTokenResource).mock.calls.length +
                        vi.mocked(resolveManagedIdentityTokenResource).mock.calls.length,
                ).toBe(1);
                expect(postResponse).toHaveBeenLastCalledWith({
                    type: 'tokenError',
                    requestId: 'refresh',
                    error: "Microsoft Entra ID isn't allowed for this server.",
                    errorName: 'EntraDestinationRejectedError',
                });
                manager.dispose();
            },
        );

        it.each([AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity])(
            'rejects pending %s completion after trust removal without clearing or recording provider failure',
            async (authMethod): Promise<void> => {
                let suffix: string | undefined = 'database.example.com';
                vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
                    get: vi.fn(),
                    inspect: vi.fn(() => ({ globalValue: { hostnameSuffix: suffix } })),
                } as unknown as vscode.WorkspaceConfiguration);
                CredentialCache.setAuthCredentials(clusterId, authMethod, 'mongodb://original.database.example.com/');
                const manager = createManager();
                await initializeSession(manager);
                recordEntraTokenFailure(clusterId, { cloudCategory: 'custom', authMethod: 'interactive' });
                const failure = getRecentEntraTokenFailure(clusterId);
                let finish!: () => void;
                const gate = new Promise<void>((resolve) => {
                    finish = resolve;
                });
                const provider =
                    authMethod === AuthMethodId.ManagedIdentity
                        ? mockGetManagedIdentityAccessToken
                        : mockGetSessionFromVSCode;
                provider.mockImplementationOnce(async () => {
                    await gate;
                    return { accessToken: 'must-not-post', account: { label: 'private-account' } };
                });
                const response = vi.fn();
                const startupProperties: Record<string, string> = {};
                const pending = workerCallbacks.onTokenRequest!(
                    { type: 'tokenRequest', requestId: 'pending' },
                    response,
                    () => true,
                    undefined,
                    { startupCorrelationId: 'startup', surface, startupProperties },
                );
                await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1));
                suffix = undefined;
                finish();
                await pending;
                expect(response).toHaveBeenCalledExactlyOnceWith({
                    type: 'tokenError',
                    requestId: 'pending',
                    error: "Microsoft Entra ID isn't allowed for this server.",
                    errorName: 'EntraDestinationRejectedError',
                });
                expect(getRecentEntraTokenFailure(clusterId)).toBe(failure);
                expect(startupProperties.entraFailureKind).not.toBe('tokenAcquisitionFailed');
                expect(JSON.stringify(response.mock.calls)).not.toContain('must-not-post');
                manager.dispose();
            },
        );

        it.each([AuthMethodId.NoAuth, AuthMethodId.NativeAuth])(
            'never acquires tokens for a forged request from a %s session',
            async (authMethod): Promise<void> => {
                CredentialCache.setAuthCredentials(clusterId, authMethod, 'mongodb://localhost:27017/');
                const manager = createManager();
                await initializeSession(manager);
                const postResponse = vi.fn();
                await workerCallbacks.onTokenRequest?.(
                    {
                        type: 'tokenRequest',
                        requestId: 'forged',
                        source: 'managedIdentity',
                    },
                    postResponse,
                    () => true,
                );
                expect(postResponse).toHaveBeenCalledWith(expect.objectContaining({ type: 'tokenError' }));
                expect(resolveInteractiveTokenResource).not.toHaveBeenCalled();
                expect(resolveManagedIdentityTokenResource).not.toHaveBeenCalled();
                expect(mockGetSessionFromVSCode).not.toHaveBeenCalled();
                expect(mockGetManagedIdentityAccessToken).not.toHaveBeenCalled();
                manager.dispose();
            },
        );
    });

    it('returns the optional Microsoft Entra account display name', async () => {
        requestTokenOnInit = true;
        const session: AuthenticationSession = {
            id: 'session-id',
            accessToken: 'access-token',
            account: {
                id: 'account-id',
                label: 'alex@contoso.com',
            },
            scopes: ['scope'],
        };
        mockGetSessionFromVSCode.mockResolvedValue(session);
        const manager = new ShellSessionManager({
            clusterId,
            clusterDisplayName: 'Test Cluster',
            databaseName: 'test',
        });

        const metadata = await manager.initialize();

        expect(metadata.displayName).toBe('alex@contoso.com');
    });

    it('returns the first host and count of additional hosts', async () => {
        CredentialCache.setAuthCredentials(
            clusterId,
            AuthMethodId.NoAuth,
            'mongodb://db-a.example.com:27017,db-b.example.com:27017,db-c.example.com:27017,db-d.example.com:27017',
        );
        const manager = new ShellSessionManager({
            clusterId,
            clusterDisplayName: 'Test Cluster',
            databaseName: 'test',
        });

        const metadata = await manager.initialize();

        expect(metadata.host).toBe('db-a.example.com:27017');
        expect(metadata.additionalHostCount).toBe(3);
    });

    it.each([
        ['shell', '[Shell Worker]'],
        ['playground', '[Playground Worker]'],
    ] as const)('labels %s worker diagnostics with startup identity', (surface, component): void => {
        const manager =
            surface === 'shell'
                ? new ShellSessionManager({ clusterId, clusterDisplayName: 'Test Cluster', databaseName: 'test' })
                : new PlaygroundEvaluator();
        workerCallbacks.onLog?.('debug', 'Initializing worker', 'startup-id');
        expect(ext.outputChannel.debug).toHaveBeenCalledWith(
            `${component} startup=startup-id surface=${surface} Initializing worker`,
        );
        manager.dispose();
    });

    it.each([
        ['shell', 'vscode'],
        ['shell', 'managedIdentity'],
        ['playground', 'vscode'],
        ['playground', 'managedIdentity'],
    ] as const)('measures provider time for %s using %s', async (surface, source) => {
        let now = 0;
        const timings = new ConnectionStartupTimings(() => now);
        const manager =
            surface === 'shell'
                ? new ShellSessionManager({ clusterId, clusterDisplayName: 'Test Cluster', databaseName: 'test' })
                : new PlaygroundEvaluator();
        const provider = source === 'vscode' ? mockGetSessionFromVSCode : mockGetManagedIdentityAccessToken;
        provider.mockImplementationOnce(async () => {
            now = 40;
            return { accessToken: 'private-token', account: { label: 'private-account' } };
        });
        await initializeSession(manager, source);
        const stopDatabase = timings.startDatabaseConnect();
        now = 10;
        const stopWait = timings.startTokenWait();
        now = 15;
        const postResponse = vi.fn();
        const traceContext = { startupCorrelationId: 'startup-id', surface };
        await workerCallbacks.onTokenRequest?.(
            { type: 'tokenRequest', requestId: 'token-request', source },
            postResponse,
            () => true,
            timings,
            traceContext,
        );
        now = 45;
        stopWait();
        now = 60;
        stopDatabase();

        expect(postResponse).toHaveBeenCalledWith({
            type: 'tokenResponse',
            requestId: 'token-request',
            accessToken: 'private-token',
        });
        expect(getRecentEntraTokenFailure(clusterId)).toBeUndefined();
        expect(timings.finish()).toEqual({
            databaseConnectDurationMs: 25,
            tokenAcquireDurationMs: 25,
            tokenRelayDurationMs: 10,
        });
        if (source === 'managedIdentity') {
            expect(mockGetManagedIdentityAccessToken).toHaveBeenCalledWith(
                ['https://ossrdbms-aad.database.windows.net/.default'],
                undefined,
                undefined,
                expect.any(String),
                traceContext,
            );
        } else {
            expect(ext.outputChannel.info).toHaveBeenCalledWith(
                expect.stringContaining(
                    `[Authentication] startup=startup-id surface=${surface} interactiveEntra.getSession`,
                ),
            );
        }
        manager.dispose();
    });

    it.each([
        ['shell', 'vscode'],
        ['shell', 'managedIdentity'],
        ['playground', 'vscode'],
        ['playground', 'managedIdentity'],
    ] as const)('resolves the %s %s token audience from the cluster credentials', async (surface, source) => {
        const connectionString = 'mongodb://cluster.mongocluster.cosmos.azure.us/';
        CredentialCache.setAuthCredentials(
            clusterId,
            source === 'vscode' ? AuthMethodId.MicrosoftEntraID : AuthMethodId.ManagedIdentity,
            connectionString,
        );
        const resolver = source === 'vscode' ? resolveInteractiveTokenResource : resolveManagedIdentityTokenResource;
        vi.mocked(resolver).mockResolvedValueOnce({
            resource: 'https://ossrdbms-aad.database.usgovcloudapi.net',
            scope: 'https://ossrdbms-aad.database.usgovcloudapi.net/.default',
            cloudCategory: 'usgov',
            reason: source === 'vscode' ? 'setting' : 'host',
            details: {
                flow: source === 'vscode' ? 'interactive' : 'managedIdentity',
                cloudCategory: 'usgov',
                reason: source === 'vscode' ? 'setting' : 'host',
                configuredCloud: 'AzureUSGovernment',
                hostCloud: 'AzureUSGovernment',
                tokenResource: 'https://ossrdbms-aad.database.usgovcloudapi.net',
            },
        });
        const provider = source === 'vscode' ? mockGetSessionFromVSCode : mockGetManagedIdentityAccessToken;
        provider.mockResolvedValueOnce({ accessToken: 'private-token', account: { label: 'private-account' } });
        const manager =
            surface === 'shell'
                ? new ShellSessionManager({ clusterId, clusterDisplayName: 'Test Cluster', databaseName: 'test' })
                : new PlaygroundEvaluator();
        await initializeSession(manager);
        const postResponse = vi.fn();
        const startupProperties: Record<string, string> = {};
        await workerCallbacks.onTokenRequest?.(
            { type: 'tokenRequest', requestId: 'token-request', source },
            postResponse,
            () => true,
            undefined,
            { startupCorrelationId: 'startup-id', surface, startupProperties },
        );
        expect(startupProperties).toEqual({
            entraDestinationClass: 'documentdbService',
            cloudCategory: 'usgov',
            tokenResourceReason: source === 'vscode' ? 'setting' : 'host',
            configuredCloud: 'AzureUSGovernment',
            hostCloud: 'AzureUSGovernment',
            entraFailureKind: 'none',
        });
        expect(resolver).toHaveBeenCalledWith(connectionString);
        expect(provider.mock.calls.at(-1)?.[0]).toEqual(['https://ossrdbms-aad.database.usgovcloudapi.net/.default']);
        expect(postResponse).toHaveBeenCalledWith({
            type: 'tokenResponse',
            requestId: 'token-request',
            accessToken: 'private-token',
        });
        manager.dispose();
    });

    it.each([
        ['shell', 'vscode'],
        ['shell', 'managedIdentity'],
        ['playground', 'vscode'],
        ['playground', 'managedIdentity'],
    ] as const)(
        'does not record a %s %s resolution error as a failed token acquisition',
        async (surface, source): Promise<void> => {
            const error = new TokenResourceResolutionError(
                'Select the cloud of the cluster.',
                source === 'vscode' ? 'cloudMismatch' : 'managedIdentityCloudUnknown',
                {
                    flow: source === 'vscode' ? 'interactive' : 'managedIdentity',
                    errorKind: source === 'vscode' ? 'cloudMismatch' : 'managedIdentityCloudUnknown',
                },
            );
            const resolver =
                source === 'vscode' ? resolveInteractiveTokenResource : resolveManagedIdentityTokenResource;
            vi.mocked(resolver).mockRejectedValueOnce(error);
            const manager =
                surface === 'shell'
                    ? new ShellSessionManager({ clusterId, clusterDisplayName: 'Test Cluster', databaseName: 'test' })
                    : new PlaygroundEvaluator();
            await initializeSession(manager, source);
            const postResponse = vi.fn();
            const startupProperties: Record<string, string> = {};
            await workerCallbacks.onTokenRequest?.(
                { type: 'tokenRequest', requestId: 'token-request', source },
                postResponse,
                () => true,
                undefined,
                { startupCorrelationId: 'startup-id', surface, startupProperties },
            );
            expect(startupProperties.entraFailureKind).toBe(error.kind);
            expect(mockGetSessionFromVSCode).not.toHaveBeenCalled();
            expect(mockGetManagedIdentityAccessToken).not.toHaveBeenCalled();
            expect(getRecentEntraTokenFailure(clusterId)).toBeUndefined();
            expect(postResponse).toHaveBeenCalledWith({
                type: 'tokenError',
                requestId: 'token-request',
                error: error.message,
            });
            manager.dispose();
        },
    );

    it.each([
        ['shell', 'vscode'],
        ['shell', 'managedIdentity'],
        ['playground', 'vscode'],
        ['playground', 'managedIdentity'],
    ] as const)(
        'records the cloud and auth method for a failed %s %s token call',
        async (surface, source): Promise<void> => {
            const resolver =
                source === 'vscode' ? resolveInteractiveTokenResource : resolveManagedIdentityTokenResource;
            vi.mocked(resolver).mockResolvedValueOnce({
                resource: 'https://ossrdbms-aad.database.chinacloudapi.cn',
                scope: 'https://ossrdbms-aad.database.chinacloudapi.cn/.default',
                cloudCategory: 'china',
                reason: source === 'vscode' ? 'setting' : 'host',
                details: {
                    flow: source === 'vscode' ? 'interactive' : 'managedIdentity',
                    tokenResource: 'https://ossrdbms-aad.database.chinacloudapi.cn',
                },
            });
            const error = Object.freeze(
                Object.assign(new Error('AADSTS65002: Token failed'), { code: 'original-code' }),
            );
            const provider = source === 'vscode' ? mockGetSessionFromVSCode : mockGetManagedIdentityAccessToken;
            provider.mockRejectedValueOnce(error);
            const manager =
                surface === 'shell'
                    ? new ShellSessionManager({ clusterId, clusterDisplayName: 'Test Cluster', databaseName: 'test' })
                    : new PlaygroundEvaluator();
            await initializeSession(manager, source);
            const postResponse = vi.fn();
            const startupProperties: Record<string, string> = {};

            await workerCallbacks.onTokenRequest?.(
                { type: 'tokenRequest', requestId: 'token-request', source },
                postResponse,
                () => true,
                undefined,
                { startupCorrelationId: 'startup-id', surface, startupProperties },
            );
            expect(startupProperties.entraFailureKind).toBe('tokenAcquisitionFailed');
            expect(JSON.stringify(startupProperties)).not.toMatch(/https|private|AADSTS|original/);

            expect(postResponse).toHaveBeenCalledExactlyOnceWith({
                type: 'tokenError',
                requestId: 'token-request',
                error: error.message,
            });
            expect(error.code).toBe('original-code');
            expect(getRecentEntraTokenFailure(clusterId)).toEqual({
                cloudCategory: 'china',
                authMethod: source === 'vscode' ? 'interactive' : 'managedIdentity',
                timestamp: expect.any(Number),
            });
            manager.dispose();
        },
    );

    it.each([
        ['shell', 'vscode'],
        ['shell', 'managedIdentity'],
        ['playground', 'vscode'],
        ['playground', 'managedIdentity'],
    ] as const)(
        'clears stale %s %s failure context only after token success',
        async (surface, source): Promise<void> => {
            const resolver =
                source === 'vscode' ? resolveInteractiveTokenResource : resolveManagedIdentityTokenResource;
            vi.mocked(resolver).mockResolvedValueOnce({
                resource: 'https://ossrdbms-aad.database.chinacloudapi.cn',
                scope: 'https://ossrdbms-aad.database.chinacloudapi.cn/.default',
                cloudCategory: 'china',
                reason: source === 'vscode' ? 'setting' : 'host',
                details: { flow: source === 'vscode' ? 'interactive' : 'managedIdentity', cloudCategory: 'china' },
            });
            const error = Object.freeze(new Error('platform_broker_error'));
            const provider = source === 'vscode' ? mockGetSessionFromVSCode : mockGetManagedIdentityAccessToken;
            provider.mockRejectedValueOnce(error);
            const manager =
                surface === 'shell'
                    ? new ShellSessionManager({ clusterId, clusterDisplayName: 'Test Cluster', databaseName: 'test' })
                    : new PlaygroundEvaluator();
            await initializeSession(manager, source);
            const postResponse = vi.fn();
            const failedProperties: Record<string, string> = {};
            await workerCallbacks.onTokenRequest?.(
                { type: 'tokenRequest', requestId: 'failed-token-request', source },
                postResponse,
                () => true,
                undefined,
                { startupCorrelationId: 'failed-startup', surface, startupProperties: failedProperties },
            );
            expect(postResponse).toHaveBeenLastCalledWith({
                type: 'tokenError',
                requestId: 'failed-token-request',
                error: error.message,
            });
            const failure = getRecentEntraTokenFailure(clusterId);
            expect(failure).toMatchObject({
                cloudCategory: 'china',
                authMethod: source === 'vscode' ? 'interactive' : 'managedIdentity',
            });
            const diagnostics = new EntraErrorExplainer();
            expect(await diagnostics.explain({ clusterId, error })).toContain('Sign-in failed in Azure China');

            provider.mockImplementationOnce(async () => {
                expect(getRecentEntraTokenFailure(clusterId)).toBe(failure);
                return { accessToken: 'private-token', account: { label: 'private-account' } };
            });
            const successfulProperties: Record<string, string> = {};
            await workerCallbacks.onTokenRequest?.(
                { type: 'tokenRequest', requestId: 'successful-token-request', source },
                postResponse,
                () => true,
                undefined,
                { startupCorrelationId: 'successful-startup', surface, startupProperties: successfulProperties },
            );
            expect(postResponse).toHaveBeenLastCalledWith({
                type: 'tokenResponse',
                requestId: 'successful-token-request',
                accessToken: 'private-token',
            });
            expect(getRecentEntraTokenFailure(clusterId)).toBeUndefined();
            expect(failedProperties.entraFailureKind).toBe('tokenAcquisitionFailed');
            expect(successfulProperties.entraFailureKind).toBe('none');
            expect(await diagnostics.explain({ clusterId, error })).toMatch(
                /^The sign-in window reported an error without details\./,
            );
            expect(ext.outputChannel.info).toHaveBeenLastCalledWith(
                expect.stringContaining('"cloudCategory":"unknown","recentTokenFailure":false'),
            );
            expect(error.message).toBe('platform_broker_error');
            manager.dispose();
        },
    );

    it.each(['shell', 'playground'] as const)(
        'records a failed %s interactive token request when no session is returned',
        async (surface): Promise<void> => {
            mockGetSessionFromVSCode.mockResolvedValueOnce(undefined);
            const manager =
                surface === 'shell'
                    ? new ShellSessionManager({ clusterId, clusterDisplayName: 'Test Cluster', databaseName: 'test' })
                    : new PlaygroundEvaluator();
            await initializeSession(manager);
            const postResponse = vi.fn();

            await workerCallbacks.onTokenRequest?.(
                { type: 'tokenRequest', requestId: 'token-request', source: 'vscode' },
                postResponse,
                () => true,
            );

            expect(postResponse).toHaveBeenCalledExactlyOnceWith({
                type: 'tokenError',
                requestId: 'token-request',
                error: 'Failed to obtain Entra ID token.',
            });
            expect(getRecentEntraTokenFailure(clusterId)).toMatchObject({
                cloudCategory: 'public',
                authMethod: 'interactive',
            });
            manager.dispose();
        },
    );

    it.each(['shell', 'playground'] as const)(
        'does not record a %s connection failure before credentials are available',
        async (surface): Promise<void> => {
            CredentialCache.deleteCredentials(clusterId);
            const manager =
                surface === 'shell'
                    ? new ShellSessionManager({ clusterId, clusterDisplayName: 'Test Cluster', databaseName: 'test' })
                    : new PlaygroundEvaluator();
            const postResponse = vi.fn();

            await workerCallbacks.onTokenRequest?.(
                { type: 'tokenRequest', requestId: 'token-request', source: 'vscode' },
                postResponse,
                () => true,
            );

            expect(postResponse).toHaveBeenCalledWith(expect.objectContaining({ type: 'tokenError' }));
            expect(mockGetSessionFromVSCode).not.toHaveBeenCalled();
            expect(getRecentEntraTokenFailure(clusterId)).toBeUndefined();
            manager.dispose();
        },
    );
});
