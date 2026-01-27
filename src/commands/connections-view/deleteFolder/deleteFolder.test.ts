/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConnectionType, ItemType, type ConnectionItem } from '../../../services/connectionStorageService';
import { type DeleteFolderWizardContext } from './DeleteFolderWizardContext';
import { ExecuteStep } from './ExecuteStep';
import { VerifyNoConflictsStep } from './VerifyNoConflictsStep';

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

// Mock vscode-azext-utils
jest.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizardPromptStep: class {
        // Empty base class mock
    },
    AzureWizardExecuteStep: class {
        // Empty base class mock
    },
    UserCancelledError: class UserCancelledError extends Error {
        constructor() {
            super('User cancelled');
            this.name = 'UserCancelledError';
        }
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
        outputChannel: {
            appendLog: jest.fn(),
            show: jest.fn(),
        },
    },
}));

// Mock TaskService
const mockGetAllUsedResources = jest.fn<
    Array<{
        task: { taskId: string; taskName: string; taskType: string };
        resources: Array<{ connectionId?: string; databaseName?: string; collectionName?: string }>;
    }>,
    []
>(() => []);
jest.mock('../../../services/taskService/taskService', () => ({
    TaskService: {
        getAllUsedResources: () => mockGetAllUsedResources(),
    },
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

// Mock vscode
jest.mock('vscode', () => ({
    ThemeIcon: jest.fn().mockImplementation((name: string) => ({ id: name })),
}));

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

// Create mock wizard context
function createMockContext(
    folderId: string,
    folderName: string,
    connectionType = ConnectionType.Clusters,
): DeleteFolderWizardContext {
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
        folderItem: {
            id: folderId,
            storageId: folderId,
            name: folderName,
        },
        connectionType,
        conflictingTasks: [],
        foldersToDelete: 0,
        connectionsToDelete: 0,
        confirmed: true,
        deletedFolders: 0,
        deletedConnections: 0,
    } as unknown as DeleteFolderWizardContext;
}

describe('deleteFolder', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        deletedItems.length = 0;
        mockChildren.clear();
        mockGetAllUsedResources.mockReturnValue([]);
    });

    describe('ExecuteStep', () => {
        const executeStep = new ExecuteStep();

        describe('empty folder', () => {
            it('should delete an empty folder', async () => {
                const context = createMockContext('empty-folder', 'Empty Folder');
                mockChildren.set('empty-folder', []);

                await executeStep.execute(context);

                expect(deletedItems).toContain('empty-folder');
                expect(deletedItems).toHaveLength(1);
                expect(context.deletedFolders).toBe(1);
                expect(context.deletedConnections).toBe(0);
            });
        });

        describe('folder with direct connections', () => {
            it('should delete folder and all direct child connections', async () => {
                const context = createMockContext('folder-1', 'Folder 1');

                const conn1 = createMockConnection({ id: 'conn-1', name: 'Connection 1', parentId: 'folder-1' });
                const conn2 = createMockConnection({ id: 'conn-2', name: 'Connection 2', parentId: 'folder-1' });
                const conn3 = createMockConnection({ id: 'conn-3', name: 'Connection 3', parentId: 'folder-1' });

                mockChildren.set('folder-1', [conn1, conn2, conn3]);

                await executeStep.execute(context);

                expect(deletedItems).toContain('conn-1');
                expect(deletedItems).toContain('conn-2');
                expect(deletedItems).toContain('conn-3');
                expect(deletedItems).toContain('folder-1');
                expect(deletedItems).toHaveLength(4);
                expect(context.deletedFolders).toBe(1);
                expect(context.deletedConnections).toBe(3);
            });
        });

        describe('folder with nested subfolders', () => {
            it('should recursively delete all subfolders and their contents', async () => {
                const context = createMockContext('folder-root', 'Root Folder');

                // Root folder children
                const connRoot1 = createMockConnection({
                    id: 'conn-root-1',
                    name: 'Root Conn 1',
                    parentId: 'folder-root',
                });
                const subfolder1 = createMockFolder({
                    id: 'subfolder-1',
                    name: 'Subfolder 1',
                    parentId: 'folder-root',
                });
                const subfolder2 = createMockFolder({
                    id: 'subfolder-2',
                    name: 'Subfolder 2',
                    parentId: 'folder-root',
                });

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

                mockChildren.set('folder-root', [connRoot1, subfolder1, subfolder2]);
                mockChildren.set('subfolder-1', [connSub1_1, subfolder1_1]);
                mockChildren.set('subfolder-1-1', [connSub1_1_1]);
                mockChildren.set('subfolder-2', [connSub2_1]);

                await executeStep.execute(context);

                expect(deletedItems).toContain('conn-root-1');
                expect(deletedItems).toContain('subfolder-1');
                expect(deletedItems).toContain('conn-sub1-1');
                expect(deletedItems).toContain('subfolder-1-1');
                expect(deletedItems).toContain('conn-sub1-1-1');
                expect(deletedItems).toContain('subfolder-2');
                expect(deletedItems).toContain('conn-sub2-1');
                expect(deletedItems).toContain('folder-root');
                expect(deletedItems).toHaveLength(8);
            });

            it('should delete nested folders in correct order (children before parents)', async () => {
                const context = createMockContext('folder-parent', 'Parent');

                const folderChild = createMockFolder({ id: 'folder-child', name: 'Child', parentId: 'folder-parent' });
                const folderGrandchild = createMockFolder({
                    id: 'folder-grandchild',
                    name: 'Grandchild',
                    parentId: 'folder-child',
                });

                mockChildren.set('folder-parent', [folderChild]);
                mockChildren.set('folder-child', [folderGrandchild]);
                mockChildren.set('folder-grandchild', []);

                await executeStep.execute(context);

                expect(deletedItems).toHaveLength(3);

                const grandchildIndex = deletedItems.indexOf('folder-grandchild');
                const childIndex = deletedItems.indexOf('folder-child');
                const parentIndex = deletedItems.indexOf('folder-parent');

                expect(grandchildIndex).toBeLessThan(childIndex);
                expect(childIndex).toBeLessThan(parentIndex);
            });
        });

        describe('shouldExecute', () => {
            it('should execute when confirmed is true', () => {
                const context = createMockContext('folder-1', 'Folder 1');
                context.confirmed = true;
                expect(executeStep.shouldExecute(context)).toBe(true);
            });

            it('should not execute when confirmed is false', () => {
                const context = createMockContext('folder-1', 'Folder 1');
                context.confirmed = false;
                expect(executeStep.shouldExecute(context)).toBe(false);
            });
        });
    });

    describe('VerifyNoConflictsStep', () => {
        const verifyStep = new VerifyNoConflictsStep();

        describe('shouldPrompt', () => {
            it('should always prompt', () => {
                expect(verifyStep.shouldPrompt()).toBe(true);
            });
        });

        describe('task conflict detection', () => {
            it('should detect task using connection in folder', async () => {
                const context = createMockContext('testview/folder-1', 'Folder 1');

                // Mock a task using a connection within this folder
                mockGetAllUsedResources.mockReturnValue([
                    {
                        task: { taskId: 'task-1', taskName: 'Copy Task', taskType: 'copy-paste' },
                        resources: [
                            {
                                connectionId: 'testview/folder-1/connection-1',
                                databaseName: 'db1',
                                collectionName: 'coll1',
                            },
                        ],
                    },
                ]);

                // Mock showQuickPick to return the exit action
                const mockShowQuickPick = jest.fn().mockResolvedValue({ data: 'exit' });
                context.ui = {
                    ...context.ui,
                    showQuickPick: mockShowQuickPick,
                } as unknown as typeof context.ui;

                // The step should throw UserCancelledError when conflicts are found
                // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
                const { UserCancelledError } = require('@microsoft/vscode-azext-utils');
                // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                await expect(verifyStep.prompt(context)).rejects.toThrow(UserCancelledError);

                // Verify the conflicting task was detected
                expect(context.conflictingTasks).toHaveLength(1);
                expect(context.conflictingTasks[0].taskId).toBe('task-1');
            });

            it('should not detect task using connection outside folder', async () => {
                const context = createMockContext('testview/folder-1', 'Folder 1');

                // Mock a task using a connection in a different folder
                mockGetAllUsedResources.mockReturnValue([
                    {
                        task: { taskId: 'task-1', taskName: 'Copy Task', taskType: 'copy-paste' },
                        resources: [
                            {
                                connectionId: 'testview/folder-2/connection-1',
                                databaseName: 'db1',
                                collectionName: 'coll1',
                            },
                        ],
                    },
                ]);

                // Mock showQuickPick - the verifyNoTaskConflicts will throw VerificationCompleteError
                // when no conflicts, and showQuickPick should propagate this error
                const mockShowQuickPick = jest.fn().mockImplementation(async (itemsPromise: Promise<unknown[]>) => {
                    await itemsPromise;
                });
                context.ui = {
                    ...context.ui,
                    showQuickPick: mockShowQuickPick,
                } as unknown as typeof context.ui;

                // Should complete without error when no conflicts
                await verifyStep.prompt(context);

                // No conflicting tasks
                expect(context.conflictingTasks).toHaveLength(0);
            });
        });
    });
});
