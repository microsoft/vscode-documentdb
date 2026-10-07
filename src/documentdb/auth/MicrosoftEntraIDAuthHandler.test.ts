/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSessionFromVSCode = vi.fn();
const mockOutputChannel = { info: vi.fn(), error: vi.fn() };
vi.mock('../../extensionVariables', () => ({
    ext: {
        get outputChannel(): typeof mockOutputChannel {
            return mockOutputChannel;
        },
    },
}));

vi.mock('@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode', () => ({
    getSessionFromVSCode: (...args: unknown[]) => getSessionFromVSCode(...args),
}));

import { type CachedClusterCredentials } from '../CredentialCache';
import { ConnectionStartupTimings } from '../utils/ConnectionStartupTimings';
import { AuthMethodId } from './AuthMethod';
import { MicrosoftEntraIDAuthHandler } from './MicrosoftEntraIDAuthHandler';

function buildCredentials(connectionString: string): CachedClusterCredentials {
    return {
        clusterId: 'cluster-1',
        connectionString,
        connectionStringWithPassword: connectionString,
        authMechanism: AuthMethodId.MicrosoftEntraID,
        entraIdConfig: { tenantId: 'tenant' },
    };
}

describe('MicrosoftEntraIDAuthHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getSessionFromVSCode.mockReset();
        getSessionFromVSCode.mockResolvedValue({ accessToken: 'access-token' });
    });

    it('strips credentials and stale OIDC markers from the connection string', async () => {
        const connectionString =
            'mongodb+srv://managed-identity@my-cluster.mongocluster.cosmos.azure.com/' +
            '?authMechanism=MONGODB-OIDC&authMechanismProperties=ENVIRONMENT:azure&retryWrites=true';

        const result = await new MicrosoftEntraIDAuthHandler(buildCredentials(connectionString)).configureAuth();

        expect(result.connectionString).not.toContain('managed-identity');
        expect(result.connectionString).not.toContain('authMechanism');
        expect(result.connectionString).not.toContain('authMechanismProperties');
        expect(result.connectionString).toContain('retryWrites=true');
        expect(result.options.authMechanismProperties).toHaveProperty('OIDC_CALLBACK');
        const output = JSON.stringify(mockOutputChannel.info.mock.calls);
        expect(output).toContain('interactiveEntra.getSession');
        expect(output).not.toContain('access-token');
        expect(output).not.toContain('my-cluster');
    });

    it('logs interactive authentication failure without the raw message', async () => {
        getSessionFromVSCode.mockRejectedValueOnce(new Error('secret-token'));
        const handler = new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://localhost:27017/'));

        await expect(handler.configureAuth()).rejects.toThrow('secret-token');

        expect(JSON.stringify(mockOutputChannel.error.mock.calls)).toContain('interactiveEntra.getSession');
        expect(JSON.stringify(mockOutputChannel.error.mock.calls)).not.toContain('secret-token');
    });

    it('measures the actual session request separately from database connection work', async () => {
        let now = 0;
        const timings = new ConnectionStartupTimings(() => now);
        getSessionFromVSCode.mockImplementationOnce(async () => {
            now = 25;
            return { accessToken: 'access-token' };
        });
        const handler = new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://localhost:27017/'));
        await handler.configureAuth(timings);
        const stopDatabase = timings.startDatabaseConnect();
        now = 65;
        stopDatabase();

        expect(timings.finish()).toEqual({ tokenAcquireDurationMs: 25, databaseConnectDurationMs: 40 });
    });

    it('retains token-acquisition time when the session request fails', async () => {
        let now = 0;
        const timings = new ConnectionStartupTimings(() => now);
        const error = new Error('private-token');
        getSessionFromVSCode.mockImplementationOnce(async () => {
            now = 30;
            throw error;
        });
        const handler = new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://localhost:27017/'));

        await expect(handler.configureAuth(timings)).rejects.toBe(error);
        expect(timings.finish()).toEqual({ tokenAcquireDurationMs: 30 });
    });
});
