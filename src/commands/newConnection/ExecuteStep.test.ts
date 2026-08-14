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
    entraIdAuthConfig?: { tenantId?: string; subscriptionId?: string };
    managedIdentityAuthConfig?: { clientId?: string };
}

interface StoredConnection {
    id: string;
    name: string;
    properties: object;
    secrets: StoredSecrets;
}

function existingNativeConnection(): StoredConnection {
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

function existingNoAuthConnection(): StoredConnection {
    return {
        id: 'existing-noauth-id',
        name: HOST,
        properties: { type: 'connection', api: 'MongoDB Clusters' },
        secrets: {
            connectionString: `mongodb://${HOST}/`,
        },
    };
}

function existingManagedIdentityConnection(clientId?: string): StoredConnection {
    return {
        id: `existing-mi-${clientId ?? 'system'}`,
        name: HOST,
        properties: {
            type: 'connection',
            api: 'MongoDB Clusters',
            selectedAuthMethod: AuthMethodId.ManagedIdentity,
        },
        secrets: {
            connectionString: `mongodb://${HOST}/`,
            managedIdentityAuthConfig: clientId ? { clientId } : {},
        },
    };
}

function existingEntraIdConnection(tenantId: string): StoredConnection {
    return {
        id: `existing-entra-${tenantId}`,
        name: HOST,
        properties: {
            type: 'connection',
            api: 'MongoDB Clusters',
            selectedAuthMethod: AuthMethodId.MicrosoftEntraID,
        },
        secrets: {
            connectionString: `mongodb://${HOST}/`,
            entraIdAuthConfig: { tenantId, subscriptionId: 'sub-1' },
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
            'A connection to the same host with the same authentication settings already exists.',
        );
        expect(mockSave).not.toHaveBeenCalled();
    });

    it('preserves native duplicate detection for the Native authentication method', async () => {
        mockGetAll.mockResolvedValue([existingNativeConnection()]);

        const step = new ExecuteStep();
        await expect(step.execute(makeContext(AuthMethodId.NativeAuth) as never)).rejects.toThrow(
            'A connection to the same host with the same authentication settings already exists.',
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

    it('does NOT persist stale Entra config when the user changed the method to No Authentication', async () => {
        // Regression: if the user picked Entra ID first and then backtracked to No Authentication,
        // the wizard context may still hold entraIdAuthConfig. It must not be saved onto a
        // credential-free connection.
        mockGetAll.mockResolvedValue([]);

        const context = makeContext(AuthMethodId.NoAuth);
        context.entraIdAuthConfig = { tenantId: 'stale-tenant', subscriptionId: 'stale-sub' };

        const step = new ExecuteStep();
        await expect(step.execute(context as never)).resolves.toBeUndefined();

        expect(mockSave).toHaveBeenCalledTimes(1);
        expect(savedSecrets().nativeAuthConfig).toBeUndefined();
        expect(savedSecrets().entraIdAuthConfig).toBeUndefined();
    });

    it('does NOT persist stale Entra config when the user changed the method to Native authentication', async () => {
        mockGetAll.mockResolvedValue([]);

        const context = makeContext(AuthMethodId.NativeAuth);
        context.entraIdAuthConfig = { tenantId: 'stale-tenant', subscriptionId: 'stale-sub' };

        const step = new ExecuteStep();
        await expect(step.execute(context as never)).resolves.toBeUndefined();

        expect(mockSave).toHaveBeenCalledTimes(1);
        expect(savedSecrets().entraIdAuthConfig).toBeUndefined();
        expect(savedSecrets().nativeAuthConfig).toEqual({ connectionUser: 'a11y', connectionPassword: 'pw' });
    });
});

describe('newConnection ExecuteStep — duplicate detection compares the authentication identity', () => {
    const CLIENT_ID_A = '11111111-2222-3333-4444-555555555555';
    const CLIENT_ID_B = '99999999-8888-7777-6666-555555555555';

    beforeEach(() => {
        jest.clearAllMocks();
        mockSave.mockResolvedValue(undefined);
    });

    function managedIdentityContext(clientId?: string): Record<string, unknown> {
        const context = makeContext(AuthMethodId.ManagedIdentity);
        context.nativeAuthConfig = undefined;
        context.managedIdentityAuthConfig = clientId ? { clientId } : {};
        return context;
    }

    it('allows a second managed identity on the same host when the client ID differs', async () => {
        mockGetAll.mockResolvedValue([existingManagedIdentityConnection(CLIENT_ID_A)]);

        const step = new ExecuteStep();
        await expect(step.execute(managedIdentityContext(CLIENT_ID_B) as never)).resolves.toBeUndefined();

        expect(mockSave).toHaveBeenCalledTimes(1);
        expect(savedSecrets().managedIdentityAuthConfig).toEqual({ clientId: CLIENT_ID_B });
    });

    it('blocks a second managed identity on the same host with the same client ID', async () => {
        mockGetAll.mockResolvedValue([existingManagedIdentityConnection(CLIENT_ID_A)]);

        const step = new ExecuteStep();
        await expect(step.execute(managedIdentityContext(CLIENT_ID_A) as never)).rejects.toThrow(
            'A connection to the same host with the same authentication settings already exists.',
        );
        expect(mockSave).not.toHaveBeenCalled();
    });

    it('treats the system-assigned identity as its own identity, distinct from a user-assigned one', async () => {
        mockGetAll.mockResolvedValue([existingManagedIdentityConnection(CLIENT_ID_A)]);

        const step = new ExecuteStep();
        await expect(step.execute(managedIdentityContext() as never)).resolves.toBeUndefined();

        expect(mockSave).toHaveBeenCalledTimes(1);
        expect(savedSecrets().managedIdentityAuthConfig).toEqual({});
    });

    it('blocks a second system-assigned managed identity on the same host', async () => {
        mockGetAll.mockResolvedValue([existingManagedIdentityConnection()]);

        const step = new ExecuteStep();
        await expect(step.execute(managedIdentityContext() as never)).rejects.toThrow(
            'A connection to the same host with the same authentication settings already exists.',
        );
        expect(mockSave).not.toHaveBeenCalled();
    });

    it('allows the same host with Entra ID in a different tenant', async () => {
        mockGetAll.mockResolvedValue([existingEntraIdConnection('tenant-2')]);

        const step = new ExecuteStep();
        await expect(step.execute(makeContext(AuthMethodId.MicrosoftEntraID) as never)).resolves.toBeUndefined();

        expect(mockSave).toHaveBeenCalledTimes(1);
    });

    it('blocks the same host with Entra ID in the same tenant', async () => {
        mockGetAll.mockResolvedValue([existingEntraIdConnection('tenant-1')]);

        const step = new ExecuteStep();
        await expect(step.execute(makeContext(AuthMethodId.MicrosoftEntraID) as never)).rejects.toThrow(
            'A connection to the same host with the same authentication settings already exists.',
        );
        expect(mockSave).not.toHaveBeenCalled();
    });

    it('does not confuse a managed identity with an Entra ID connection on the same host', async () => {
        mockGetAll.mockResolvedValue([existingEntraIdConnection('tenant-1')]);

        const step = new ExecuteStep();
        await expect(step.execute(managedIdentityContext(CLIENT_ID_A) as never)).resolves.toBeUndefined();

        expect(mockSave).toHaveBeenCalledTimes(1);
    });
});
