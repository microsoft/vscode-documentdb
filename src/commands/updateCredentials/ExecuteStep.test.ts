/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { ExecuteStep } from './ExecuteStep';

const mockGet = jest.fn();
const mockSave = jest.fn();

jest.mock('../../services/connectionStorageService', () => {
    const actual = jest.requireActual('../../services/connectionStorageService');
    return {
        ...actual,
        ConnectionStorageService: {
            get: (...args: unknown[]) => mockGet(...args),
            save: (...args: unknown[]) => mockSave(...args),
        },
    };
});

jest.mock('../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            error: jest.fn(),
            trace: jest.fn(),
            warn: jest.fn(),
        },
    },
}));

jest.mock('../../utils/dialogs/showConfirmation', () => ({
    showConfirmationAsInSettings: jest.fn(),
}));

const HOST = 'a11y-reviews-documentdb-vscode.mongocluster.cosmos.azure.com';

interface StoredSecrets {
    connectionString: string;
    nativeAuthConfig?: { connectionUser: string; connectionPassword: string };
    entraIdAuthConfig?: { tenantId: string; subscriptionId: string };
}

/** Builds an existing stored connection that still carries native + Entra secrets. */
function existingConnectionWithSecrets(): {
    id: string;
    name: string;
    properties: Record<string, unknown>;
    secrets: StoredSecrets;
} {
    return {
        id: 'existing-id',
        name: HOST,
        properties: { type: 'connection', api: 'MongoDB Clusters', selectedAuthMethod: AuthMethodId.NativeAuth },
        secrets: {
            connectionString: `mongodb://${HOST}/`,
            nativeAuthConfig: { connectionUser: 'a11y', connectionPassword: 'pw' },
            entraIdAuthConfig: { tenantId: 'tenant-1', subscriptionId: 'sub-1' },
        },
    };
}

function makeContext(authMethod: AuthMethodId): Record<string, unknown> {
    return {
        isEmulator: false,
        storageId: 'existing-id',
        selectedAuthenticationMethod: authMethod,
        availableAuthenticationMethods: [authMethod],
        nativeAuthConfig: undefined,
        entraIdAuthConfig: undefined,
        telemetry: { properties: {}, measurements: {} },
    };
}

function savedSecrets(): StoredSecrets {
    const storageItem = mockSave.mock.calls[0][1] as { secrets: StoredSecrets };
    return storageItem.secrets;
}

describe('updateCredentials ExecuteStep — clearing stale secrets on auth-method change', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSave.mockResolvedValue(undefined);
    });

    it('clears stale native and Entra secrets when switching to No Authentication', async () => {
        mockGet.mockResolvedValue(existingConnectionWithSecrets());

        const step = new ExecuteStep();
        await step.execute(makeContext(AuthMethodId.NoAuth) as never);

        expect(mockSave).toHaveBeenCalledTimes(1);
        // Anonymous connections must be credential-free: both prior secrets are dropped.
        expect(savedSecrets().nativeAuthConfig).toBeUndefined();
        expect(savedSecrets().entraIdAuthConfig).toBeUndefined();
        // The embedded credentials are stripped from the connection string too.
        expect(savedSecrets().connectionString).not.toContain('@');
    });

    it('clears stale native secrets when switching from Entra ID to No Authentication', async () => {
        const existing = existingConnectionWithSecrets();
        existing.properties.selectedAuthMethod = AuthMethodId.MicrosoftEntraID;
        mockGet.mockResolvedValue(existing);

        const step = new ExecuteStep();
        await step.execute(makeContext(AuthMethodId.NoAuth) as never);

        expect(mockSave).toHaveBeenCalledTimes(1);
        expect(savedSecrets().nativeAuthConfig).toBeUndefined();
        expect(savedSecrets().entraIdAuthConfig).toBeUndefined();
        expect(savedSecrets().connectionString).not.toContain('@');
    });
});
