/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { API } from '../DocumentDBExperiences';
import {
    ConnectionStorageService,
    ConnectionType,
    FOLDER_PLACEHOLDER_CONNECTION_STRING,
    ItemType,
    type ConnectionItem,
    type ConnectionProperties,
} from './connectionStorageService';
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

    // Helper method to clear all storage for tests
    clear(): void {
        this.items.clear();
    }

    // Helper method to directly set items for test setup
    setItem<T extends Record<string, unknown>>(workspace: string, item: StorageItem<T>): void {
        if (!this.items.has(workspace)) {
            this.items.set(workspace, new Map());
        }
        this.items.get(workspace)!.set(item.id, item as StorageItem);
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

// Mock extension module (for isVCoreAndRURolloutEnabled)
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

// Helper function to create a test connection item
function createTestConnectionItem(
    overrides: {
        id?: string;
        name?: string;
        parentId?: string;
        secrets?: ConnectionItem['secrets'];
    } = {},
): ConnectionItem {
    return {
        id: overrides.id ?? 'test-connection-id',
        name: overrides.name ?? 'Test Connection',
        properties: {
            type: ItemType.Connection,
            parentId: overrides.parentId,
            api: API.DocumentDB,
            emulatorConfiguration: {
                isEmulator: false,
                disableEmulatorSecurity: false,
            },
            availableAuthMethods: ['NativeAuth'],
            selectedAuthMethod: 'NativeAuth',
        },
        secrets: overrides.secrets ?? {
            connectionString: 'mongodb://localhost:27017',
            nativeAuthConfig: {
                connectionUser: 'testuser',
                connectionPassword: 'testpass',
            },
        },
    };
}

// Helper function to create a test folder item
function createTestFolderItem(
    overrides: {
        id?: string;
        name?: string;
        parentId?: string;
    } = {},
): ConnectionItem {
    return {
        id: overrides.id ?? 'test-folder-id',
        name: overrides.name ?? 'Test Folder',
        properties: {
            type: ItemType.Folder,
            parentId: overrides.parentId,
            api: API.DocumentDB,
            availableAuthMethods: [],
        },
        secrets: {
            connectionString: FOLDER_PLACEHOLDER_CONNECTION_STRING,
        },
    };
}

describe('ConnectionStorageService', () => {
    beforeEach(() => {
        // Clear mock storage before each test
        mockStorage.clear();
        jest.clearAllMocks();

        // Reset the internal storage service cache
        // @ts-expect-error - accessing private static member for testing
        ConnectionStorageService._storageService = undefined;
    });

    describe('Basic CRUD operations', () => {
        describe('save and get', () => {
            it('should save and retrieve a connection item', async () => {
                const connection = createTestConnectionItem();

                await ConnectionStorageService.save(ConnectionType.Clusters, connection);
                const retrieved = await ConnectionStorageService.get(connection.id, ConnectionType.Clusters);

                expect(retrieved).toBeDefined();
                expect(retrieved?.id).toBe(connection.id);
                expect(retrieved?.name).toBe(connection.name);
                expect(retrieved?.properties.type).toBe(ItemType.Connection);
            });

            it('should save and retrieve a folder item', async () => {
                const folder = createTestFolderItem();

                await ConnectionStorageService.save(ConnectionType.Clusters, folder);
                const retrieved = await ConnectionStorageService.get(folder.id, ConnectionType.Clusters);

                expect(retrieved).toBeDefined();
                expect(retrieved?.id).toBe(folder.id);
                expect(retrieved?.name).toBe(folder.name);
                expect(retrieved?.properties.type).toBe(ItemType.Folder);
            });

            it('should return undefined for non-existent item', async () => {
                const retrieved = await ConnectionStorageService.get('non-existent-id', ConnectionType.Clusters);
                expect(retrieved).toBeUndefined();
            });

            it('should preserve secrets when saving and retrieving', async () => {
                const connection = createTestConnectionItem({
                    secrets: {
                        connectionString: 'mongodb://secret-host:27017',
                        nativeAuthConfig: {
                            connectionUser: 'secretuser',
                            connectionPassword: 'secretpass',
                        },
                        entraIdAuthConfig: {
                            tenantId: 'tenant-123',
                            subscriptionId: 'sub-456',
                        },
                    },
                });

                await ConnectionStorageService.save(ConnectionType.Clusters, connection);
                const retrieved = await ConnectionStorageService.get(connection.id, ConnectionType.Clusters);

                expect(retrieved?.secrets.connectionString).toBe('mongodb://secret-host:27017');
                expect(retrieved?.secrets.nativeAuthConfig?.connectionUser).toBe('secretuser');
                expect(retrieved?.secrets.nativeAuthConfig?.connectionPassword).toBe('secretpass');
                expect(retrieved?.secrets.entraIdAuthConfig?.tenantId).toBe('tenant-123');
                expect(retrieved?.secrets.entraIdAuthConfig?.subscriptionId).toBe('sub-456');
            });
        });

        describe('getAll', () => {
            it('should return only connection items (not folders)', async () => {
                const connection1 = createTestConnectionItem({ id: 'conn-1', name: 'Connection 1' });
                const connection2 = createTestConnectionItem({ id: 'conn-2', name: 'Connection 2' });
                const folder = createTestFolderItem({ id: 'folder-1', name: 'Folder 1' });

                await ConnectionStorageService.save(ConnectionType.Clusters, connection1);
                await ConnectionStorageService.save(ConnectionType.Clusters, connection2);
                await ConnectionStorageService.save(ConnectionType.Clusters, folder);

                const connections = await ConnectionStorageService.getAll(ConnectionType.Clusters);

                expect(connections).toHaveLength(2);
                expect(connections.every((c) => c.properties.type === ItemType.Connection)).toBe(true);
            });

            it('should return empty array when no connections exist', async () => {
                const connections = await ConnectionStorageService.getAll(ConnectionType.Clusters);
                expect(connections).toHaveLength(0);
            });
        });

        describe('getAllItems', () => {
            it('should return both connections and folders', async () => {
                const connection = createTestConnectionItem({ id: 'conn-1' });
                const folder = createTestFolderItem({ id: 'folder-1' });

                await ConnectionStorageService.save(ConnectionType.Clusters, connection);
                await ConnectionStorageService.save(ConnectionType.Clusters, folder);

                const allItems = await ConnectionStorageService.getAllItems(ConnectionType.Clusters);

                expect(allItems).toHaveLength(2);
                expect(allItems.some((i) => i.properties.type === ItemType.Connection)).toBe(true);
                expect(allItems.some((i) => i.properties.type === ItemType.Folder)).toBe(true);
            });
        });

        describe('delete', () => {
            it('should delete an existing item', async () => {
                const connection = createTestConnectionItem();

                await ConnectionStorageService.save(ConnectionType.Clusters, connection);
                await ConnectionStorageService.delete(ConnectionType.Clusters, connection.id);

                const retrieved = await ConnectionStorageService.get(connection.id, ConnectionType.Clusters);
                expect(retrieved).toBeUndefined();
            });

            it('should not throw when deleting non-existent item', async () => {
                await expect(
                    ConnectionStorageService.delete(ConnectionType.Clusters, 'non-existent'),
                ).resolves.not.toThrow();
            });
        });

        describe('overwrite behavior', () => {
            it('should overwrite existing item when overwrite is true', async () => {
                const connection = createTestConnectionItem({ name: 'Original Name' });

                await ConnectionStorageService.save(ConnectionType.Clusters, connection);

                const updatedConnection = { ...connection, name: 'Updated Name' };
                await ConnectionStorageService.save(ConnectionType.Clusters, updatedConnection, true);

                const retrieved = await ConnectionStorageService.get(connection.id, ConnectionType.Clusters);
                expect(retrieved?.name).toBe('Updated Name');
            });
        });
    });

    describe('Folder hierarchy', () => {
        describe('getChildren', () => {
            it('should return root-level items when parentId is undefined', async () => {
                const rootConnection = createTestConnectionItem({ id: 'root-conn' });
                const rootFolder = createTestFolderItem({ id: 'root-folder' });
                const nestedConnection = createTestConnectionItem({
                    id: 'nested-conn',
                    parentId: 'root-folder',
                });

                await ConnectionStorageService.save(ConnectionType.Clusters, rootConnection);
                await ConnectionStorageService.save(ConnectionType.Clusters, rootFolder);
                await ConnectionStorageService.save(ConnectionType.Clusters, nestedConnection);

                const rootChildren = await ConnectionStorageService.getChildren(undefined, ConnectionType.Clusters);

                expect(rootChildren).toHaveLength(2);
                expect(rootChildren.some((c) => c.id === 'root-conn')).toBe(true);
                expect(rootChildren.some((c) => c.id === 'root-folder')).toBe(true);
            });

            it('should return children of a specific folder', async () => {
                const folder = createTestFolderItem({ id: 'parent-folder' });
                const child1 = createTestConnectionItem({
                    id: 'child-1',
                    parentId: 'parent-folder',
                });
                const child2 = createTestConnectionItem({
                    id: 'child-2',
                    parentId: 'parent-folder',
                });
                const unrelated = createTestConnectionItem({ id: 'unrelated' });

                await ConnectionStorageService.save(ConnectionType.Clusters, folder);
                await ConnectionStorageService.save(ConnectionType.Clusters, child1);
                await ConnectionStorageService.save(ConnectionType.Clusters, child2);
                await ConnectionStorageService.save(ConnectionType.Clusters, unrelated);

                const children = await ConnectionStorageService.getChildren('parent-folder', ConnectionType.Clusters);

                expect(children).toHaveLength(2);
                expect(children.every((c) => c.properties.parentId === 'parent-folder')).toBe(true);
            });

            it('should filter by item type when filter is provided', async () => {
                const folder = createTestFolderItem({ id: 'parent-folder' });
                const childFolder = createTestFolderItem({
                    id: 'child-folder',
                    parentId: 'parent-folder',
                });
                const childConnection = createTestConnectionItem({
                    id: 'child-conn',
                    parentId: 'parent-folder',
                });

                await ConnectionStorageService.save(ConnectionType.Clusters, folder);
                await ConnectionStorageService.save(ConnectionType.Clusters, childFolder);
                await ConnectionStorageService.save(ConnectionType.Clusters, childConnection);

                const onlyFolders = await ConnectionStorageService.getChildren(
                    'parent-folder',
                    ConnectionType.Clusters,
                    ItemType.Folder,
                );
                const onlyConnections = await ConnectionStorageService.getChildren(
                    'parent-folder',
                    ConnectionType.Clusters,
                    ItemType.Connection,
                );

                expect(onlyFolders).toHaveLength(1);
                expect(onlyFolders[0].properties.type).toBe(ItemType.Folder);
                expect(onlyConnections).toHaveLength(1);
                expect(onlyConnections[0].properties.type).toBe(ItemType.Connection);
            });
        });

        describe('updateParentId', () => {
            it('should move an item to a different folder', async () => {
                const folder1 = createTestFolderItem({ id: 'folder-1' });
                const folder2 = createTestFolderItem({ id: 'folder-2' });
                const connection = createTestConnectionItem({
                    id: 'conn-1',
                    parentId: 'folder-1',
                });

                await ConnectionStorageService.save(ConnectionType.Clusters, folder1);
                await ConnectionStorageService.save(ConnectionType.Clusters, folder2);
                await ConnectionStorageService.save(ConnectionType.Clusters, connection);

                await ConnectionStorageService.updateParentId('conn-1', ConnectionType.Clusters, 'folder-2');

                const moved = await ConnectionStorageService.get('conn-1', ConnectionType.Clusters);
                expect(moved?.properties.parentId).toBe('folder-2');
            });

            it('should move an item to root level', async () => {
                const folder = createTestFolderItem({ id: 'folder-1' });
                const connection = createTestConnectionItem({
                    id: 'conn-1',
                    parentId: 'folder-1',
                });

                await ConnectionStorageService.save(ConnectionType.Clusters, folder);
                await ConnectionStorageService.save(ConnectionType.Clusters, connection);

                await ConnectionStorageService.updateParentId('conn-1', ConnectionType.Clusters, undefined);

                const moved = await ConnectionStorageService.get('conn-1', ConnectionType.Clusters);
                expect(moved?.properties.parentId).toBeUndefined();
            });

            it('should throw error when item does not exist', async () => {
                await expect(
                    ConnectionStorageService.updateParentId('non-existent', ConnectionType.Clusters, undefined),
                ).rejects.toThrow('Item with id non-existent not found');
            });

            it('should prevent circular reference when moving folder into itself', async () => {
                const folder = createTestFolderItem({ id: 'folder-1' });

                await ConnectionStorageService.save(ConnectionType.Clusters, folder);

                await expect(
                    ConnectionStorageService.updateParentId('folder-1', ConnectionType.Clusters, 'folder-1'),
                ).rejects.toThrow('Cannot move a folder into itself or one of its descendants');
            });

            it('should prevent circular reference when moving folder into its descendant', async () => {
                const parentFolder = createTestFolderItem({ id: 'parent-folder' });
                const childFolder = createTestFolderItem({
                    id: 'child-folder',
                    parentId: 'parent-folder',
                });

                await ConnectionStorageService.save(ConnectionType.Clusters, parentFolder);
                await ConnectionStorageService.save(ConnectionType.Clusters, childFolder);

                await expect(
                    ConnectionStorageService.updateParentId('parent-folder', ConnectionType.Clusters, 'child-folder'),
                ).rejects.toThrow('Cannot move a folder into itself or one of its descendants');
            });

            it('should allow moving item to the same parent (no-op but valid)', async () => {
                // This tests that moving an item to its current parent doesn't throw an error
                // The operation is a no-op but should be accepted gracefully
                const folder = createTestFolderItem({ id: 'parent-folder' });
                const connection = createTestConnectionItem({
                    id: 'conn-1',
                    parentId: 'parent-folder',
                });

                await ConnectionStorageService.save(ConnectionType.Clusters, folder);
                await ConnectionStorageService.save(ConnectionType.Clusters, connection);

                // Move to same parent - should not throw
                await expect(
                    ConnectionStorageService.updateParentId('conn-1', ConnectionType.Clusters, 'parent-folder'),
                ).resolves.not.toThrow();

                // Verify item is still in the same place
                const retrieved = await ConnectionStorageService.get('conn-1', ConnectionType.Clusters);
                expect(retrieved?.properties.parentId).toBe('parent-folder');
            });
        });

        describe('getPath', () => {
            it('should return item name for root-level item', async () => {
                const connection = createTestConnectionItem({ id: 'conn-1', name: 'My Connection' });

                await ConnectionStorageService.save(ConnectionType.Clusters, connection);

                const path = await ConnectionStorageService.getPath('conn-1', ConnectionType.Clusters);
                expect(path).toBe('My Connection');
            });

            it('should return full path for nested item', async () => {
                const folder1 = createTestFolderItem({ id: 'folder-1', name: 'Folder1' });
                const folder2 = createTestFolderItem({
                    id: 'folder-2',
                    name: 'Folder2',
                    parentId: 'folder-1',
                });
                const connection = createTestConnectionItem({
                    id: 'conn-1',
                    name: 'Connection',
                    parentId: 'folder-2',
                });

                await ConnectionStorageService.save(ConnectionType.Clusters, folder1);
                await ConnectionStorageService.save(ConnectionType.Clusters, folder2);
                await ConnectionStorageService.save(ConnectionType.Clusters, connection);

                const path = await ConnectionStorageService.getPath('conn-1', ConnectionType.Clusters);
                expect(path).toBe('Folder1/Folder2/Connection');
            });

            it('should return empty string for non-existent item', async () => {
                const path = await ConnectionStorageService.getPath('non-existent', ConnectionType.Clusters);
                expect(path).toBe('');
            });
        });

        describe('isNameDuplicateInParent', () => {
            it('should return true when duplicate name exists in same parent', async () => {
                const connection = createTestConnectionItem({ id: 'conn-1', name: 'My Connection' });

                await ConnectionStorageService.save(ConnectionType.Clusters, connection);

                const isDuplicate = await ConnectionStorageService.isNameDuplicateInParent(
                    'My Connection',
                    undefined,
                    ConnectionType.Clusters,
                    ItemType.Connection,
                );

                expect(isDuplicate).toBe(true);
            });

            it('should return false when no duplicate exists', async () => {
                const connection = createTestConnectionItem({ id: 'conn-1', name: 'Connection 1' });

                await ConnectionStorageService.save(ConnectionType.Clusters, connection);

                const isDuplicate = await ConnectionStorageService.isNameDuplicateInParent(
                    'Connection 2',
                    undefined,
                    ConnectionType.Clusters,
                    ItemType.Connection,
                );

                expect(isDuplicate).toBe(false);
            });

            it('should exclude specified id from duplicate check', async () => {
                const connection = createTestConnectionItem({ id: 'conn-1', name: 'My Connection' });

                await ConnectionStorageService.save(ConnectionType.Clusters, connection);

                const isDuplicate = await ConnectionStorageService.isNameDuplicateInParent(
                    'My Connection',
                    undefined,
                    ConnectionType.Clusters,
                    ItemType.Connection,
                    'conn-1', // exclude this id
                );

                expect(isDuplicate).toBe(false);
            });

            it('should distinguish between folders and connections with same name', async () => {
                const connection = createTestConnectionItem({ id: 'conn-1', name: 'Same Name' });
                const folder = createTestFolderItem({ id: 'folder-1', name: 'Same Name' });

                await ConnectionStorageService.save(ConnectionType.Clusters, connection);
                await ConnectionStorageService.save(ConnectionType.Clusters, folder);

                const isDuplicateConnection = await ConnectionStorageService.isNameDuplicateInParent(
                    'Same Name',
                    undefined,
                    ConnectionType.Clusters,
                    ItemType.Connection,
                    'conn-1',
                );

                const isDuplicateFolder = await ConnectionStorageService.isNameDuplicateInParent(
                    'Same Name',
                    undefined,
                    ConnectionType.Clusters,
                    ItemType.Folder,
                    'folder-1',
                );

                expect(isDuplicateConnection).toBe(false);
                expect(isDuplicateFolder).toBe(false);
            });

            it('should check duplicates within specific parent folder', async () => {
                const folder = createTestFolderItem({ id: 'folder-1' });
                const connectionInFolder = createTestConnectionItem({
                    id: 'conn-1',
                    name: 'My Connection',
                    parentId: 'folder-1',
                });
                const connectionAtRoot = createTestConnectionItem({
                    id: 'conn-2',
                    name: 'My Connection',
                });

                await ConnectionStorageService.save(ConnectionType.Clusters, folder);
                await ConnectionStorageService.save(ConnectionType.Clusters, connectionInFolder);
                await ConnectionStorageService.save(ConnectionType.Clusters, connectionAtRoot);

                const isDuplicateInFolder = await ConnectionStorageService.isNameDuplicateInParent(
                    'My Connection',
                    'folder-1',
                    ConnectionType.Clusters,
                    ItemType.Connection,
                );

                const isDuplicateAtRoot = await ConnectionStorageService.isNameDuplicateInParent(
                    'My Connection',
                    undefined,
                    ConnectionType.Clusters,
                    ItemType.Connection,
                );

                expect(isDuplicateInFolder).toBe(true);
                expect(isDuplicateAtRoot).toBe(true);
            });
        });
    });

    describe('Migration - Version handling', () => {
        describe('v1 to v3 migration', () => {
            it('should migrate unversioned (v1) storage item to v3 format', async () => {
                // Simulate a v1 storage item (no version field, credentials in connection string)
                const v1Item: StorageItem = {
                    id: 'legacy-connection',
                    name: 'Legacy Connection',
                    properties: {
                        api: API.DocumentDB,
                        isEmulator: false,
                        disableEmulatorSecurity: false,
                    },
                    secrets: ['mongodb://user:pass@localhost:27017'],
                };

                // Directly set the v1 item in mock storage
                mockStorage.setItem(ConnectionType.Clusters, v1Item);

                // Reset storage service cache to force re-initialization
                // @ts-expect-error - accessing private static member for testing
                ConnectionStorageService._storageService = mockStorage;

                const retrieved = await ConnectionStorageService.get('legacy-connection', ConnectionType.Clusters);

                expect(retrieved).toBeDefined();
                expect(retrieved?.properties.type).toBe(ItemType.Connection);
                expect(retrieved?.properties.parentId).toBeUndefined();
                expect(retrieved?.properties.availableAuthMethods).toContain('NativeAuth');
                expect(retrieved?.secrets.nativeAuthConfig?.connectionUser).toBe('user');
                expect(retrieved?.secrets.nativeAuthConfig?.connectionPassword).toBe('pass');
            });
        });

        describe('v2 to v3 migration', () => {
            it('should migrate v2 storage item to v3 format', async () => {
                // Simulate a v2 storage item (has version 2.0, but no type/parentId)
                const v2Item: StorageItem<ConnectionProperties> = {
                    id: 'v2-connection',
                    name: 'V2 Connection',
                    version: '2.0',
                    properties: {
                        api: API.DocumentDB,
                        emulatorConfiguration: {
                            isEmulator: false,
                            disableEmulatorSecurity: false,
                        },
                        availableAuthMethods: ['NativeAuth'],
                        selectedAuthMethod: 'NativeAuth',
                    } as ConnectionProperties,
                    secrets: ['mongodb://localhost:27017', 'testuser', 'testpass'],
                };

                mockStorage.setItem(ConnectionType.Clusters, v2Item);

                // @ts-expect-error - accessing private static member for testing
                ConnectionStorageService._storageService = mockStorage;

                const retrieved = await ConnectionStorageService.get('v2-connection', ConnectionType.Clusters);

                expect(retrieved).toBeDefined();
                expect(retrieved?.properties.type).toBe(ItemType.Connection);
                expect(retrieved?.properties.parentId).toBeUndefined();
                expect(retrieved?.secrets.nativeAuthConfig?.connectionUser).toBe('testuser');
                expect(retrieved?.secrets.nativeAuthConfig?.connectionPassword).toBe('testpass');
            });
        });

        describe('v3 format', () => {
            it('should correctly handle v3 storage items with all fields', async () => {
                const v3Item: StorageItem<ConnectionProperties> = {
                    id: 'v3-connection',
                    name: 'V3 Connection',
                    version: '3.0',
                    properties: {
                        type: ItemType.Connection,
                        parentId: 'some-folder-id',
                        api: API.DocumentDB,
                        emulatorConfiguration: {
                            isEmulator: false,
                            disableEmulatorSecurity: false,
                        },
                        availableAuthMethods: ['NativeAuth', 'MicrosoftEntraID'],
                        selectedAuthMethod: 'MicrosoftEntraID',
                    },
                    secrets: [
                        'mongodb://localhost:27017', // ConnectionString
                        'user', // NativeAuthConnectionUser
                        'pass', // NativeAuthConnectionPassword
                        'tenant-123', // EntraIdTenantId
                        'sub-456', // EntraIdSubscriptionId
                    ],
                };

                mockStorage.setItem(ConnectionType.Clusters, v3Item);

                // @ts-expect-error - accessing private static member for testing
                ConnectionStorageService._storageService = mockStorage;

                const retrieved = await ConnectionStorageService.get('v3-connection', ConnectionType.Clusters);

                expect(retrieved).toBeDefined();
                expect(retrieved?.properties.type).toBe(ItemType.Connection);
                expect(retrieved?.properties.parentId).toBe('some-folder-id');
                expect(retrieved?.secrets.connectionString).toBe('mongodb://localhost:27017');
                expect(retrieved?.secrets.nativeAuthConfig?.connectionUser).toBe('user');
                expect(retrieved?.secrets.entraIdAuthConfig?.tenantId).toBe('tenant-123');
                expect(retrieved?.secrets.entraIdAuthConfig?.subscriptionId).toBe('sub-456');
            });
        });
    });

    describe('Connection types', () => {
        it('should keep Clusters and Emulators storage separate', async () => {
            const clusterConnection = createTestConnectionItem({ id: 'cluster-conn', name: 'Cluster Connection' });
            const emulatorConnection = createTestConnectionItem({ id: 'emulator-conn', name: 'Emulator Connection' });

            await ConnectionStorageService.save(ConnectionType.Clusters, clusterConnection);
            await ConnectionStorageService.save(ConnectionType.Emulators, emulatorConnection);

            const clusters = await ConnectionStorageService.getAll(ConnectionType.Clusters);
            const emulators = await ConnectionStorageService.getAll(ConnectionType.Emulators);

            expect(clusters).toHaveLength(1);
            expect(clusters[0].name).toBe('Cluster Connection');
            expect(emulators).toHaveLength(1);
            expect(emulators[0].name).toBe('Emulator Connection');
        });

        it('should not find cluster connection in emulators', async () => {
            const connection = createTestConnectionItem({ id: 'cluster-conn' });

            await ConnectionStorageService.save(ConnectionType.Clusters, connection);

            const fromEmulators = await ConnectionStorageService.get('cluster-conn', ConnectionType.Emulators);
            expect(fromEmulators).toBeUndefined();
        });
    });
});
