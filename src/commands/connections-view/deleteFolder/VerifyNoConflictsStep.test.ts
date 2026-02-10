/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import { ConnectionType, ItemType } from '../../../services/connectionStorageService';
import { type DeleteFolderWizardContext } from './DeleteFolderWizardContext';
import { VerifyNoConflictsStep } from './VerifyNoConflictsStep';

// Mock ConnectionStorageService
const mockGetChildren = jest.fn();
jest.mock('../../../services/connectionStorageService', () => ({
    ConnectionStorageService: {
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

// Mock TaskService
const mockFindConflictingTasksForConnections = jest.fn<
    Array<{ taskId: string; taskName: string; taskType: string }>,
    [string[]]
>(() => []);
jest.mock('../../../services/taskService/taskService', () => ({
    TaskService: {
        findConflictingTasksForConnections: (connectionIds: string[]) =>
            mockFindConflictingTasksForConnections(connectionIds),
    },
}));

// Mock verificationUtils
const mockEnumerateConnectionsInFolder = jest.fn<Promise<string[]>, [string, string]>();
const mockLogTaskConflicts = jest.fn();
jest.mock('../verificationUtils', () => ({
    VerificationCompleteError: class VerificationCompleteError extends Error {
        constructor() {
            super('Conflict verification completed successfully');
            this.name = 'VerificationCompleteError';
        }
    },
    findConflictingTasks: jest.requireActual('../verificationUtils').findConflictingTasks,
    enumerateConnectionsInFolder: (...args: unknown[]) =>
        mockEnumerateConnectionsInFolder(...(args as [string, string])),
    logTaskConflicts: (...args: unknown[]) => mockLogTaskConflicts(...args),
}));

// Mock extensionVariables
const mockAppendLog = jest.fn();
const mockShow = jest.fn();
jest.mock('../../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            get appendLog() {
                return mockAppendLog;
            },
            get show() {
                return mockShow;
            },
        },
    },
}));

// Mock vscode l10n
jest.mock('@vscode/l10n', () => ({
    t: jest.fn((str: string) => str),
}));

// Helper to create mock context
function createMockContext(overrides: Partial<DeleteFolderWizardContext> = {}): DeleteFolderWizardContext {
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
        folderItem: overrides.folderItem ?? {
            storageId: 'folder-1',
            name: 'Test Folder',
        },
        connectionType: overrides.connectionType ?? ConnectionType.Clusters,
        foldersToDelete: 0,
        connectionsToDelete: 0,
        conflictingTasks: [],
        ...overrides,
    } as DeleteFolderWizardContext;
}

describe('VerifyNoConflictsStep (deleteFolder)', () => {
    let step: VerifyNoConflictsStep;

    beforeEach(() => {
        jest.clearAllMocks();
        step = new VerifyNoConflictsStep();
        mockGetChildren.mockResolvedValue([]);
        mockEnumerateConnectionsInFolder.mockResolvedValue([]);
        mockFindConflictingTasksForConnections.mockReturnValue([]);
    });

    describe('shouldPrompt', () => {
        it('should always return true', () => {
            expect(step.shouldPrompt()).toBe(true);
        });
    });

    describe('prompt - no conflicts', () => {
        it('should proceed without error when no conflicts exist', async () => {
            const context = createMockContext();

            (context.ui.showQuickPick as jest.Mock).mockImplementation(async (itemsPromise: Promise<unknown[]>) => {
                await itemsPromise;
                return { data: 'exit' };
            });

            // Should complete without error (VerificationCompleteError is caught internally)
            await expect(step.prompt(context)).resolves.not.toThrow();
        });

        it('should count descendants correctly', async () => {
            const context = createMockContext();

            // Simulate folder with 2 connections and 1 subfolder containing 1 connection
            mockGetChildren
                .mockResolvedValueOnce([
                    { id: 'conn-1', properties: { type: ItemType.Connection } },
                    { id: 'conn-2', properties: { type: ItemType.Connection } },
                    { id: 'subfolder-1', properties: { type: ItemType.Folder } },
                ])
                .mockResolvedValueOnce([{ id: 'conn-3', properties: { type: ItemType.Connection } }]);

            (context.ui.showQuickPick as jest.Mock).mockImplementation(async (itemsPromise: Promise<unknown[]>) => {
                await itemsPromise;
                return { data: 'exit' };
            });

            await step.prompt(context);

            expect(context.foldersToDelete).toBe(2); // 1 subfolder + 1 for the folder itself
            expect(context.connectionsToDelete).toBe(3);
        });
    });

    describe('prompt - task conflicts', () => {
        it('should throw UserCancelledError when user selects cancel', async () => {
            const context = createMockContext();

            mockEnumerateConnectionsInFolder.mockResolvedValue(['conn-1']);
            mockFindConflictingTasksForConnections.mockReturnValue([
                { taskId: 'task-1', taskName: 'Copy Task', taskType: 'copy-paste' },
            ]);

            (context.ui.showQuickPick as jest.Mock).mockImplementation(async (itemsPromise: Promise<unknown[]>) => {
                await itemsPromise;
                return { data: 'exit' };
            });

            await expect(step.prompt(context)).rejects.toThrow(UserCancelledError);
            expect(context.conflictingTasks).toHaveLength(1);
        });

        it('should offer show-output and cancel options for task conflicts', async () => {
            const context = createMockContext();

            mockEnumerateConnectionsInFolder.mockResolvedValue(['conn-1']);
            mockFindConflictingTasksForConnections.mockReturnValue([
                { taskId: 'task-1', taskName: 'Copy Task', taskType: 'copy-paste' },
            ]);

            let capturedOptions: Array<{ data: string }> = [];
            (context.ui.showQuickPick as jest.Mock).mockImplementation(
                async (itemsPromise: Promise<Array<{ data: string }>>) => {
                    capturedOptions = await itemsPromise;
                    return { data: 'exit' };
                },
            );

            try {
                await step.prompt(context);
            } catch {
                // Expected
            }

            expect(capturedOptions).toHaveLength(2);
            expect(capturedOptions[0].data).toBe('show-output');
            expect(capturedOptions[1].data).toBe('exit');
        });

        it('should show output and re-prompt when user selects show-output', async () => {
            const context = createMockContext();

            mockEnumerateConnectionsInFolder.mockResolvedValue(['conn-1']);
            mockFindConflictingTasksForConnections.mockReturnValue([
                { taskId: 'task-1', taskName: 'Copy Task', taskType: 'copy-paste' },
            ]);

            let callCount = 0;
            (context.ui.showQuickPick as jest.Mock).mockImplementation(async (itemsPromise: Promise<unknown[]>) => {
                await itemsPromise;
                callCount++;
                if (callCount === 1) {
                    return { data: 'show-output' };
                }
                return { data: 'exit' };
            });

            await expect(step.prompt(context)).rejects.toThrow(UserCancelledError);

            // show-output should have caused re-prompt (2 calls total)
            expect(callCount).toBe(2);
            // outputChannel.show() should have been called
            expect(mockShow).toHaveBeenCalled();
        });

        it('should log task conflict details', async () => {
            const context = createMockContext();

            mockEnumerateConnectionsInFolder.mockResolvedValue(['conn-1']);
            mockFindConflictingTasksForConnections.mockReturnValue([
                { taskId: 'task-1', taskName: 'Copy Task', taskType: 'copy-paste' },
            ]);

            (context.ui.showQuickPick as jest.Mock).mockImplementation(async (itemsPromise: Promise<unknown[]>) => {
                await itemsPromise;
                return { data: 'exit' };
            });

            try {
                await step.prompt(context);
            } catch {
                // Expected
            }

            expect(mockLogTaskConflicts).toHaveBeenCalledWith(
                expect.any(String),
                expect.arrayContaining([expect.objectContaining({ taskId: 'task-1' })]),
            );
        });
    });
});
