/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AuthenticationSession } from 'vscode';
import { AuthMethodId } from '../auth/AuthMethod';
import { CredentialCache } from '../CredentialCache';
import { PlaygroundEvaluator } from '../playground/PlaygroundEvaluator';
import { type WorkerSessionCallbacks } from '../playground/WorkerSessionManager';
import { type MainToWorkerMessage, type WorkerToMainMessage } from '../playground/workerTypes';
import { ConnectionStartupTimings } from '../utils/ConnectionStartupTimings';
import { ShellSessionManager } from './ShellSessionManager';

const mockGetSessionFromVSCode = vi.fn();
const mockGetManagedIdentityAccessToken = vi.fn();
let workerCallbacks: WorkerSessionCallbacks;

vi.mock('@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode', () => ({
    getSessionFromVSCode: (...args: unknown[]) => mockGetSessionFromVSCode(...args),
}));

vi.mock('../auth/managedIdentityTokenProvider', () => ({
    getManagedIdentityAccessToken: (...args: unknown[]) => mockGetManagedIdentityAccessToken(...args),
}));

vi.mock('../playground/WorkerSessionManager', () => ({
    WorkerSessionManager: vi.fn().mockImplementation(function (callbacks: WorkerSessionCallbacks) {
        workerCallbacks = callbacks;
        return {
            ensureWorker: vi.fn(
                async (_clusterId: string, initMessage: MainToWorkerMessage & { type: 'init' }): Promise<void> => {
                    if (initMessage.authMechanism !== 'MicrosoftEntraID') {
                        return;
                    }

                    const tokenRequest: Extract<WorkerToMainMessage, { type: 'tokenRequest' }> = {
                        type: 'tokenRequest',
                        requestId: 'token-request',
                        scopes: ['scope'],
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
            dispose: vi.fn(),
        };
    }),
}));

describe('ShellSessionManager', () => {
    const clusterId = 'test-cluster-id';

    beforeEach(() => {
        vi.clearAllMocks();
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
        await workerCallbacks.onTokenRequest?.(
            { type: 'tokenRequest', requestId: 'token-request', scopes: ['scope'], source },
            postResponse,
            timings,
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
        expect(timings.finish()).toEqual({
            databaseConnectDurationMs: 25,
            tokenAcquireDurationMs: 25,
            tokenRelayDurationMs: 10,
        });
        manager.dispose();
    });
});
