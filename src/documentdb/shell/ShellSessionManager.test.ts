/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AuthenticationSession } from 'vscode';
import { ext } from '../../extensionVariables';
import { AuthMethodId } from '../auth/AuthMethod';
import {
    resolveInteractiveTokenResource,
    resolveManagedIdentityTokenResource,
    TokenResourceResolutionError,
} from '../auth/documentdbTokenResource';
import { getRecentEntraTokenFailure, resetEntraTokenFailuresForTests } from '../auth/entraErrors/entraTokenFailures';
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
    ...(await importOriginal<typeof import('../auth/documentdbTokenResource')>()),
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
                    if (initMessage.authMechanism !== 'MicrosoftEntraID') {
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
                    );
                },
            ),
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
            'mongodb://test-host.example.com:27017',
            undefined,
            undefined,
            { tenantId: 'test-tenant-id' },
        );
    });

    afterEach(() => {
        CredentialCache.deleteCredentials(clusterId);
        resetEntraTokenFailuresForTests();
    });

    it('returns the optional Microsoft Entra account display name', async () => {
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
        const stopDatabase = timings.startDatabaseConnect();
        now = 10;
        const stopWait = timings.startTokenWait();
        now = 15;
        const postResponse = vi.fn();
        const traceContext = { startupCorrelationId: 'startup-id', surface };
        await workerCallbacks.onTokenRequest?.(
            { type: 'tokenRequest', requestId: 'token-request', source },
            postResponse,
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
        const connectionString = 'mongodb://cluster.azure.us/';
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
                tokenResource: 'https://ossrdbms-aad.database.usgovcloudapi.net',
            },
        });
        const provider = source === 'vscode' ? mockGetSessionFromVSCode : mockGetManagedIdentityAccessToken;
        provider.mockResolvedValueOnce({ accessToken: 'private-token', account: { label: 'private-account' } });
        const manager =
            surface === 'shell'
                ? new ShellSessionManager({ clusterId, clusterDisplayName: 'Test Cluster', databaseName: 'test' })
                : new PlaygroundEvaluator();
        const postResponse = vi.fn();
        await workerCallbacks.onTokenRequest?.(
            { type: 'tokenRequest', requestId: 'token-request', source },
            postResponse,
        );
        expect(resolver).toHaveBeenCalledWith(connectionString);
        expect(provider.mock.calls.at(-1)?.[0]).toEqual([
            'https://ossrdbms-aad.database.usgovcloudapi.net/.default',
        ]);
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
            const resolver = source === 'vscode' ? resolveInteractiveTokenResource : resolveManagedIdentityTokenResource;
            vi.mocked(resolver).mockRejectedValueOnce(error);
            const manager =
                surface === 'shell'
                    ? new ShellSessionManager({ clusterId, clusterDisplayName: 'Test Cluster', databaseName: 'test' })
                    : new PlaygroundEvaluator();
            const postResponse = vi.fn();
            await workerCallbacks.onTokenRequest?.(
                { type: 'tokenRequest', requestId: 'token-request', source },
                postResponse,
            );
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
    ] as const)('records the cloud and auth method for a failed %s %s token call', async (surface, source): Promise<void> => {
        const resolver = source === 'vscode' ? resolveInteractiveTokenResource : resolveManagedIdentityTokenResource;
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
        const postResponse = vi.fn();

        await workerCallbacks.onTokenRequest?.(
            { type: 'tokenRequest', requestId: 'token-request', source },
            postResponse,
        );

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
    });

    it.each(['shell', 'playground'] as const)(
        'records a failed %s interactive token request when no session is returned',
        async (surface): Promise<void> => {
            mockGetSessionFromVSCode.mockResolvedValueOnce(undefined);
            const manager =
                surface === 'shell'
                    ? new ShellSessionManager({ clusterId, clusterDisplayName: 'Test Cluster', databaseName: 'test' })
                    : new PlaygroundEvaluator();
            const postResponse = vi.fn();

            await workerCallbacks.onTokenRequest?.(
                { type: 'tokenRequest', requestId: 'token-request', source: 'vscode' },
                postResponse,
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
            );

            expect(postResponse).toHaveBeenCalledWith(expect.objectContaining({ type: 'tokenError' }));
            expect(mockGetSessionFromVSCode).not.toHaveBeenCalled();
            expect(getRecentEntraTokenFailure(clusterId)).toBeUndefined();
            manager.dispose();
        },
    );
});
