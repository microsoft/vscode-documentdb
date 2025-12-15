/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FolderStorageService, type FolderItem } from './folderStorageService';
import { StorageService } from './storageService';

// Mock extension variables
jest.mock('../extensionVariables', () => ({
    ext: {
        context: {
            globalState: {
                keys: jest.fn().mockReturnValue([]),
                get: jest.fn(),
                update: jest.fn(() => Promise.resolve()),
            },
            secretStorage: {
                get: jest.fn(() => Promise.resolve(undefined)),
                store: jest.fn(() => Promise.resolve()),
                delete: jest.fn(() => Promise.resolve()),
            },
        },
        secretStorage: {
            get: jest.fn(() => Promise.resolve(undefined)),
            store: jest.fn(() => Promise.resolve()),
            delete: jest.fn(() => Promise.resolve()),
        },
    },
}));

describe('FolderStorageService', () => {
    let mockStorageService: any;
    let mockItems: Map<string, any>;

    beforeEach(() => {
        // Reset mocks
        mockItems = new Map();

        // Mock the storage service
        mockStorageService = {
            getItems: jest.fn(async (workspace: string) => {
                const items: any[] = [];
                for (const [key, value] of mockItems.entries()) {
                    if (key.startsWith(workspace)) {
                        items.push(value);
                    }
                }
                return items;
            }),
            getItem: jest.fn(async (workspace: string, id: string) => {
                return mockItems.get(`${workspace}/${id}`);
            }),
            push: jest.fn(async (workspace: string, item: any) => {
                mockItems.set(`${workspace}/${item.id}`, item);
            }),
            delete: jest.fn(async (workspace: string, id: string) => {
                mockItems.delete(`${workspace}/${id}`);
            }),
        };

        jest.spyOn(StorageService, 'get').mockReturnValue(mockStorageService);
    });

    afterEach(() => {
        jest.clearAllMocks();
        mockItems.clear();
    });

    describe('save and get', () => {
        it('should save and retrieve a folder', async () => {
            const folder: FolderItem = {
                id: 'folder-1',
                name: 'My Folder',
                parentId: undefined,
            };

            await FolderStorageService.save(folder);

            const retrieved = await FolderStorageService.get('folder-1');
            expect(retrieved).toBeDefined();
            expect(retrieved?.name).toBe('My Folder');
            expect(retrieved?.parentId).toBeUndefined();
        });

        it('should save a folder with a parent', async () => {
            const parentFolder: FolderItem = {
                id: 'parent-folder',
                name: 'Parent',
                parentId: undefined,
            };

            const childFolder: FolderItem = {
                id: 'child-folder',
                name: 'Child',
                parentId: 'parent-folder',
            };

            await FolderStorageService.save(parentFolder);
            await FolderStorageService.save(childFolder);

            const retrieved = await FolderStorageService.get('child-folder');
            expect(retrieved).toBeDefined();
            expect(retrieved?.parentId).toBe('parent-folder');
        });

        it('should return undefined for non-existent folder', async () => {
            const retrieved = await FolderStorageService.get('non-existent');
            expect(retrieved).toBeUndefined();
        });
    });

    describe('getAll', () => {
        it('should return all folders', async () => {
            const folder1: FolderItem = {
                id: 'folder-1',
                name: 'Folder 1',
            };

            const folder2: FolderItem = {
                id: 'folder-2',
                name: 'Folder 2',
            };

            await FolderStorageService.save(folder1);
            await FolderStorageService.save(folder2);

            const folders = await FolderStorageService.getAll();
            expect(folders.length).toBe(2);
            expect(folders.map((f) => f.name)).toContain('Folder 1');
            expect(folders.map((f) => f.name)).toContain('Folder 2');
        });

        it('should return empty array when no folders exist', async () => {
            const folders = await FolderStorageService.getAll();
            expect(folders.length).toBe(0);
        });
    });

    describe('getChildren', () => {
        it('should return root-level folders when parentId is undefined', async () => {
            const rootFolder: FolderItem = {
                id: 'root-1',
                name: 'Root Folder',
                parentId: undefined,
            };

            const nestedFolder: FolderItem = {
                id: 'nested-1',
                name: 'Nested Folder',
                parentId: 'root-1',
            };

            await FolderStorageService.save(rootFolder);
            await FolderStorageService.save(nestedFolder);

            const rootChildren = await FolderStorageService.getChildren(undefined);
            expect(rootChildren.length).toBe(1);
            expect(rootChildren[0].name).toBe('Root Folder');
        });

        it('should return child folders of a specific parent', async () => {
            const parentFolder: FolderItem = {
                id: 'parent',
                name: 'Parent',
            };

            const child1: FolderItem = {
                id: 'child-1',
                name: 'Child 1',
                parentId: 'parent',
            };

            const child2: FolderItem = {
                id: 'child-2',
                name: 'Child 2',
                parentId: 'parent',
            };

            await FolderStorageService.save(parentFolder);
            await FolderStorageService.save(child1);
            await FolderStorageService.save(child2);

            const children = await FolderStorageService.getChildren('parent');
            expect(children.length).toBe(2);
            expect(children.map((c) => c.name)).toContain('Child 1');
            expect(children.map((c) => c.name)).toContain('Child 2');
        });

        it('should return empty array when folder has no children', async () => {
            const folder: FolderItem = {
                id: 'folder',
                name: 'Folder',
            };

            await FolderStorageService.save(folder);

            const children = await FolderStorageService.getChildren('folder');
            expect(children.length).toBe(0);
        });
    });

    describe('delete', () => {
        it('should delete a folder', async () => {
            const folder: FolderItem = {
                id: 'folder-to-delete',
                name: 'Delete Me',
            };

            await FolderStorageService.save(folder);
            await FolderStorageService.delete('folder-to-delete');

            const retrieved = await FolderStorageService.get('folder-to-delete');
            expect(retrieved).toBeUndefined();
        });

        it('should recursively delete child folders', async () => {
            const parent: FolderItem = {
                id: 'parent',
                name: 'Parent',
            };

            const child: FolderItem = {
                id: 'child',
                name: 'Child',
                parentId: 'parent',
            };

            const grandchild: FolderItem = {
                id: 'grandchild',
                name: 'Grandchild',
                parentId: 'child',
            };

            await FolderStorageService.save(parent);
            await FolderStorageService.save(child);
            await FolderStorageService.save(grandchild);

            await FolderStorageService.delete('parent');

            expect(await FolderStorageService.get('parent')).toBeUndefined();
            expect(await FolderStorageService.get('child')).toBeUndefined();
            expect(await FolderStorageService.get('grandchild')).toBeUndefined();
        });
    });

    describe('move', () => {
        it('should move a folder to a new parent', async () => {
            const folder: FolderItem = {
                id: 'folder',
                name: 'Folder',
                parentId: undefined,
            };

            const newParent: FolderItem = {
                id: 'new-parent',
                name: 'New Parent',
            };

            await FolderStorageService.save(folder);
            await FolderStorageService.save(newParent);

            await FolderStorageService.move('folder', 'new-parent');

            const moved = await FolderStorageService.get('folder');
            expect(moved?.parentId).toBe('new-parent');
        });

        it('should prevent circular reference (moving parent into child)', async () => {
            const parent: FolderItem = {
                id: 'parent',
                name: 'Parent',
            };

            const child: FolderItem = {
                id: 'child',
                name: 'Child',
                parentId: 'parent',
            };

            await FolderStorageService.save(parent);
            await FolderStorageService.save(child);

            await expect(FolderStorageService.move('parent', 'child')).rejects.toThrow(
                'Cannot move a folder into one of its descendants',
            );
        });

        it('should move folder to root level', async () => {
            const parent: FolderItem = {
                id: 'parent',
                name: 'Parent',
            };

            const child: FolderItem = {
                id: 'child',
                name: 'Child',
                parentId: 'parent',
            };

            await FolderStorageService.save(parent);
            await FolderStorageService.save(child);

            await FolderStorageService.move('child', undefined);

            const moved = await FolderStorageService.get('child');
            expect(moved?.parentId).toBeUndefined();
        });
    });

    describe('getPath', () => {
        it('should return folder name for root-level folder', async () => {
            const folder: FolderItem = {
                id: 'root',
                name: 'Root Folder',
            };

            await FolderStorageService.save(folder);

            const path = await FolderStorageService.getPath('root');
            expect(path).toBe('Root Folder');
        });

        it('should return full path for nested folders', async () => {
            const level1: FolderItem = {
                id: 'level1',
                name: 'Level 1',
            };

            const level2: FolderItem = {
                id: 'level2',
                name: 'Level 2',
                parentId: 'level1',
            };

            const level3: FolderItem = {
                id: 'level3',
                name: 'Level 3',
                parentId: 'level2',
            };

            await FolderStorageService.save(level1);
            await FolderStorageService.save(level2);
            await FolderStorageService.save(level3);

            const path = await FolderStorageService.getPath('level3');
            expect(path).toBe('Level 1/Level 2/Level 3');
        });

        it('should return empty string for non-existent folder', async () => {
            const path = await FolderStorageService.getPath('non-existent');
            expect(path).toBe('');
        });
    });
});
