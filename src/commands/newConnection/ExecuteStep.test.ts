/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { ExecuteStep } from './ExecuteStep';

const mockGetAll = jest.fn();
const mockSave = jest.fn();

jest.mock('../../services/connectionStorageService', () => {
    const actual = jest.requireActual('../../services/connectionStorageService');
    return {
        ...actual,
        ConnectionStorageService: {
            getAll: (...args: unknown[]) => mockGetAll(...args),
            save: (...args: unknown[]) => mockSave(...args),
        },
    };
});

jest.mock('../../tree/connections-view/connectionsViewHelpers', () => ({
    withConnectionsViewProgress: (callback: () => Promise<unknown>) => callback(),
    buildFullTreePath: jest.fn().mockResolvedValue('connectionsView/existing-id'),
    buildConnectionsViewTreePath: jest.fn().mockReturnValue('connectionsView/new-id'),
    focusAndRevealInConnectionsView: jest.fn().mockResolvedValue(undefined),
    refreshParentInConnectionsView: jest.fn(),
}));

jest.mock('../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            trace: jest.fn(),
            warn: jest.fn(),
        },
    },
}));

jest.mock('../../utils/dialogs/showConfirmation', () => ({
    showConfirmationAsInSettings: jest.fn(),
}));

jest.mock('../../plugins/service-kubernetes/portForwardMetadata', () => ({
    getKubernetesPortForwardMetadata: () => undefined,
    getKubernetesPortForwardIdentity: () => undefined,
}));

const HOST = 'a11y-reviews-documentdb-vscode.mongocluster.cosmos.azure.com';

interface StoredSecrets {
    connectionString: string;
    nativeAuthConfig?: { connectionUser: string; connectionPassword: string };
    entraIdAuthConfig?: { tenantId: string; subscriptionId: string };
}

function existingNativeConnection(): { id: string; name: string; properties: object; secrets: StoredSecrets } {
    return {
        id: 'existing-id',
        name: `a11y@${HOST}`,
        properties: { type: 'connection', api: 'MongoDB Clusters' },
        // Stored connection strings are always credential-free; the username lives in nativeAuthConfig.
        secrets: {
            connectionString: `mongodb://${HOST}/`,
            nativeAuthConfig: { connectionUser: 'a11y', connectionPassword: 'pw' },
        },
    };
}

function existingNoAuthConnection(): { id: string; name: string; properties: object; secrets: StoredSecrets } {
    return {
        id: 'existing-noauth-id',
        name: HOST,
        properties: { type: 'connection', api: 'MongoDB Clusters' },
        secrets: {
            connectionString: `mongodb://${HOST}/`,
        },
    };
}

/**
 * Builds a wizard context that mirrors the real flow: the connection string has already been
 * stripped of credentials by PromptConnectionStringStep, while the pasted username/password are
 * preserved in nativeAuthConfig regardless of the auth method the user ends up choosing.
 */
function makeContext(authMethod: AuthMethodId): Record<string, unknown> {
    return {
        parentId: '',
        connectionString: `mongodb://${HOST}/`,
        nativeAuthConfig: { connectionUser: 'a11y', connectionPassword: 'pw' },
        selectedAuthenticationMethod: authMethod,
        availableAuthenticationMethods: [authMethod],
        entraIdAuthConfig:
            authMethod === AuthMethodId.MicrosoftEntraID
                ? { tenantId: 'tenant-1', subscriptionId: 'sub-1' }
                : undefined,
        connectionProperties: undefined,
        telemetry: { properties: {}, measurements: {} },
    };
}

function savedSecrets(): StoredSecrets {
    const storageItem = mockSave.mock.calls[0][1] as { secrets: StoredSecrets };
    return storageItem.secrets;
}

describe('newConnection ExecuteStep — credential-free auth methods', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSave.mockResolvedValue(undefined);
    });

    it('does NOT treat a pasted username as a duplicate when "No Authentication" is selected', async () => {
        // Regression: pasting a connection string with a username, then choosing No Authentication,
        // previously matched an existing native connection (same host + username) and was blocked.
        mockGetAll.mockResolvedValue([existingNativeConnection()]);

        const step = new ExecuteStep();
        await expect(step.execute(makeContext(AuthMethodId.NoAuth) as never)).resolves.toBeUndefined();

        expect(mockSave).toHaveBeenCalledTimes(1);
        // No credentials are leaked into storage for an anonymous connection.
        expect(savedSecrets().nativeAuthConfig).toBeUndefined();
        expect(savedSecrets().connectionString).toBe(`mongodb://${HOST}/`);
    });

    it('does NOT leak pasted credentials and does NOT false-duplicate when Microsoft Entra ID is selected', async () => {
        mockGetAll.mockResolvedValue([existingNativeConnection()]);

        const step = new ExecuteStep();
        await expect(step.execute(makeContext(AuthMethodId.MicrosoftEntraID) as never)).resolves.toBeUndefined();

        expect(mockSave).toHaveBeenCalledTimes(1);
        // Entra ID connections are credential-free: no native username/password persisted.
        expect(savedSecrets().nativeAuthConfig).toBeUndefined();
        expect(savedSecrets().entraIdAuthConfig).toEqual({ tenantId: 'tenant-1', subscriptionId: 'sub-1' });
    });

    it('still detects duplicates between two anonymous connections to the same host', async () => {
        mockGetAll.mockResolvedValue([existingNoAuthConnection()]);

        const step = new ExecuteStep();
        await expect(step.execute(makeContext(AuthMethodId.NoAuth) as never)).rejects.toThrow(
            'A connection with the same username and host already exists.',
        );
        expect(mockSave).not.toHaveBeenCalled();
    });

    it('preserves native duplicate detection for the Native authentication method', async () => {
        mockGetAll.mockResolvedValue([existingNativeConnection()]);

        const step = new ExecuteStep();
        await expect(step.execute(makeContext(AuthMethodId.NativeAuth) as never)).rejects.toThrow(
            'A connection with the same username and host already exists.',
        );
        expect(mockSave).not.toHaveBeenCalled();
    });

    it('persists native credentials for a new Native authentication connection', async () => {
        mockGetAll.mockResolvedValue([]);

        const step = new ExecuteStep();
        await expect(step.execute(makeContext(AuthMethodId.NativeAuth) as never)).resolves.toBeUndefined();

        expect(mockSave).toHaveBeenCalledTimes(1);
        expect(savedSecrets().nativeAuthConfig).toEqual({ connectionUser: 'a11y', connectionPassword: 'pw' });
    });
});
