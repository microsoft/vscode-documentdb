/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AuthenticationSession } from 'vscode';
import { AuthMethodId } from '../auth/AuthMethod';
import { CredentialCache } from '../CredentialCache';
import { type WorkerSessionCallbacks } from '../playground/WorkerSessionManager';
import { type MainToWorkerMessage, type WorkerToMainMessage } from '../playground/workerTypes';
import { ShellSessionManager } from './ShellSessionManager';

const mockGetSessionFromVSCode = jest.fn();
let workerCallbacks: WorkerSessionCallbacks;

jest.mock('@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode', () => ({
    getSessionFromVSCode: (...args: unknown[]) => mockGetSessionFromVSCode(...args),
}));

jest.mock('../playground/WorkerSessionManager', () => ({
    WorkerSessionManager: jest.fn().mockImplementation((callbacks: WorkerSessionCallbacks) => {
        workerCallbacks = callbacks;
        return {
            ensureWorker: jest.fn(
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
            dispose: jest.fn(),
        };
    }),
}));

describe('ShellSessionManager', () => {
    const clusterId = 'test-cluster-id';

    beforeEach(() => {
        jest.clearAllMocks();
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
});
