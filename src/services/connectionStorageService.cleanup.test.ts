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

    clear(): void {
        this.items.clear();
    }

    setItem<T extends Record<string, unknown>>(workspace: string, item: StorageItem<T>): void {
        if (!this.items.has(workspace)) {
            this.items.set(workspace, new Map());
        }
        this.items.get(workspace)!.set(item.id, item as StorageItem);
    }
}

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

jest.mock('vscode', () => ({
    l10n: {
        t: jest.fn((str: string) => str),
    },
    extensions: {
        getExtension: jest.fn().mockReturnValue(undefined),
    },
}));

const mockStorage = new MockStorage();

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

jest.mock('../extension', () => ({
    isVCoreAndRURolloutEnabled: jest.fn().mockResolvedValue(false),
}));

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

describe('ConnectionStorageService - Cleanup Functions', () => {
    beforeEach(async () => {
        mockStorage.clear();
        jest.clearAllMocks();
        // Reset the private static storage service instance
        (ConnectionStorageService as any)._storageService = undefined;
    });

    describe('cleanupDuplicateConnectionStringParameters', () => {
        it('should fix connection string with duplicate parameters', async () => {
            // Setup: Create a connection with duplicate parameters
            const connectionWithDuplicates: ConnectionItem = {
                id: 'conn-with-duplicates',
                name: 'Connection With Duplicates',
                properties: {
                    type: ItemType.Connection,
                    api: API.DocumentDB,
                    availableAuthMethods: ['NativeAuth'],
                    selectedAuthMethod: 'NativeAuth',
                },
                secrets: {
                    connectionString: 'mongodb://localhost:27017/?ssl=true&ssl=true&appName=test&appName=test',
                    nativeAuthConfig: {
                        connectionUser: 'not-a-real-user',
                        connectionPassword: 'not-a-real-password',
                    },
                },
            };

            await ConnectionStorageService.save(ConnectionType.Clusters, connectionWithDuplicates);

            // Trigger storage service initialization (which runs cleanup)
            // Reset the static instance to force re-initialization
            (ConnectionStorageService as any)._storageService = undefined;
            await ConnectionStorageService.getAllItems(ConnectionType.Clusters);

            // Wait for the fire-and-forget cleanup to complete
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Verify: Connection string should be deduplicated
            const retrieved = await ConnectionStorageService.get('conn-with-duplicates', ConnectionType.Clusters);
            expect(retrieved?.secrets.connectionString).toBe('mongodb://localhost:27017/?ssl=true&appName=test');
        });

        it('should not modify connection strings without duplicates', async () => {
            const normalConnection: ConnectionItem = {
                id: 'conn-normal',
                name: 'Normal Connection',
                properties: {
                    type: ItemType.Connection,
                    api: API.DocumentDB,
                    availableAuthMethods: ['NativeAuth'],
                    selectedAuthMethod: 'NativeAuth',
                },
                secrets: {
                    connectionString: 'mongodb://localhost:27017/?ssl=true&appName=test',
                    nativeAuthConfig: {
                        connectionUser: 'not-a-real-user',
                        connectionPassword: 'not-a-real-password',
                    },
                },
            };

            await ConnectionStorageService.save(ConnectionType.Clusters, normalConnection);
            await ConnectionStorageService.getAllItems(ConnectionType.Clusters);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const retrieved = await ConnectionStorageService.get('conn-normal', ConnectionType.Clusters);
            expect(retrieved?.secrets.connectionString).toBe('mongodb://localhost:27017/?ssl=true&appName=test');
        });

        it('should skip folders (which use placeholder connection strings)', async () => {
            // Setup: Create a folder
            mockStorage.setItem(ConnectionType.Clusters, {
                id: 'folder-1',
                name: 'Test Folder',
                version: '3.0',
                properties: {
                    type: ItemType.Folder,
                    api: API.DocumentDB,
                    availableAuthMethods: [],
                },
                secrets: [FOLDER_PLACEHOLDER_CONNECTION_STRING],
            });

            await ConnectionStorageService.getAllItems(ConnectionType.Clusters);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const retrieved = await ConnectionStorageService.get('folder-1', ConnectionType.Clusters);
            expect(retrieved?.secrets.connectionString).toBe(FOLDER_PLACEHOLDER_CONNECTION_STRING);
        });
    });

    describe('fixFolderConnectionStrings', () => {
        it('should add placeholder connection string to folders without it', async () => {
            // Setup: Create a folder with empty connection string (simulating old version)
            mockStorage.setItem(ConnectionType.Clusters, {
                id: 'folder-no-cs',
                name: 'Folder Without CS',
                version: '3.0',
                properties: {
                    type: ItemType.Folder,
                    api: API.DocumentDB,
                    availableAuthMethods: [],
                },
                secrets: [''], // Empty connection string
            });

            await ConnectionStorageService.getAllItems(ConnectionType.Clusters);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const retrieved = await ConnectionStorageService.get('folder-no-cs', ConnectionType.Clusters);
            expect(retrieved?.secrets.connectionString).toBe(FOLDER_PLACEHOLDER_CONNECTION_STRING);
        });

        it('should not modify folders that already have placeholder connection string', async () => {
            mockStorage.setItem(ConnectionType.Clusters, {
                id: 'folder-with-cs',
                name: 'Folder With CS',
                version: '3.0',
                properties: {
                    type: ItemType.Folder,
                    api: API.DocumentDB,
                    availableAuthMethods: [],
                },
                secrets: [FOLDER_PLACEHOLDER_CONNECTION_STRING],
            });

            await ConnectionStorageService.getAllItems(ConnectionType.Clusters);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const retrieved = await ConnectionStorageService.get('folder-with-cs', ConnectionType.Clusters);
            expect(retrieved?.secrets.connectionString).toBe(FOLDER_PLACEHOLDER_CONNECTION_STRING);
        });
    });

    describe('resolvePostMigrationErrors - integration', () => {
        it('should run all cleanup operations in correct order', async () => {
            // Setup: Create a folder without CS and a connection with duplicates
            mockStorage.setItem(ConnectionType.Clusters, {
                id: 'folder-needs-fix',
                name: 'Folder',
                version: '3.0',
                properties: {
                    type: ItemType.Folder,
                    api: API.DocumentDB,
                    availableAuthMethods: [],
                },
                secrets: [''],
            });

            const connectionWithIssues: ConnectionItem = {
                id: 'conn-needs-fix',
                name: 'Connection',
                properties: {
                    type: ItemType.Connection,
                    api: API.DocumentDB,
                    availableAuthMethods: ['NativeAuth'],
                    selectedAuthMethod: 'NativeAuth',
                },
                secrets: {
                    connectionString: 'mongodb://test.example.com:27017/?ssl=true&ssl=true',
                    nativeAuthConfig: {
                        connectionUser: 'fake-user-for-testing',
                        connectionPassword: 'not-a-real-password-123',
                    },
                },
            };

            await ConnectionStorageService.save(ConnectionType.Clusters, connectionWithIssues);

            // Trigger initialization - reset storage to force re-initialization
            (ConnectionStorageService as any)._storageService = undefined;
            await ConnectionStorageService.getAllItems(ConnectionType.Clusters);
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Verify both fixes were applied
            const folder = await ConnectionStorageService.get('folder-needs-fix', ConnectionType.Clusters);
            expect(folder?.secrets.connectionString).toBe(FOLDER_PLACEHOLDER_CONNECTION_STRING);

            const connection = await ConnectionStorageService.get('conn-needs-fix', ConnectionType.Clusters);
            expect(connection?.secrets.connectionString).toBe('mongodb://test.example.com:27017/?ssl=true');
        });
    });
});
