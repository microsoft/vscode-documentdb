/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Contract tests for ConnectionStorageService.
 *
 * These tests verify the public API contract that consumers depend on.
 * They protect against regressions during future schema upgrades (e.g., v4).
 *
 * Contract guarantees tested:
 * 1. Connection retrieval by ID returns correct data
 * 2. Secrets are properly stored and retrieved
 * 3. getAll() excludes folders (returns only connections)
 * 4. save→get round-trip preserves all fields
 * 5. delete removes item from getAllItems
 */

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { API } from '../DocumentDBExperiences';
import { ConnectionStorageService, ConnectionType, ItemType, type ConnectionItem } from './connectionStorageService';
import { type Storage, type StorageItem } from './storageService';

// In-memory mock storage implementation
class MockStorage implements Storage {
    private items: Map<string, Map<string, StorageItem>> = new Map();

    async getItems<T extends Record<string, unknown>>(workspace: string): Promise<StorageItem<T>[]> {
        const workspaceItems = this.items.get(workspace);
        if (!workspaceItems) {
            return [];
        }
        return Array.from(workspaceItems.values()) as StorageItem<T>[];
    }

    async getItem<T extends Record<string, unknown>>(
        workspace: string,
        storageId: string,
    ): Promise<StorageItem<T> | undefined> {
        const workspaceItems = this.items.get(workspace);
        if (!workspaceItems) {
            return undefined;
        }
        return workspaceItems.get(storageId) as StorageItem<T> | undefined;
    }

    async push<T extends Record<string, unknown>>(
        workspace: string,
        item: StorageItem<T>,
        overwrite: boolean = true,
    ): Promise<void> {
        if (!this.items.has(workspace)) {
            this.items.set(workspace, new Map());
        }
        const workspaceItems = this.items.get(workspace)!;

        if (!overwrite && workspaceItems.has(item.id)) {
            throw new Error(`An item with id "${item.id}" already exists for workspace "${workspace}".`);
        }

        workspaceItems.set(item.id, item as StorageItem);
    }

    async delete(workspace: string, itemId: string): Promise<void> {
        const workspaceItems = this.items.get(workspace);
        if (workspaceItems) {
            workspaceItems.delete(itemId);
        }
    }

    keys(workspace: string): string[] {
        const workspaceItems = this.items.get(workspace);
        if (!workspaceItems) {
            return [];
        }
        return Array.from(workspaceItems.keys());
    }

    clear(): void {
        this.items.clear();
    }
}

// Telemetry context mock
const telemetryContextMock = {
    telemetry: { properties: {}, measurements: {} },
    errorHandling: { issueProperties: {} },
    ui: {
        showWarningMessage: jest.fn(),
        onDidFinishPrompt: jest.fn(),
        showQuickPick: jest.fn(),
        showInputBox: jest.fn(),
        showOpenDialog: jest.fn(),
        showWorkspaceFolderPick: jest.fn(),
    },
    valuesToMask: [],
};

// Mock vscode-azext-utils module
jest.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: jest.fn(
        async (_eventName: string, callback: (context: IActionContext) => Promise<unknown>) => {
            await callback(telemetryContextMock as unknown as IActionContext);
            return undefined;
        },
    ),
    apiUtils: {
        getAzureExtensionApi: jest.fn().mockResolvedValue(undefined),
    },
}));

// Mock vscode module
jest.mock('vscode', () => ({
    l10n: {
        t: jest.fn((str: string) => str),
    },
    extensions: {
        getExtension: jest.fn().mockReturnValue(undefined),
    },
}));

// Create a shared mock storage instance
const mockStorage = new MockStorage();

// Mock storageService module
jest.mock('./storageService', () => ({
    StorageService: {
        get: jest.fn(() => mockStorage),
    },
    StorageNames: {
        Connections: 'connections',
        Default: 'default',
        Global: 'global',
        Workspace: 'workspace',
    },
}));

// Mock extension module
jest.mock('../extension', () => ({
    isVCoreAndRURolloutEnabled: jest.fn().mockResolvedValue(false),
}));

// Mock extensionVariables module
jest.mock('../extensionVariables', () => ({
    ext: {
        context: {
            globalState: {
                get: jest.fn().mockReturnValue(0),
                update: jest.fn().mockResolvedValue(undefined),
            },
        },
        outputChannel: {
            appendLog: jest.fn(),
        },
    },
}));

// Helper to create a complete connection item with all fields
function createCompleteConnectionItem(): ConnectionItem {
    return {
        id: 'contract-test-connection',
        name: 'Contract Test Connection',
        properties: {
            type: ItemType.Connection,
            parentId: undefined,
            api: API.DocumentDB,
            emulatorConfiguration: {
                isEmulator: false,
                disableEmulatorSecurity: false,
            },
            availableAuthMethods: ['NativeAuth', 'MicrosoftEntraID'],
            selectedAuthMethod: 'NativeAuth',
        },
        secrets: {
            connectionString: 'mongodb://contract-test-host:27017/testdb',
            nativeAuthConfig: {
                connectionUser: 'contractUser',
                connectionPassword: 'contractPassword123!',
            },
            entraIdAuthConfig: {
                tenantId: 'tenant-abc-123',
                subscriptionId: 'sub-xyz-456',
            },
        },
    };
}

// Helper to create a folder item
function createFolderItem(): ConnectionItem {
    return {
        id: 'contract-test-folder',
        name: 'Contract Test Folder',
        properties: {
            type: ItemType.Folder,
            parentId: undefined,
            api: API.DocumentDB,
            availableAuthMethods: [],
        },
        secrets: {
            connectionString: '',
        },
    };
}

describe('ConnectionStorageService - Contract Tests', () => {
    beforeEach(() => {
        mockStorage.clear();
        jest.clearAllMocks();

        // Reset the internal storage service cache
        // @ts-expect-error - accessing private static member for testing
        ConnectionStorageService._storageService = undefined;
    });

    describe('Contract: Connection retrieval by ID returns correct data', () => {
        it('should return the exact connection that was saved', async () => {
            const original = createCompleteConnectionItem();

            await ConnectionStorageService.save(ConnectionType.Clusters, original);
            const retrieved = await ConnectionStorageService.get(original.id, ConnectionType.Clusters);

            expect(retrieved).toBeDefined();
            expect(retrieved?.id).toBe(original.id);
            expect(retrieved?.name).toBe(original.name);
        });

        it('should return undefined for non-existent ID', async () => {
            const retrieved = await ConnectionStorageService.get('non-existent-id', ConnectionType.Clusters);
            expect(retrieved).toBeUndefined();
        });

        it('should not return connection from different ConnectionType', async () => {
            const connection = createCompleteConnectionItem();

            await ConnectionStorageService.save(ConnectionType.Clusters, connection);
            const fromEmulators = await ConnectionStorageService.get(connection.id, ConnectionType.Emulators);

            expect(fromEmulators).toBeUndefined();
        });
    });

    describe('Contract: Secrets are properly stored and retrieved', () => {
        it('should preserve connectionString exactly', async () => {
            const original = createCompleteConnectionItem();
            const expectedConnectionString = 'mongodb://special-chars:p@ss!word@host:27017/db?authSource=admin';
            original.secrets.connectionString = expectedConnectionString;

            await ConnectionStorageService.save(ConnectionType.Clusters, original);
            const retrieved = await ConnectionStorageService.get(original.id, ConnectionType.Clusters);

            expect(retrieved?.secrets.connectionString).toBe(expectedConnectionString);
        });

        it('should preserve nativeAuthConfig credentials', async () => {
            const original = createCompleteConnectionItem();

            await ConnectionStorageService.save(ConnectionType.Clusters, original);
            const retrieved = await ConnectionStorageService.get(original.id, ConnectionType.Clusters);

            expect(retrieved?.secrets.nativeAuthConfig?.connectionUser).toBe('contractUser');
            expect(retrieved?.secrets.nativeAuthConfig?.connectionPassword).toBe('contractPassword123!');
        });

        it('should preserve entraIdAuthConfig identifiers', async () => {
            const original = createCompleteConnectionItem();

            await ConnectionStorageService.save(ConnectionType.Clusters, original);
            const retrieved = await ConnectionStorageService.get(original.id, ConnectionType.Clusters);

            expect(retrieved?.secrets.entraIdAuthConfig?.tenantId).toBe('tenant-abc-123');
            expect(retrieved?.secrets.entraIdAuthConfig?.subscriptionId).toBe('sub-xyz-456');
        });

        it('should handle connection with only connectionString (no auth configs)', async () => {
            const minimal: ConnectionItem = {
                id: 'minimal-connection',
                name: 'Minimal Connection',
                properties: {
                    type: ItemType.Connection,
                    parentId: undefined,
                    api: API.DocumentDB,
                    availableAuthMethods: [],
                },
                secrets: {
                    connectionString: 'mongodb://localhost:27017',
                },
            };

            await ConnectionStorageService.save(ConnectionType.Clusters, minimal);
            const retrieved = await ConnectionStorageService.get(minimal.id, ConnectionType.Clusters);

            expect(retrieved?.secrets.connectionString).toBe('mongodb://localhost:27017');
            expect(retrieved?.secrets.nativeAuthConfig).toBeUndefined();
            expect(retrieved?.secrets.entraIdAuthConfig).toBeUndefined();
        });
    });

    describe('Contract: getAll() excludes folders', () => {
        it('should return only connections, not folders', async () => {
            const connection1 = createCompleteConnectionItem();
            connection1.id = 'conn-1';
            const connection2 = createCompleteConnectionItem();
            connection2.id = 'conn-2';
            const folder = createFolderItem();

            await ConnectionStorageService.save(ConnectionType.Clusters, connection1);
            await ConnectionStorageService.save(ConnectionType.Clusters, connection2);
            await ConnectionStorageService.save(ConnectionType.Clusters, folder);

            const allConnections = await ConnectionStorageService.getAll(ConnectionType.Clusters);

            expect(allConnections).toHaveLength(2);
            expect(allConnections.every((c) => c.properties.type === ItemType.Connection)).toBe(true);
            expect(allConnections.some((c) => c.id === 'conn-1')).toBe(true);
            expect(allConnections.some((c) => c.id === 'conn-2')).toBe(true);
        });

        it('should return empty array when only folders exist', async () => {
            const folder1 = createFolderItem();
            folder1.id = 'folder-1';
            const folder2 = createFolderItem();
            folder2.id = 'folder-2';

            await ConnectionStorageService.save(ConnectionType.Clusters, folder1);
            await ConnectionStorageService.save(ConnectionType.Clusters, folder2);

            const allConnections = await ConnectionStorageService.getAll(ConnectionType.Clusters);

            expect(allConnections).toHaveLength(0);
        });
    });

    describe('Contract: save→get round-trip preserves all fields', () => {
        it('should preserve all properties fields', async () => {
            const original = createCompleteConnectionItem();

            await ConnectionStorageService.save(ConnectionType.Clusters, original);
            const retrieved = await ConnectionStorageService.get(original.id, ConnectionType.Clusters);

            expect(retrieved?.properties.type).toBe(original.properties.type);
            expect(retrieved?.properties.parentId).toBe(original.properties.parentId);
            expect(retrieved?.properties.api).toBe(original.properties.api);
            expect(retrieved?.properties.availableAuthMethods).toEqual(original.properties.availableAuthMethods);
            expect(retrieved?.properties.selectedAuthMethod).toBe(original.properties.selectedAuthMethod);
            expect(retrieved?.properties.emulatorConfiguration?.isEmulator).toBe(
                original.properties.emulatorConfiguration?.isEmulator,
            );
            expect(retrieved?.properties.emulatorConfiguration?.disableEmulatorSecurity).toBe(
                original.properties.emulatorConfiguration?.disableEmulatorSecurity,
            );
        });

        it('should preserve parentId for nested items', async () => {
            const folder = createFolderItem();
            const nestedConnection = createCompleteConnectionItem();
            nestedConnection.id = 'nested-conn';
            nestedConnection.properties.parentId = folder.id;

            await ConnectionStorageService.save(ConnectionType.Clusters, folder);
            await ConnectionStorageService.save(ConnectionType.Clusters, nestedConnection);

            const retrieved = await ConnectionStorageService.get(nestedConnection.id, ConnectionType.Clusters);

            expect(retrieved?.properties.parentId).toBe(folder.id);
        });

        it('should preserve emulator configuration', async () => {
            const emulator: ConnectionItem = {
                id: 'emulator-conn',
                name: 'Emulator Connection',
                properties: {
                    type: ItemType.Connection,
                    parentId: undefined,
                    api: API.DocumentDB,
                    emulatorConfiguration: {
                        isEmulator: true,
                        disableEmulatorSecurity: true,
                    },
                    availableAuthMethods: ['NativeAuth'],
                    selectedAuthMethod: 'NativeAuth',
                },
                secrets: {
                    connectionString: 'mongodb://localhost:10255',
                },
            };

            await ConnectionStorageService.save(ConnectionType.Emulators, emulator);
            const retrieved = await ConnectionStorageService.get(emulator.id, ConnectionType.Emulators);

            expect(retrieved?.properties.emulatorConfiguration?.isEmulator).toBe(true);
            expect(retrieved?.properties.emulatorConfiguration?.disableEmulatorSecurity).toBe(true);
        });
    });

    describe('Contract: delete removes item from getAllItems', () => {
        it('should remove connection from storage', async () => {
            const connection = createCompleteConnectionItem();

            await ConnectionStorageService.save(ConnectionType.Clusters, connection);
            expect(await ConnectionStorageService.get(connection.id, ConnectionType.Clusters)).toBeDefined();

            await ConnectionStorageService.delete(ConnectionType.Clusters, connection.id);

            expect(await ConnectionStorageService.get(connection.id, ConnectionType.Clusters)).toBeUndefined();
            const allItems = await ConnectionStorageService.getAllItems(ConnectionType.Clusters);
            expect(allItems.some((i) => i.id === connection.id)).toBe(false);
        });

        it('should remove folder from storage', async () => {
            const folder = createFolderItem();

            await ConnectionStorageService.save(ConnectionType.Clusters, folder);
            expect(await ConnectionStorageService.get(folder.id, ConnectionType.Clusters)).toBeDefined();

            await ConnectionStorageService.delete(ConnectionType.Clusters, folder.id);

            expect(await ConnectionStorageService.get(folder.id, ConnectionType.Clusters)).toBeUndefined();
        });

        it('should not affect other items when deleting one', async () => {
            const conn1 = createCompleteConnectionItem();
            conn1.id = 'conn-to-keep-1';
            const conn2 = createCompleteConnectionItem();
            conn2.id = 'conn-to-delete';
            const conn3 = createCompleteConnectionItem();
            conn3.id = 'conn-to-keep-2';

            await ConnectionStorageService.save(ConnectionType.Clusters, conn1);
            await ConnectionStorageService.save(ConnectionType.Clusters, conn2);
            await ConnectionStorageService.save(ConnectionType.Clusters, conn3);

            await ConnectionStorageService.delete(ConnectionType.Clusters, conn2.id);

            const remaining = await ConnectionStorageService.getAllItems(ConnectionType.Clusters);
            expect(remaining).toHaveLength(2);
            expect(remaining.some((c) => c.id === 'conn-to-keep-1')).toBe(true);
            expect(remaining.some((c) => c.id === 'conn-to-keep-2')).toBe(true);
            expect(remaining.some((c) => c.id === 'conn-to-delete')).toBe(false);
        });
    });

    describe('Contract: ItemType discrimination', () => {
        it('should correctly identify connections by type', async () => {
            const connection = createCompleteConnectionItem();

            await ConnectionStorageService.save(ConnectionType.Clusters, connection);
            const retrieved = await ConnectionStorageService.get(connection.id, ConnectionType.Clusters);

            expect(retrieved?.properties.type).toBe(ItemType.Connection);
        });

        it('should correctly identify folders by type', async () => {
            const folder = createFolderItem();

            await ConnectionStorageService.save(ConnectionType.Clusters, folder);
            const retrieved = await ConnectionStorageService.get(folder.id, ConnectionType.Clusters);

            expect(retrieved?.properties.type).toBe(ItemType.Folder);
        });
    });
});
