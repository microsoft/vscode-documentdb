/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GoBackError, UserCancelledError, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import { ConnectionType, ItemType, type ConnectionItem } from '../../../services/connectionStorageService';
import { type MoveItemsWizardContext } from './MoveItemsWizardContext';
import { VerifyNoConflictsStep } from './VerifyNoConflictsStep';

// Mock ConnectionStorageService
const mockIsNameDuplicateInParent = jest.fn();
jest.mock('../../../services/connectionStorageService', () => ({
    ConnectionStorageService: {
        isNameDuplicateInParent: (...args: unknown[]) => mockIsNameDuplicateInParent(...args),
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

// Helper to create a mock connection item
function createMockConnectionItem(overrides: Partial<ConnectionItem> = {}): ConnectionItem {
    return {
        id: overrides.id ?? 'test-item-id',
        name: overrides.name ?? 'Test Item',
        properties: {
            type: ItemType.Connection,
            parentId: undefined,
            api: 'DocumentDB' as never,
            availableAuthMethods: ['NativeAuth'],
            selectedAuthMethod: 'NativeAuth',
            ...overrides.properties,
        },
        secrets: {
            connectionString: 'mongodb://localhost:27017',
            ...overrides.secrets,
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
        itemsToMove: overrides.itemsToMove ?? [createMockConnectionItem()],
        connectionType: overrides.connectionType ?? ConnectionType.Clusters,
        sourceFolderId: 'sourceFolderId' in overrides ? overrides.sourceFolderId : undefined,
        targetFolderId: 'targetFolderId' in overrides ? overrides.targetFolderId : 'target-folder-id',
        targetFolderPath: 'targetFolderPath' in overrides ? overrides.targetFolderPath : 'Target Folder',
        cachedFolderList: overrides.cachedFolderList ?? [],
        conflictingNames: overrides.conflictingNames ?? [],
    } as MoveItemsWizardContext;
}

describe('VerifyNoConflictsStep', () => {
    let step: VerifyNoConflictsStep;

    beforeEach(() => {
        jest.clearAllMocks();
        step = new VerifyNoConflictsStep();
        mockIsNameDuplicateInParent.mockReset();
    });

    describe('shouldPrompt', () => {
        it('should always return true', () => {
            expect(step.shouldPrompt()).toBe(true);
        });
    });

    describe('prompt - no conflicts', () => {
        it('should proceed without error when no conflicts exist', async () => {
            const context = createMockContext({
                itemsToMove: [
                    createMockConnectionItem({ id: 'item-1', name: 'Item 1' }),
                    createMockConnectionItem({ id: 'item-2', name: 'Item 2' }),
                ],
            });

            // No conflicts
            mockIsNameDuplicateInParent.mockResolvedValue(false);

            // showQuickPick should throw VerificationCompleteError internally, which is caught
            // and causes prompt to return normally
            (context.ui.showQuickPick as jest.Mock).mockImplementation(
                async (itemsPromise: Promise<IAzureQuickPickItem<string>[]>) => {
                    // Trigger the async items function which will throw VerificationCompleteError
                    await itemsPromise;
                    // Should not reach here if no conflicts
                    return { data: 'back' };
                },
            );

            // Should complete without error
            await expect(step.prompt(context)).resolves.not.toThrow();

            // Should have checked both items for conflicts
            expect(mockIsNameDuplicateInParent).toHaveBeenCalledTimes(2);
            expect(context.conflictingNames).toHaveLength(0);
        });

        it('should call isNameDuplicateInParent with correct parameters', async () => {
            const item = createMockConnectionItem({
                id: 'conn-1',
                name: 'My Connection',
                properties: { type: ItemType.Connection } as never,
            });

            const context = createMockContext({
                itemsToMove: [item],
                targetFolderId: 'target-folder',
                connectionType: ConnectionType.Clusters,
            });

            mockIsNameDuplicateInParent.mockResolvedValue(false);

            (context.ui.showQuickPick as jest.Mock).mockImplementation(
                async (itemsPromise: Promise<IAzureQuickPickItem<string>[]>) => {
                    await itemsPromise;
                    return { data: 'back' };
                },
            );

            await step.prompt(context);

            expect(mockIsNameDuplicateInParent).toHaveBeenCalledWith(
                'My Connection',
                'target-folder',
                ConnectionType.Clusters,
                ItemType.Connection,
                'conn-1', // excludeId
            );
        });
    });

    describe('prompt - conflicts detected', () => {
        it('should throw GoBackError when user selects go back option', async () => {
            const context = createMockContext({
                itemsToMove: [createMockConnectionItem({ name: 'Conflicting Item' })],
                targetFolderId: 'target-folder',
            });

            // Simulate conflict
            mockIsNameDuplicateInParent.mockResolvedValue(true);

            // User selects 'back'
            (context.ui.showQuickPick as jest.Mock).mockImplementation(
                async (itemsPromise: Promise<IAzureQuickPickItem<string>[]>) => {
                    const items = await itemsPromise;
                    expect(items).toHaveLength(2); // 'back' and 'exit' options
                    return { data: 'back' };
                },
            );

            await expect(step.prompt(context)).rejects.toThrow(GoBackError);

            // Should clear target selection
            expect(context.targetFolderId).toBeUndefined();
            expect(context.targetFolderPath).toBeUndefined();
        });

        it('should throw UserCancelledError when user selects cancel option', async () => {
            const context = createMockContext({
                itemsToMove: [createMockConnectionItem({ name: 'Conflicting Item' })],
            });

            mockIsNameDuplicateInParent.mockResolvedValue(true);

            (context.ui.showQuickPick as jest.Mock).mockImplementation(
                async (itemsPromise: Promise<IAzureQuickPickItem<string>[]>) => {
                    await itemsPromise;
                    return { data: 'exit' };
                },
            );

            await expect(step.prompt(context)).rejects.toThrow(UserCancelledError);
        });

        it('should log conflicts to output channel', async () => {
            const context = createMockContext({
                itemsToMove: [
                    createMockConnectionItem({ name: 'Item A' }),
                    createMockConnectionItem({ name: 'Item B' }),
                ],
                targetFolderPath: 'My Target Folder',
            });

            // Both items conflict
            mockIsNameDuplicateInParent.mockResolvedValue(true);

            (context.ui.showQuickPick as jest.Mock).mockImplementation(
                async (itemsPromise: Promise<IAzureQuickPickItem<string>[]>) => {
                    await itemsPromise;
                    return { data: 'exit' };
                },
            );

            try {
                await step.prompt(context);
            } catch {
                // Expected to throw
            }

            // Verify output channel was used
            expect(mockAppendLog).toHaveBeenCalled();
            expect(mockShow).toHaveBeenCalled();

            // Verify conflict names were logged
            const logCalls = mockAppendLog.mock.calls.map((call) => call[0]);
            expect(logCalls.some((msg: string) => msg.includes('Item A') || msg.includes('Item B'))).toBe(true);
        });

        it('should populate conflictingNames in context', async () => {
            const context = createMockContext({
                itemsToMove: [
                    createMockConnectionItem({ id: 'a', name: 'Conflict A' }),
                    createMockConnectionItem({ id: 'b', name: 'No Conflict' }),
                    createMockConnectionItem({ id: 'c', name: 'Conflict C' }),
                ],
            });

            // Only A and C conflict
            mockIsNameDuplicateInParent
                .mockResolvedValueOnce(true) // Conflict A
                .mockResolvedValueOnce(false) // No Conflict
                .mockResolvedValueOnce(true); // Conflict C

            (context.ui.showQuickPick as jest.Mock).mockImplementation(
                async (itemsPromise: Promise<IAzureQuickPickItem<string>[]>) => {
                    await itemsPromise;
                    return { data: 'exit' };
                },
            );

            try {
                await step.prompt(context);
            } catch {
                // Expected
            }

            expect(context.conflictingNames).toHaveLength(2);
            expect(context.conflictingNames).toContain('Conflict A');
            expect(context.conflictingNames).toContain('Conflict C');
            expect(context.conflictingNames).not.toContain('No Conflict');
        });
    });

    describe('prompt - edge cases', () => {
        it('should handle moving to root level (undefined targetFolderId)', async () => {
            const context = createMockContext({
                itemsToMove: [createMockConnectionItem()],
                targetFolderId: undefined,
                targetFolderPath: undefined,
            });

            mockIsNameDuplicateInParent.mockResolvedValue(false);

            (context.ui.showQuickPick as jest.Mock).mockImplementation(
                async (itemsPromise: Promise<IAzureQuickPickItem<string>[]>) => {
                    await itemsPromise;
                    return { data: 'back' };
                },
            );

            await step.prompt(context);

            expect(mockIsNameDuplicateInParent).toHaveBeenCalledWith(
                expect.any(String),
                undefined, // root level
                expect.any(String),
                expect.any(String),
                expect.any(String),
            );
        });

        it('should handle empty items array gracefully', async () => {
            const context = createMockContext({
                itemsToMove: [],
            });

            (context.ui.showQuickPick as jest.Mock).mockImplementation(
                async (itemsPromise: Promise<IAzureQuickPickItem<string>[]>) => {
                    await itemsPromise;
                    return { data: 'back' };
                },
            );

            // Should proceed without error (no items = no conflicts)
            await expect(step.prompt(context)).resolves.not.toThrow();
            expect(mockIsNameDuplicateInParent).not.toHaveBeenCalled();
        });
    });
});
