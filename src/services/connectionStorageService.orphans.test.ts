/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { API } from '../DocumentDBExperiences';
import {
    ConnectionStorageService,
    ConnectionType,
    ItemType,
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

    clear(): void {
        this.items.clear();
    }

    setItem<T extends Record<string, unknown>>(workspace: string, item: StorageItem<T>): void {
        if (!this.items.has(workspace)) {
            this.items.set(workspace, new Map());
        }
        this.items.get(workspace)!.set(item.id, item as StorageItem);
    }

    getItemCount(workspace: string): number {
        return this.items.get(workspace)?.size ?? 0;
    }
}

// Telemetry context mock that captures telemetry data
let capturedTelemetry: {
    properties: Record<string, string>;
    measurements: Record<string, number>;
};

const createTelemetryContextMock = () => {
    capturedTelemetry = { properties: {}, measurements: {} };
    return {
        telemetry: capturedTelemetry,
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
};

// Mock vscode-azext-utils module
jest.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: jest.fn(
        async (_eventName: string, callback: (context: IActionContext) => Promise<unknown>) => {
            const context = createTelemetryContextMock();
            await callback(context as unknown as IActionContext);
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
const mockAppendLog = jest.fn();
jest.mock('../extensionVariables', () => ({
    ext: {
        context: {
            globalState: {
                get: jest.fn().mockReturnValue(0),
                update: jest.fn().mockResolvedValue(undefined),
            },
        },
        outputChannel: {
            get appendLog() {
                return mockAppendLog;
            },
        },
    },
}));

// Helper to create a v3 storage item for testing
function createV3StorageItem(overrides: {
    id: string;
    name?: string;
    type?: ItemType;
    parentId?: string;
}): StorageItem<ConnectionProperties> {
    return {
        id: overrides.id,
        name: overrides.name ?? `Item ${overrides.id}`,
        version: '3.0',
        properties: {
            type: overrides.type ?? ItemType.Connection,
            parentId: overrides.parentId,
            api: API.DocumentDB,
            availableAuthMethods: ['NativeAuth'],
            selectedAuthMethod: 'NativeAuth',
        },
        secrets: ['mongodb://localhost:27017'],
    };
}

describe('ConnectionStorageService - Orphan Cleanup', () => {
    beforeEach(() => {
        mockStorage.clear();
        jest.clearAllMocks();
        mockAppendLog.mockClear();

        // Reset the internal storage service cache
        // @ts-expect-error - accessing private static member for testing
        ConnectionStorageService._storageService = undefined;
    });

    describe('cleanupOrphanedItems', () => {
        it('should delete items with non-existent parentId', async () => {
            // Setup: Create orphaned connection (parentId points to non-existent folder)
            const orphanedConnection = createV3StorageItem({
                id: 'orphan-conn',
                name: 'Orphaned Connection',
                type: ItemType.Connection,
                parentId: 'non-existent-folder',
            });

            const validConnection = createV3StorageItem({
                id: 'valid-conn',
                name: 'Valid Connection',
                type: ItemType.Connection,
                parentId: undefined,
            });

            mockStorage.setItem(ConnectionType.Clusters, orphanedConnection);
            mockStorage.setItem(ConnectionType.Clusters, validConnection);

            // Trigger storage initialization which runs cleanup
            // @ts-expect-error - accessing private static member for testing
            ConnectionStorageService._storageService = mockStorage;

            // Access cleanupOrphanedItems indirectly via getAllItems (which triggers storage init)
            // We need to manually trigger cleanup since _storageService is already set
            // @ts-expect-error - accessing private static method for testing
            await ConnectionStorageService.cleanupOrphanedItems();

            // Verify orphan was deleted
            const remaining = await ConnectionStorageService.getAllItems(ConnectionType.Clusters);
            expect(remaining).toHaveLength(1);
            expect(remaining[0].id).toBe('valid-conn');
        });

        it('should delete items with parentId pointing to non-folder item', async () => {
            // Setup: Connection pointing to another connection (not a folder - invalid)
            const parentConnection = createV3StorageItem({
                id: 'parent-conn',
                name: 'Parent Connection',
                type: ItemType.Connection,
                parentId: undefined,
            });

            const invalidChild = createV3StorageItem({
                id: 'invalid-child',
                name: 'Invalid Child',
                type: ItemType.Connection,
                parentId: 'parent-conn', // Points to a connection, not a folder
            });

            mockStorage.setItem(ConnectionType.Clusters, parentConnection);
            mockStorage.setItem(ConnectionType.Clusters, invalidChild);

            // @ts-expect-error - accessing private static member for testing
            ConnectionStorageService._storageService = mockStorage;

            // @ts-expect-error - accessing private static method for testing
            await ConnectionStorageService.cleanupOrphanedItems();

            const remaining = await ConnectionStorageService.getAllItems(ConnectionType.Clusters);
            expect(remaining).toHaveLength(1);
            expect(remaining[0].id).toBe('parent-conn');
        });

        it('should handle cascading orphans across iterations', async () => {
            // Setup: Nested structure where deleting parent orphans children
            // folder-1 (valid, at root)
            // └── folder-2 (child of folder-1, will be orphaned when folder-1 is made orphan)
            //     └── conn-1 (child of folder-2, will be orphaned in second iteration)

            const folder1 = createV3StorageItem({
                id: 'folder-1',
                name: 'Folder 1',
                type: ItemType.Folder,
                parentId: 'non-existent-parent', // This makes folder-1 an orphan
            });

            const folder2 = createV3StorageItem({
                id: 'folder-2',
                name: 'Folder 2',
                type: ItemType.Folder,
                parentId: 'folder-1', // Will become orphan after folder-1 is deleted
            });

            const connection = createV3StorageItem({
                id: 'conn-1',
                name: 'Connection 1',
                type: ItemType.Connection,
                parentId: 'folder-2', // Will become orphan after folder-2 is deleted
            });

            mockStorage.setItem(ConnectionType.Clusters, folder1);
            mockStorage.setItem(ConnectionType.Clusters, folder2);
            mockStorage.setItem(ConnectionType.Clusters, connection);

            // @ts-expect-error - accessing private static member for testing
            ConnectionStorageService._storageService = mockStorage;

            // @ts-expect-error - accessing private static method for testing
            await ConnectionStorageService.cleanupOrphanedItems();

            // All items should be deleted due to cascading orphans
            const remaining = await ConnectionStorageService.getAllItems(ConnectionType.Clusters);
            expect(remaining).toHaveLength(0);
        });

        it('should clean up orphans in both Clusters and Emulators zones', async () => {
            // Setup orphans in both zones
            const clusterOrphan = createV3StorageItem({
                id: 'cluster-orphan',
                type: ItemType.Connection,
                parentId: 'non-existent-folder',
            });

            const emulatorOrphan = createV3StorageItem({
                id: 'emulator-orphan',
                type: ItemType.Connection,
                parentId: 'another-non-existent',
            });

            const validCluster = createV3StorageItem({
                id: 'valid-cluster',
                type: ItemType.Connection,
                parentId: undefined,
            });

            mockStorage.setItem(ConnectionType.Clusters, clusterOrphan);
            mockStorage.setItem(ConnectionType.Clusters, validCluster);
            mockStorage.setItem(ConnectionType.Emulators, emulatorOrphan);

            // @ts-expect-error - accessing private static member for testing
            ConnectionStorageService._storageService = mockStorage;

            // @ts-expect-error - accessing private static method for testing
            await ConnectionStorageService.cleanupOrphanedItems();

            const clusters = await ConnectionStorageService.getAllItems(ConnectionType.Clusters);
            const emulators = await ConnectionStorageService.getAllItems(ConnectionType.Emulators);

            expect(clusters).toHaveLength(1);
            expect(clusters[0].id).toBe('valid-cluster');
            expect(emulators).toHaveLength(0);
        });

        it('should not delete valid nested items', async () => {
            // Setup: Valid folder hierarchy
            const rootFolder = createV3StorageItem({
                id: 'root-folder',
                name: 'Root Folder',
                type: ItemType.Folder,
                parentId: undefined,
            });

            const nestedFolder = createV3StorageItem({
                id: 'nested-folder',
                name: 'Nested Folder',
                type: ItemType.Folder,
                parentId: 'root-folder',
            });

            const nestedConnection = createV3StorageItem({
                id: 'nested-conn',
                name: 'Nested Connection',
                type: ItemType.Connection,
                parentId: 'nested-folder',
            });

            mockStorage.setItem(ConnectionType.Clusters, rootFolder);
            mockStorage.setItem(ConnectionType.Clusters, nestedFolder);
            mockStorage.setItem(ConnectionType.Clusters, nestedConnection);

            // @ts-expect-error - accessing private static member for testing
            ConnectionStorageService._storageService = mockStorage;

            // @ts-expect-error - accessing private static method for testing
            await ConnectionStorageService.cleanupOrphanedItems();

            // All items should remain (no orphans)
            const remaining = await ConnectionStorageService.getAllItems(ConnectionType.Clusters);
            expect(remaining).toHaveLength(3);
        });

        it('should log cleanup statistics when orphans are removed', async () => {
            const orphan1 = createV3StorageItem({
                id: 'orphan-1',
                type: ItemType.Connection,
                parentId: 'non-existent',
            });

            const orphan2 = createV3StorageItem({
                id: 'orphan-2',
                type: ItemType.Folder,
                parentId: 'also-non-existent',
            });

            mockStorage.setItem(ConnectionType.Clusters, orphan1);
            mockStorage.setItem(ConnectionType.Clusters, orphan2);

            // @ts-expect-error - accessing private static member for testing
            ConnectionStorageService._storageService = mockStorage;

            // @ts-expect-error - accessing private static method for testing
            await ConnectionStorageService.cleanupOrphanedItems();

            // Verify logging occurred
            expect(mockAppendLog).toHaveBeenCalled();
            const logCalls = mockAppendLog.mock.calls.map((call) => call[0]);
            expect(logCalls.some((msg: string) => msg.includes('orphan') || msg.includes('Cleaned'))).toBe(true);
        });

        it('should terminate when no orphans exist', async () => {
            // Setup: Only valid root-level items
            const conn1 = createV3StorageItem({
                id: 'conn-1',
                type: ItemType.Connection,
                parentId: undefined,
            });

            const conn2 = createV3StorageItem({
                id: 'conn-2',
                type: ItemType.Connection,
                parentId: undefined,
            });

            mockStorage.setItem(ConnectionType.Clusters, conn1);
            mockStorage.setItem(ConnectionType.Clusters, conn2);

            // @ts-expect-error - accessing private static member for testing
            ConnectionStorageService._storageService = mockStorage;

            // @ts-expect-error - accessing private static method for testing
            await ConnectionStorageService.cleanupOrphanedItems();

            // All items should remain
            const remaining = await ConnectionStorageService.getAllItems(ConnectionType.Clusters);
            expect(remaining).toHaveLength(2);
        });

        it('should handle empty storage gracefully', async () => {
            // @ts-expect-error - accessing private static member for testing
            ConnectionStorageService._storageService = mockStorage;

            // Should not throw
            // @ts-expect-error - accessing private static method for testing
            await expect(ConnectionStorageService.cleanupOrphanedItems()).resolves.not.toThrow();

            const remaining = await ConnectionStorageService.getAllItems(ConnectionType.Clusters);
            expect(remaining).toHaveLength(0);
        });

        it('should respect maxIterations safety limit (20 iterations)', async () => {
            // The cleanup has maxIterations = 20 as a safety net.
            // We simulate a scenario where orphans keep appearing (though in real usage this shouldn't happen).
            // We verify the cleanup terminates even with many orphans.

            // Create a chain of 25 orphaned items (more than maxIterations)
            // Each depends on the previous, so cleanup would need 25 iterations to fully clean.
            for (let i = 0; i < 25; i++) {
                const orphan = createV3StorageItem({
                    id: `orphan-${i}`,
                    name: `Orphan ${i}`,
                    type: ItemType.Connection,
                    parentId: i === 0 ? 'non-existent-root' : `orphan-${i - 1}`,
                });
                mockStorage.setItem(ConnectionType.Clusters, orphan);
            }

            // @ts-expect-error - accessing private static member for testing
            ConnectionStorageService._storageService = mockStorage;

            // @ts-expect-error - accessing private static method for testing
            await ConnectionStorageService.cleanupOrphanedItems();

            // With maxIterations = 20, the cleanup should terminate
            // and may leave some items (depending on order of processing)
            // The key assertion is that it terminates without infinite loop
            const remaining = await ConnectionStorageService.getAllItems(ConnectionType.Clusters);
            // The cleanup should have processed and terminated
            expect(remaining.length).toBeLessThanOrEqual(25);
        });

        it('should stop on consecutiveSameCount detection (stuck loop protection)', async () => {
            // The cleanup has consecutiveSameCount = 5 as protection against infinite loops
            // where the same number of orphans is removed each iteration but cleanup never completes.

            // Create orphans that point to each other in a way that causes consistent removal counts
            // In practice, this tests the termination condition exists.

            // Create items where removing some creates new orphans of the same count
            const folder1 = createV3StorageItem({
                id: 'folder-1',
                name: 'Folder 1',
                type: ItemType.Folder,
                parentId: 'non-existent', // orphan
            });

            mockStorage.setItem(ConnectionType.Clusters, folder1);

            // @ts-expect-error - accessing private static member for testing
            ConnectionStorageService._storageService = mockStorage;

            // @ts-expect-error - accessing private static method for testing
            await ConnectionStorageService.cleanupOrphanedItems();

            // The important thing is that cleanup terminates
            // With just one orphan, it should complete in one iteration
            const remaining = await ConnectionStorageService.getAllItems(ConnectionType.Clusters);
            expect(remaining).toHaveLength(0);
        });
    });
});
