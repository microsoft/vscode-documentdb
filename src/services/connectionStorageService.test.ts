/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConnectionStorageService, ConnectionType, ItemType, type ConnectionItem } from './connectionStorageService';

// Mock the storage service's internal storage
jest.mock('./storageService', () => ({
    StorageService: {
        get: jest.fn(),
        save: jest.fn(),
    },
}));

describe('ConnectionStorageService - Folder Operations', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getChildren', () => {
        it('should return children with matching parentId', async () => {
            const mockItems: ConnectionItem[] = [
                {
                    id: 'folder1',
                    name: 'Folder 1',
                    properties: { type: ItemType.Folder, parentId: undefined } as any,
                },
                {
                    id: 'folder2',
                    name: 'Folder 2',
                    properties: { type: ItemType.Folder, parentId: 'folder1' } as any,
                },
                {
                    id: 'connection1',
                    name: 'Connection 1',
                    properties: { type: ItemType.Connection, parentId: 'folder1' } as any,
                },
                {
                    id: 'connection2',
                    name: 'Connection 2',
                    properties: { type: ItemType.Connection, parentId: undefined } as any,
                },
            ];

            jest.spyOn(ConnectionStorageService, 'getAll').mockResolvedValue(mockItems);

            const children = await ConnectionStorageService.getChildren('folder1', ConnectionType.Clusters);

            expect(children).toHaveLength(2);
            expect(children[0].id).toBe('folder2');
            expect(children[1].id).toBe('connection1');
        });

        it('should return root-level items when parentId is undefined', async () => {
            const mockItems: ConnectionItem[] = [
                {
                    id: 'folder1',
                    name: 'Folder 1',
                    properties: { type: ItemType.Folder, parentId: undefined } as any,
                },
                {
                    id: 'folder2',
                    name: 'Folder 2',
                    properties: { type: ItemType.Folder, parentId: 'folder1' } as any,
                },
                {
                    id: 'connection1',
                    name: 'Connection 1',
                    properties: { type: ItemType.Connection, parentId: undefined } as any,
                },
            ];

            jest.spyOn(ConnectionStorageService, 'getAll').mockResolvedValue(mockItems);

            const children = await ConnectionStorageService.getChildren(undefined, ConnectionType.Clusters);

            expect(children).toHaveLength(2);
            expect(children[0].id).toBe('folder1');
            expect(children[1].id).toBe('connection1');
        });
    });

    describe('updateParentId', () => {
        it('should update parentId for a folder', async () => {
            const mockFolder: ConnectionItem = {
                id: 'folder1',
                name: 'Folder 1',
                properties: { type: ItemType.Folder, parentId: undefined } as any,
            };

            jest.spyOn(ConnectionStorageService, 'get').mockResolvedValue(mockFolder);
            jest.spyOn(ConnectionStorageService, 'getPath').mockResolvedValue('Folder 1');
            const saveSpy = jest.spyOn(ConnectionStorageService, 'save').mockResolvedValue();

            await ConnectionStorageService.updateParentId('folder1', ConnectionType.Clusters, 'newParent');

            expect(saveSpy).toHaveBeenCalledWith(
                ConnectionType.Clusters,
                expect.objectContaining({
                    id: 'folder1',
                    properties: expect.objectContaining({
                        parentId: 'newParent',
                    }),
                }),
                true,
            );
        });

        it('should prevent circular reference when moving folder', async () => {
            const mockFolder: ConnectionItem = {
                id: 'folder1',
                name: 'Folder 1',
                properties: { type: ItemType.Folder, parentId: undefined } as any,
            };

            jest.spyOn(ConnectionStorageService, 'get').mockResolvedValue(mockFolder);
            jest.spyOn(ConnectionStorageService, 'getPath')
                .mockResolvedValueOnce('Folder 1/Folder 2') // target path
                .mockResolvedValueOnce('Folder 1'); // source path

            await expect(
                ConnectionStorageService.updateParentId('folder1', ConnectionType.Clusters, 'folder2'),
            ).rejects.toThrow('Cannot move a folder into itself or one of its descendants');
        });

        it('should allow moving folder to non-descendant location', async () => {
            const mockFolder: ConnectionItem = {
                id: 'folder1',
                name: 'Folder 1',
                properties: { type: ItemType.Folder, parentId: undefined } as any,
            };

            jest.spyOn(ConnectionStorageService, 'get').mockResolvedValue(mockFolder);
            jest.spyOn(ConnectionStorageService, 'getPath')
                .mockResolvedValueOnce('Folder 2') // target path
                .mockResolvedValueOnce('Folder 1'); // source path
            const saveSpy = jest.spyOn(ConnectionStorageService, 'save').mockResolvedValue();

            await ConnectionStorageService.updateParentId('folder1', ConnectionType.Clusters, 'folder2');

            expect(saveSpy).toHaveBeenCalled();
        });
    });

    describe('isNameDuplicateInParent', () => {
        it('should return true when duplicate folder name exists in same parent', async () => {
            const mockItems: ConnectionItem[] = [
                {
                    id: 'folder1',
                    name: 'Test Folder',
                    properties: { type: ItemType.Folder, parentId: 'parent1' } as any,
                },
                {
                    id: 'folder2',
                    name: 'Other Folder',
                    properties: { type: ItemType.Folder, parentId: 'parent1' } as any,
                },
            ];

            jest.spyOn(ConnectionStorageService, 'getChildren').mockResolvedValue(mockItems);

            const isDuplicate = await ConnectionStorageService.isNameDuplicateInParent(
                'Test Folder',
                'parent1',
                ConnectionType.Clusters,
                ItemType.Folder,
            );

            expect(isDuplicate).toBe(true);
        });

        it('should return false when no duplicate exists', async () => {
            const mockItems: ConnectionItem[] = [
                {
                    id: 'folder1',
                    name: 'Test Folder',
                    properties: { type: ItemType.Folder, parentId: 'parent1' } as any,
                },
            ];

            jest.spyOn(ConnectionStorageService, 'getChildren').mockResolvedValue(mockItems);

            const isDuplicate = await ConnectionStorageService.isNameDuplicateInParent(
                'New Folder',
                'parent1',
                ConnectionType.Clusters,
                ItemType.Folder,
            );

            expect(isDuplicate).toBe(false);
        });

        it('should exclude specified item when checking duplicates', async () => {
            const mockItems: ConnectionItem[] = [
                {
                    id: 'folder1',
                    name: 'Test Folder',
                    properties: { type: ItemType.Folder, parentId: 'parent1' } as any,
                },
            ];

            jest.spyOn(ConnectionStorageService, 'getChildren').mockResolvedValue(mockItems);

            const isDuplicate = await ConnectionStorageService.isNameDuplicateInParent(
                'Test Folder',
                'parent1',
                ConnectionType.Clusters,
                ItemType.Folder,
                'folder1', // exclude this item
            );

            expect(isDuplicate).toBe(false);
        });

        it('should only check items of same type', async () => {
            const mockItems: ConnectionItem[] = [
                {
                    id: 'connection1',
                    name: 'Test',
                    properties: { type: ItemType.Connection, parentId: 'parent1' } as any,
                },
            ];

            jest.spyOn(ConnectionStorageService, 'getChildren').mockResolvedValue(mockItems);

            const isDuplicate = await ConnectionStorageService.isNameDuplicateInParent(
                'Test',
                'parent1',
                ConnectionType.Clusters,
                ItemType.Folder,
            );

            expect(isDuplicate).toBe(false);
        });
    });

    describe('getPath', () => {
        it('should return item name for root-level item', async () => {
            const mockItem: ConnectionItem = {
                id: 'folder1',
                name: 'Root Folder',
                properties: { type: ItemType.Folder, parentId: undefined } as any,
            };

            jest.spyOn(ConnectionStorageService, 'get').mockResolvedValue(mockItem);

            const path = await ConnectionStorageService.getPath('folder1', ConnectionType.Clusters);

            expect(path).toBe('Root Folder');
        });

        it('should return full path for nested item', async () => {
            const mockFolder2: ConnectionItem = {
                id: 'folder2',
                name: 'Subfolder',
                properties: { type: ItemType.Folder, parentId: 'folder1' } as any,
            };

            const mockFolder1: ConnectionItem = {
                id: 'folder1',
                name: 'Parent Folder',
                properties: { type: ItemType.Folder, parentId: undefined } as any,
            };

            jest.spyOn(ConnectionStorageService, 'get')
                .mockResolvedValueOnce(mockFolder2)
                .mockResolvedValueOnce(mockFolder1);

            const path = await ConnectionStorageService.getPath('folder2', ConnectionType.Clusters);

            expect(path).toBe('Parent Folder/Subfolder');
        });

        it('should return empty string for non-existent item', async () => {
            jest.spyOn(ConnectionStorageService, 'get').mockResolvedValue(undefined);

            const path = await ConnectionStorageService.getPath('nonexistent', ConnectionType.Clusters);

            expect(path).toBe('');
        });
    });

    describe('Integration - Move folder with children', () => {
        it('should move folder and children automatically move with it', async () => {
            // Setup: Folder structure
            // Root
            //   ├─ FolderA
            //   │   └─ Connection1
            //   └─ FolderB
            //
            // Move FolderA into FolderB
            // Result: Connection1 still has parentId='FolderA', which now has parentId='FolderB'

            const mockFolderA: ConnectionItem = {
                id: 'folderA',
                name: 'Folder A',
                properties: { type: ItemType.Folder, parentId: undefined } as any,
            };

            jest.spyOn(ConnectionStorageService, 'get').mockResolvedValue(mockFolderA);
            jest.spyOn(ConnectionStorageService, 'getPath')
                .mockResolvedValueOnce('Folder B') // target
                .mockResolvedValueOnce('Folder A'); // source
            const saveSpy = jest.spyOn(ConnectionStorageService, 'save').mockResolvedValue();

            await ConnectionStorageService.updateParentId('folderA', ConnectionType.Clusters, 'folderB');

            // Verify only FolderA was updated, not its children
            expect(saveSpy).toHaveBeenCalledTimes(1);
            expect(saveSpy).toHaveBeenCalledWith(
                ConnectionType.Clusters,
                expect.objectContaining({
                    id: 'folderA',
                    properties: expect.objectContaining({
                        parentId: 'folderB',
                    }),
                }),
                true,
            );
        });
    });
});
