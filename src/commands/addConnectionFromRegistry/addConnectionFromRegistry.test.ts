/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSave = vi.fn();
const mockGetAll = vi.fn();

vi.mock('vscode', () => {
    const vscode = {
        l10n: { t: (message: string): string => message },
        ThemeIcon: class ThemeIcon {
            constructor(public readonly id: string) {}
        },
        ThemeColor: class ThemeColor {
            constructor(public readonly id: string) {}
        },
        window: { showInformationMessage: vi.fn() },
    };

    return { __esModule: true, ...vscode, default: vscode };
});

vi.mock('@vscode/l10n', () => ({
    t: (message: string): string => message,
}));

vi.mock('../../extensionVariables', () => ({
    ext: {
        state: {
            runWithTemporaryDescription: vi.fn(
                async (_id: string, _description: string, callback: () => Promise<unknown>) => callback(),
            ),
        },
        connectionsBranchDataProvider: { refresh: vi.fn() },
    },
}));

vi.mock('../../services/connectionStorageService', () => ({
    ConnectionStorageService: {
        getAll: (...args: unknown[]) => mockGetAll(...args),
        save: (...args: unknown[]) => mockSave(...args),
    },
    ConnectionType: { Clusters: 'Clusters' },
    ItemType: { Connection: 'connection' },
}));

vi.mock('../../tree/connections-view/connectionsViewHelpers', () => ({
    buildConnectionsViewTreePath: vi.fn(() => 'connections/path'),
    buildFullTreePath: vi.fn(),
    focusAndRevealInConnectionsView: vi.fn(),
    withConnectionsViewProgress: vi.fn(async (callback: () => Promise<unknown>) => callback()),
}));

vi.mock('../../utils/dialogs/showConfirmation', () => ({
    showConfirmationAsInSettings: vi.fn(),
}));

vi.mock('../../utils/storageUtils', () => ({
    generateDocumentDBStorageId: vi.fn(() => 'storage-id'),
}));

import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { addConnectionFromRegistry } from './addConnectionFromRegistry';

describe('addConnectionFromRegistry authentication secrets', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
            getCredentials: vi.fn().mockResolvedValue({
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
