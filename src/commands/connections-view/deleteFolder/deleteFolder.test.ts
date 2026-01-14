/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ConnectionType, ItemType, type ConnectionItem } from '../../../services/connectionStorageService';
import { type FolderItem } from '../../../tree/connections-view/FolderItem';
import { deleteFolder } from './deleteFolder';

// Track deleted items
const deletedItems: string[] = [];
const mockChildren = new Map<string, ConnectionItem[]>();

// Mock ConnectionStorageService
jest.mock('../../../services/connectionStorageService', () => ({
    ConnectionStorageService: {
        getChildren: jest.fn(async (parentId: string) => {
            return mockChildren.get(parentId) ?? [];
        }),
        delete: jest.fn(async (_connectionType: string, itemId: string) => {
            deletedItems.push(itemId);
        }),
    },
    ConnectionType: {
        Clusters: 'clusters',
        Emulators: 'emulators',
    },
    ItemType: {
        Connection: 'connection',
        Folder: 'folder',
    },
}));

// Mock extensionVariables
jest.mock('../../../extensionVariables', () => ({
    ext: {
        state: {
            showDeleting: jest.fn(async (_id: string, callback: () => Promise<void>) => {
                await callback();
            }),
        },
    },
}));

// Mock getConfirmation - always confirm
jest.mock('../../../utils/dialogs/getConfirmation', () => ({
    getConfirmationAsInSettings: jest.fn().mockResolvedValue(true),
}));

// Mock showConfirmation
jest.mock('../../../utils/dialogs/showConfirmation', () => ({
    showConfirmationAsInSettings: jest.fn(),
}));

// Mock connectionsViewHelpers
jest.mock('../../../tree/connections-view/connectionsViewHelpers', () => ({
    refreshParentInConnectionsView: jest.fn(),
    withConnectionsViewProgress: jest.fn(async (callback: () => Promise<void>) => {
        await callback();
    }),
}));

// Mock vscode l10n
jest.mock('@vscode/l10n', () => ({
    t: jest.fn((str: string) => str),
}));

// Helper to create a mock folder item (the tree item, not storage item)
function createMockFolderItem(overrides: { id: string; name: string; connectionType?: ConnectionType }): FolderItem {
    return {
        id: overrides.id,
        storageId: overrides.id,
        name: overrides.name,
        connectionType: overrides.connectionType ?? ConnectionType.Clusters,
    } as FolderItem;
}

// Helper to create a mock connection item (storage item)
function createMockConnection(overrides: { id: string; name: string; parentId?: string }): ConnectionItem {
    return {
        id: overrides.id,
        name: overrides.name,
        properties: {
            type: ItemType.Connection,
            parentId: overrides.parentId,
            api: 'DocumentDB' as never,
            availableAuthMethods: ['NativeAuth'],
            selectedAuthMethod: 'NativeAuth',
        },
        secrets: {
            connectionString: 'mongodb://localhost:27017',
        },
    } as ConnectionItem;
}

// Helper to create a mock folder (storage item)
function createMockFolder(overrides: { id: string; name: string; parentId?: string }): ConnectionItem {
    return {
        id: overrides.id,
        name: overrides.name,
        properties: {
            type: ItemType.Folder,
            parentId: overrides.parentId,
            api: 'DocumentDB' as never,
            availableAuthMethods: [],
        },
        secrets: {
            connectionString: '',
        },
    } as ConnectionItem;
}

// Create mock action context
function createMockContext(): IActionContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        valuesToMask: [],
        ui: {
            showWarningMessage: jest.fn(),
            showQuickPick: jest.fn(),
            showInputBox: jest.fn(),
            onDidFinishPrompt: jest.fn(),
            showOpenDialog: jest.fn(),
            showWorkspaceFolderPick: jest.fn(),
        },
    } as unknown as IActionContext;
}

describe('deleteFolder', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        deletedItems.length = 0;
        mockChildren.clear();
    });

    describe('empty folder', () => {
        it('should delete an empty folder', async () => {
            const folderItem = createMockFolderItem({ id: 'empty-folder', name: 'Empty Folder' });

            // No children
            mockChildren.set('empty-folder', []);

            await deleteFolder(createMockContext(), folderItem);

            expect(deletedItems).toContain('empty-folder');
            expect(deletedItems).toHaveLength(1);
        });
    });

    describe('folder with direct connections', () => {
        it('should delete folder and all direct child connections', async () => {
            const folderItem = createMockFolderItem({ id: 'folder-1', name: 'Folder 1' });

            // Setup children
            const conn1 = createMockConnection({ id: 'conn-1', name: 'Connection 1', parentId: 'folder-1' });
            const conn2 = createMockConnection({ id: 'conn-2', name: 'Connection 2', parentId: 'folder-1' });
            const conn3 = createMockConnection({ id: 'conn-3', name: 'Connection 3', parentId: 'folder-1' });

            mockChildren.set('folder-1', [conn1, conn2, conn3]);

            await deleteFolder(createMockContext(), folderItem);

            // All connections and the folder should be deleted
            expect(deletedItems).toContain('conn-1');
            expect(deletedItems).toContain('conn-2');
            expect(deletedItems).toContain('conn-3');
            expect(deletedItems).toContain('folder-1');
            expect(deletedItems).toHaveLength(4);
        });
    });

    describe('folder with nested subfolders', () => {
        it('should recursively delete all subfolders and their contents', async () => {
            // Structure:
            // folder-root
            // ├── conn-root-1
            // ├── subfolder-1
            // │   ├── conn-sub1-1
            // │   └── subfolder-1-1
            // │       └── conn-sub1-1-1
            // └── subfolder-2
            //     └── conn-sub2-1

            const folderItem = createMockFolderItem({ id: 'folder-root', name: 'Root Folder' });

            // Root folder children
            const connRoot1 = createMockConnection({ id: 'conn-root-1', name: 'Root Conn 1', parentId: 'folder-root' });
            const subfolder1 = createMockFolder({ id: 'subfolder-1', name: 'Subfolder 1', parentId: 'folder-root' });
            const subfolder2 = createMockFolder({ id: 'subfolder-2', name: 'Subfolder 2', parentId: 'folder-root' });

            // Subfolder-1 children
            const connSub1_1 = createMockConnection({
                id: 'conn-sub1-1',
                name: 'Sub1 Conn 1',
                parentId: 'subfolder-1',
            });
            const subfolder1_1 = createMockFolder({
                id: 'subfolder-1-1',
                name: 'Subfolder 1-1',
                parentId: 'subfolder-1',
            });

            // Subfolder-1-1 children (deepest level)
            const connSub1_1_1 = createMockConnection({
                id: 'conn-sub1-1-1',
                name: 'Sub1-1 Conn 1',
                parentId: 'subfolder-1-1',
            });

            // Subfolder-2 children
            const connSub2_1 = createMockConnection({
                id: 'conn-sub2-1',
                name: 'Sub2 Conn 1',
                parentId: 'subfolder-2',
            });

            // Setup mock children map
            mockChildren.set('folder-root', [connRoot1, subfolder1, subfolder2]);
            mockChildren.set('subfolder-1', [connSub1_1, subfolder1_1]);
            mockChildren.set('subfolder-1-1', [connSub1_1_1]);
            mockChildren.set('subfolder-2', [connSub2_1]);

            await deleteFolder(createMockContext(), folderItem);

            // All items should be deleted
            expect(deletedItems).toContain('conn-root-1');
            expect(deletedItems).toContain('subfolder-1');
            expect(deletedItems).toContain('conn-sub1-1');
            expect(deletedItems).toContain('subfolder-1-1');
            expect(deletedItems).toContain('conn-sub1-1-1');
            expect(deletedItems).toContain('subfolder-2');
            expect(deletedItems).toContain('conn-sub2-1');
            expect(deletedItems).toContain('folder-root');

            // Total: 3 connections + 3 subfolders + 1 root folder = 8 items
            expect(deletedItems).toHaveLength(8);
        });

        it('should delete nested folders in correct order (children before parents)', async () => {
            // Structure:
            // folder-parent
            // └── folder-child
            //     └── folder-grandchild

            const folderItem = createMockFolderItem({ id: 'folder-parent', name: 'Parent' });

            const folderChild = createMockFolder({ id: 'folder-child', name: 'Child', parentId: 'folder-parent' });
            const folderGrandchild = createMockFolder({
                id: 'folder-grandchild',
                name: 'Grandchild',
                parentId: 'folder-child',
            });

            mockChildren.set('folder-parent', [folderChild]);
            mockChildren.set('folder-child', [folderGrandchild]);
            mockChildren.set('folder-grandchild', []);

            await deleteFolder(createMockContext(), folderItem);

            // Verify all items deleted
            expect(deletedItems).toHaveLength(3);

            // Grandchild should be deleted before child
            const grandchildIndex = deletedItems.indexOf('folder-grandchild');
            const childIndex = deletedItems.indexOf('folder-child');
            const parentIndex = deletedItems.indexOf('folder-parent');

            expect(grandchildIndex).toBeLessThan(childIndex);
            expect(childIndex).toBeLessThan(parentIndex);
        });
    });

    describe('folder with mixed content', () => {
        it('should delete folders and connections at all levels', async () => {
            // Structure:
            // mixed-folder
            // ├── conn-a
            // ├── conn-b
            // ├── sub-folder-a
            // │   ├── conn-c
            // │   └── conn-d
            // └── sub-folder-b
            //     ├── conn-e
            //     └── deep-folder
            //         └── conn-f

            const folderItem = createMockFolderItem({ id: 'mixed-folder', name: 'Mixed Folder' });

            // Root level
            const connA = createMockConnection({ id: 'conn-a', name: 'Conn A', parentId: 'mixed-folder' });
            const connB = createMockConnection({ id: 'conn-b', name: 'Conn B', parentId: 'mixed-folder' });
            const subFolderA = createMockFolder({ id: 'sub-folder-a', name: 'Sub A', parentId: 'mixed-folder' });
            const subFolderB = createMockFolder({ id: 'sub-folder-b', name: 'Sub B', parentId: 'mixed-folder' });

            // Sub-folder-a contents
            const connC = createMockConnection({ id: 'conn-c', name: 'Conn C', parentId: 'sub-folder-a' });
            const connD = createMockConnection({ id: 'conn-d', name: 'Conn D', parentId: 'sub-folder-a' });

            // Sub-folder-b contents
            const connE = createMockConnection({ id: 'conn-e', name: 'Conn E', parentId: 'sub-folder-b' });
            const deepFolder = createMockFolder({ id: 'deep-folder', name: 'Deep', parentId: 'sub-folder-b' });

            // Deep folder contents
            const connF = createMockConnection({ id: 'conn-f', name: 'Conn F', parentId: 'deep-folder' });

            mockChildren.set('mixed-folder', [connA, connB, subFolderA, subFolderB]);
            mockChildren.set('sub-folder-a', [connC, connD]);
            mockChildren.set('sub-folder-b', [connE, deepFolder]);
            mockChildren.set('deep-folder', [connF]);

            await deleteFolder(createMockContext(), folderItem);

            // All 10 items should be deleted (6 connections + 3 subfolders + 1 root)
            expect(deletedItems).toHaveLength(10);

            // Verify specific items
            expect(deletedItems).toContain('conn-a');
            expect(deletedItems).toContain('conn-b');
            expect(deletedItems).toContain('conn-c');
            expect(deletedItems).toContain('conn-d');
            expect(deletedItems).toContain('conn-e');
            expect(deletedItems).toContain('conn-f');
            expect(deletedItems).toContain('sub-folder-a');
            expect(deletedItems).toContain('sub-folder-b');
            expect(deletedItems).toContain('deep-folder');
            expect(deletedItems).toContain('mixed-folder');
        });
    });

    describe('user cancellation', () => {
        it('should not delete anything when user cancels confirmation', async () => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
            const { getConfirmationAsInSettings } = require('../../../utils/dialogs/getConfirmation');
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            getConfirmationAsInSettings.mockResolvedValueOnce(false);

            const folderItem = createMockFolderItem({ id: 'folder-1', name: 'Folder 1' });
            mockChildren.set('folder-1', [
                createMockConnection({ id: 'conn-1', name: 'Conn 1', parentId: 'folder-1' }),
            ]);

            await expect(deleteFolder(createMockContext(), folderItem)).rejects.toThrow();

            // Nothing should be deleted
            expect(deletedItems).toHaveLength(0);
        });
    });

    describe('error handling', () => {
        it('should throw error when no folder item is provided', async () => {
            await expect(deleteFolder(createMockContext(), null as unknown as FolderItem)).rejects.toThrow(
                'No folder selected.',
            );

            expect(deletedItems).toHaveLength(0);
        });
    });

    describe('connection type handling', () => {
        it('should use folder connection type for deletion', async () => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
            const { ConnectionStorageService } = require('../../../services/connectionStorageService');

            const folderItem = createMockFolderItem({
                id: 'emulator-folder',
                name: 'Emulator Folder',
                connectionType: ConnectionType.Emulators,
            });

            mockChildren.set('emulator-folder', []);

            await deleteFolder(createMockContext(), folderItem);

            // Verify delete was called with correct connection type
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            expect(ConnectionStorageService.delete).toHaveBeenCalledWith(ConnectionType.Emulators, 'emulator-folder');
        });
    });
});
