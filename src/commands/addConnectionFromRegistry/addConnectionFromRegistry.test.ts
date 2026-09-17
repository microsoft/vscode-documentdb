/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const mockSave = jest.fn();
const mockGetAll = jest.fn();

jest.mock('vscode', () => {
    const vscode = {
        l10n: { t: (message: string): string => message },
        ThemeIcon: class ThemeIcon {
            constructor(public readonly id: string) {}
        },
        ThemeColor: class ThemeColor {
            constructor(public readonly id: string) {}
        },
        window: { showInformationMessage: jest.fn() },
    };

    return { __esModule: true, ...vscode, default: vscode };
});

jest.mock('@vscode/l10n', () => ({
    t: (message: string): string => message,
}));

jest.mock('../../extensionVariables', () => ({
    ext: {
        state: {
            runWithTemporaryDescription: jest.fn(
                async (_id: string, _description: string, callback: () => Promise<unknown>) => callback(),
            ),
        },
        connectionsBranchDataProvider: { refresh: jest.fn() },
    },
}));

jest.mock('../../services/connectionStorageService', () => ({
    ConnectionStorageService: {
        getAll: (...args: unknown[]) => mockGetAll(...args),
        save: (...args: unknown[]) => mockSave(...args),
    },
    ConnectionType: { Clusters: 'Clusters' },
    ItemType: { Connection: 'connection' },
}));

jest.mock('../../tree/connections-view/connectionsViewHelpers', () => ({
    buildConnectionsViewTreePath: jest.fn(() => 'connections/path'),
    buildFullTreePath: jest.fn(),
    focusAndRevealInConnectionsView: jest.fn(),
    withConnectionsViewProgress: jest.fn(async (callback: () => Promise<unknown>) => callback()),
}));

jest.mock('../../utils/dialogs/showConfirmation', () => ({
    showConfirmationAsInSettings: jest.fn(),
}));

jest.mock('../../utils/storageUtils', () => ({
    generateDocumentDBStorageId: jest.fn(() => 'storage-id'),
}));

import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { addConnectionFromRegistry } from './addConnectionFromRegistry';

describe('addConnectionFromRegistry authentication secrets', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetAll.mockResolvedValue([]);
        mockSave.mockResolvedValue(undefined);
    });

    it('does not persist seeded managed identity config for an Entra connection', async () => {
        const context = {
            telemetry: { properties: {}, measurements: {} },
            errorHandling: {},
            valuesToMask: [],
        };
        const node = {
            id: 'azure-cluster',
            contextValue: 'discoveryCluster',
            cluster: { name: 'Azure cluster' },
            experience: { api: 'DocumentDB' },
            getCredentials: jest.fn().mockResolvedValue({
                connectionString: 'mongodb://example.test:27017/',
                availableAuthMethods: [AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity],
                selectedAuthMethod: AuthMethodId.MicrosoftEntraID,
                entraIdAuthConfig: { tenantId: 'tenant', subscriptionId: 'subscription' },
                managedIdentityAuthConfig: { tenantId: 'tenant' },
            }),
        };

        await addConnectionFromRegistry(context as never, node as never);

        const savedConnection = mockSave.mock.calls[0][1] as {
            secrets: { managedIdentityAuthConfig?: unknown };
        };
        expect(savedConnection.secrets.managedIdentityAuthConfig).toBeUndefined();
    });
});