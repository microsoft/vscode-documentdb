/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ConnectionType,
    FOLDER_PLACEHOLDER_CONNECTION_STRING,
    ItemType,
    type ConnectionItem,
} from '../../../services/connectionStorageService';
import { type MoveItemsWizardContext } from './MoveItemsWizardContext';
import { PromptTargetFolderStep } from './PromptTargetFolderStep';

// Mock vscode-azext-utils FIRST (before imports that use it)
jest.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizardPromptStep: class {
        // Empty base class mock
    },
    UserCancelledError: class UserCancelledError extends Error {
        constructor() {
            super('User cancelled');
            this.name = 'UserCancelledError';
        }
    },
}));

// Mock ConnectionStorageService
const mockGetAllItems = jest.fn();
const mockGetChildren = jest.fn();
jest.mock('../../../services/connectionStorageService', () => ({
    ConnectionStorageService: {
        getAllItems: (...args: unknown[]) => mockGetAllItems(...args),
        getChildren: (...args: unknown[]) => mockGetChildren(...args),
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

// Mock vscode
const mockShowWarningMessage = jest.fn();
jest.mock('vscode', () => ({
    ThemeIcon: jest.fn().mockImplementation((name) => ({ id: name })),
    window: {
        get showWarningMessage() {
            return mockShowWarningMessage;
        },
    },
}));

// Mock vscode l10n
jest.mock('@vscode/l10n', () => ({
    t: jest.fn((str: string) => str),
}));

// Helper to create a mock folder item
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
            connectionString: FOLDER_PLACEHOLDER_CONNECTION_STRING,
        },
    } as ConnectionItem;
}

// Helper to create a mock connection item
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

// Helper to create a mock wizard context
function createMockContext(overrides: Partial<MoveItemsWizardContext> = {}): MoveItemsWizardContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: { issueProperties: {} },
        valuesToMask: [],
        ui: {
            showQuickPick: jest.fn(),
            showInputBox: jest.fn(),
            showWarningMessage: jest.fn(),
            onDidFinishPrompt: jest.fn(),
            showOpenDialog: jest.fn(),
            showWorkspaceFolderPick: jest.fn(),
        },
        itemsToMove: overrides.itemsToMove ?? [createMockConnection({ id: 'item-1', name: 'Item 1' })],
        connectionType: overrides.connectionType ?? ConnectionType.Clusters,
        sourceFolderId: 'sourceFolderId' in overrides ? overrides.sourceFolderId : undefined,
        targetFolderId: 'targetFolderId' in overrides ? overrides.targetFolderId : undefined,
        targetFolderPath: 'targetFolderPath' in overrides ? overrides.targetFolderPath : undefined,
        cachedFolderList: overrides.cachedFolderList ?? [],
        conflictingNames: overrides.conflictingNames ?? [],
    } as MoveItemsWizardContext;
}

describe('PromptTargetFolderStep', () => {
    let step: PromptTargetFolderStep;

    beforeEach(() => {
        jest.clearAllMocks();
        step = new PromptTargetFolderStep();
        mockGetAllItems.mockReset();
        mockGetChildren.mockReset();
        mockShowWarningMessage.mockReset();
    });

    describe('shouldPrompt', () => {
        it('should always return true', () => {
            expect(step.shouldPrompt()).toBe(true);
        });
    });

    describe('getDescendantIds (via prompt)', () => {
        it('should recursively collect all descendant folder IDs', async () => {
            // Setup folder hierarchy:
            // folder-1
            // └── folder-2
            //     └── folder-3
            const folder1 = createMockFolder({ id: 'folder-1', name: 'Folder 1' });
            const folder2 = createMockFolder({ id: 'folder-2', name: 'Folder 2', parentId: 'folder-1' });
            const folder3 = createMockFolder({ id: 'folder-3', name: 'Folder 3', parentId: 'folder-2' });
            const targetFolder = createMockFolder({ id: 'target-folder', name: 'Target' });

            // Return all folders when getAllItems is called
            mockGetAllItems.mockResolvedValue([folder1, folder2, folder3, targetFolder]);

            // Setup getChildren to return proper hierarchy
            mockGetChildren.mockImplementation(async (parentId: string) => {
                if (parentId === 'folder-1') return [folder2];
                if (parentId === 'folder-2') return [folder3];
                return [];
            });

            const context = createMockContext({
                itemsToMove: [folder1], // Moving folder-1 (which has descendants)
            });

            // Mock QuickPick to capture the items
            let capturedItems: unknown[] = [];
            (context.ui.showQuickPick as jest.Mock).mockImplementation(async (items: unknown[]) => {
                capturedItems = items;
                return { label: 'Target', data: targetFolder };
            });

            await step.prompt(context);

            // Verify descendants are excluded - folder-2 and folder-3 should NOT be in picker
            const folderLabels = (capturedItems as Array<{ label: string }>).map((i) => i.label);
            expect(folderLabels.some((l) => l.includes('Folder 2'))).toBe(false);
            expect(folderLabels.some((l) => l.includes('Folder 3'))).toBe(false);
            // Target folder should be available
            expect(folderLabels.some((l) => l.includes('Target'))).toBe(true);
        });
    });

    describe('root level option', () => {
        it('should include root option when items are not at root level', async () => {
            const folder = createMockFolder({ id: 'folder-1', name: 'Folder 1' });
            const connection = createMockConnection({
                id: 'conn-1',
                name: 'Connection 1',
                parentId: 'folder-1', // Not at root
            });

            mockGetAllItems.mockResolvedValue([folder]);
            mockGetChildren.mockResolvedValue([]);

            const context = createMockContext({
                itemsToMove: [connection],
            });

            let capturedItems: unknown[] = [];
            (context.ui.showQuickPick as jest.Mock).mockImplementation(async (items: unknown[]) => {
                capturedItems = items;
                return { label: '/', data: undefined };
            });

            await step.prompt(context);

            // Root option should be first
            expect((capturedItems[0] as { label: string }).label).toBe('/');
            expect((capturedItems[0] as { data: unknown }).data).toBeUndefined();
        });

        it('should NOT include root option when all items are already at root level', async () => {
            const folder = createMockFolder({ id: 'folder-1', name: 'Folder 1' });
            const connection = createMockConnection({
                id: 'conn-1',
                name: 'Connection 1',
                parentId: undefined, // At root
            });

            mockGetAllItems.mockResolvedValue([folder]);
            mockGetChildren.mockResolvedValue([]);

            const context = createMockContext({
                itemsToMove: [connection],
            });

            let capturedItems: unknown[] = [];
            (context.ui.showQuickPick as jest.Mock).mockImplementation(async (items: unknown[]) => {
                capturedItems = items;
                return { label: '/ Folder 1', data: folder };
            });

            await step.prompt(context);

            // Root option should NOT be present
            const hasRootOption = (capturedItems as Array<{ label: string }>).some(
                (i) => i.label === '/' || i.label === '/ (root)',
            );
            expect(hasRootOption).toBe(false);
        });
    });

    describe('folder exclusion', () => {
        it('should exclude the folder being moved from picker', async () => {
            const folderBeingMoved = createMockFolder({ id: 'folder-move', name: 'Moving Folder' });
            const targetFolder = createMockFolder({ id: 'folder-target', name: 'Target Folder' });

            mockGetAllItems.mockResolvedValue([folderBeingMoved, targetFolder]);
            mockGetChildren.mockResolvedValue([]);

            const context = createMockContext({
                itemsToMove: [folderBeingMoved],
            });

            let capturedItems: unknown[] = [];
            (context.ui.showQuickPick as jest.Mock).mockImplementation(async (items: unknown[]) => {
                capturedItems = items;
                return { label: '/ Target Folder', data: targetFolder };
            });

            await step.prompt(context);

            // Moving folder should not be in picker
            const labels = (capturedItems as Array<{ label: string }>).map((i) => i.label);
            expect(labels.some((l) => l.includes('Moving Folder'))).toBe(false);
            expect(labels.some((l) => l.includes('Target Folder'))).toBe(true);
        });

        it('should exclude current parent folder from picker', async () => {
            const parentFolder = createMockFolder({ id: 'parent-folder', name: 'Parent Folder' });
            const otherFolder = createMockFolder({ id: 'other-folder', name: 'Other Folder' });
            const connection = createMockConnection({
                id: 'conn-1',
                name: 'Connection 1',
                parentId: 'parent-folder',
            });

            mockGetAllItems.mockResolvedValue([parentFolder, otherFolder]);
            mockGetChildren.mockResolvedValue([]);

            const context = createMockContext({
                itemsToMove: [connection],
            });

            let capturedItems: unknown[] = [];
            (context.ui.showQuickPick as jest.Mock).mockImplementation(async (items: unknown[]) => {
                capturedItems = items;
                return { label: '/ Other Folder', data: otherFolder };
            });

            await step.prompt(context);

            // Parent folder should not be in picker (already there, no point moving to same location)
            const labels = (capturedItems as Array<{ label: string }>).map((i) => i.label);
            expect(labels.some((l) => l.includes('Parent Folder'))).toBe(false);
            expect(labels.some((l) => l.includes('Other Folder'))).toBe(true);
        });
    });

    describe('no available folders', () => {
        it('should show warning and throw UserCancelledError when no folders available', async () => {
            // No folders in storage
            mockGetAllItems.mockResolvedValue([]);
            mockGetChildren.mockResolvedValue([]);

            const connection = createMockConnection({
                id: 'conn-1',
                name: 'Connection 1',
                parentId: undefined, // At root, so no root option either
            });

            const context = createMockContext({
                itemsToMove: [connection],
            });

            mockShowWarningMessage.mockResolvedValue(undefined);

            await expect(step.prompt(context)).rejects.toThrow('User cancelled');
            expect(mockShowWarningMessage).toHaveBeenCalled();
        });
    });

    describe('cached folder list', () => {
        it('should use cached folder list when available', async () => {
            const cachedFolder = createMockFolder({ id: 'cached-folder', name: 'Cached Folder' });

            const context = createMockContext({
                cachedFolderList: [
                    {
                        label: '/ Cached Folder',
                        data: cachedFolder,
                    },
                ],
                itemsToMove: [createMockConnection({ id: 'conn-1', name: 'Conn', parentId: 'some-parent' })],
            });

            (context.ui.showQuickPick as jest.Mock).mockImplementation(async () => {
                return { label: '/ Cached Folder', data: cachedFolder };
            });

            await step.prompt(context);

            // Should not call getAllItems since cache is available
            expect(mockGetAllItems).not.toHaveBeenCalled();
        });
    });

    describe('target selection', () => {
        it('should set targetFolderId and targetFolderPath from selection', async () => {
            const targetFolder = createMockFolder({ id: 'target-id', name: 'Target Folder' });

            mockGetAllItems.mockResolvedValue([targetFolder]);
            mockGetChildren.mockResolvedValue([]);

            const context = createMockContext({
                itemsToMove: [createMockConnection({ id: 'conn-1', name: 'Conn', parentId: 'some-parent' })],
            });

            (context.ui.showQuickPick as jest.Mock).mockResolvedValue({
                label: '/ Target Folder',
                data: targetFolder,
            });

            await step.prompt(context);

            expect(context.targetFolderId).toBe('target-id');
            expect(context.targetFolderPath).toBe('/ Target Folder');
        });

        it('should set undefined targetFolderId when root is selected', async () => {
            const folder = createMockFolder({ id: 'folder-1', name: 'Folder 1' });

            mockGetAllItems.mockResolvedValue([folder]);
            mockGetChildren.mockResolvedValue([]);

            const context = createMockContext({
                itemsToMove: [createMockConnection({ id: 'conn-1', name: 'Conn', parentId: 'folder-1' })],
            });

            (context.ui.showQuickPick as jest.Mock).mockResolvedValue({
                label: '/',
                data: undefined,
            });

            await step.prompt(context);

            expect(context.targetFolderId).toBeUndefined();
            expect(context.targetFolderPath).toBe('/');
        });
    });
});
