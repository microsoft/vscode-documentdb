/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const getSessionFromVSCode = jest.fn();
const mockOutputChannel = { info: jest.fn(), error: jest.fn() };
jest.mock('../../extensionVariables', () => ({
    ext: { get outputChannel(): typeof mockOutputChannel { return mockOutputChannel; } },
}));

jest.mock('@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode', () => ({
    getSessionFromVSCode: (...args: unknown[]) => getSessionFromVSCode(...args),
}));

import { type CachedClusterCredentials } from '../CredentialCache';
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
        jest.clearAllMocks();
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
});
