/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ConflictResolutionStrategy } from '../../services/taskService/tasks/copy-and-paste/copyPasteConfig';
import { ConfirmOperationStep } from './ConfirmOperationStep';
import { type PasteCollectionWizardContext } from './PasteCollectionWizardContext';

const showInformationMessage = vscode.window.showInformationMessage as unknown as jest.MockedFunction<
    (message: string, options: vscode.MessageOptions, ...items: string[]) => Thenable<string | undefined>
>;
const showWarningMessage = vscode.window.showWarningMessage as unknown as jest.MockedFunction<
    (message: string, options: vscode.MessageOptions, ...items: string[]) => Thenable<string | undefined>
>;

function createContext(isTargetExistingCollection: boolean): PasteCollectionWizardContext {
    return {
        copyOperationCorrelationId: 'operation-id',
        sourceCollectionName: 'sourceCollection',
        sourceDatabaseName: 'sourceDb',
        sourceConnectionId: 'source',
        sourceConnectionName: 'Source',
        sourceCollectionSize: 1000,
        sourceIndexCount: 3,
        sourceUniqueIndexNames: [],
        sourceTtlIndexNames: [],
        largeCollectionWarningShown: false,
        targetConnectionId: 'target',
        targetConnectionName: 'Target',
        targetDatabaseName: 'targetDb',
        targetCollectionName: isTargetExistingCollection ? 'targetCollection' : undefined,
        newCollectionName: isTargetExistingCollection ? undefined : 'newCollection',
        isTargetExistingCollection,
        conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
        copyIndexes: true,
        telemetry: { properties: {}, measurements: {} },
    } as unknown as PasteCollectionWizardContext;
}

describe('ConfirmOperationStep', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        showInformationMessage.mockResolvedValue('Start Copy-and-Paste');
        showWarningMessage.mockResolvedValue('Start Copy-and-Merge');
    });

    it('formats copy-and-paste notes as bullets', async () => {
        await new ConfirmOperationStep().prompt(createContext(false));

        const detail = showInformationMessage.mock.calls[0][1].detail;
        expect(detail).toContain(
            'Important:\n' + ' • This operation will copy all documents from the source to the target collection.',
        );
        expect(detail).not.toContain('Large collections may take several minutes to complete.');
    });

    it('includes the timing note when the large-collection warning was shown', async () => {
        const context = createContext(false);
        context.largeCollectionWarningShown = true;

        await new ConfirmOperationStep().prompt(context);

        expect(showInformationMessage.mock.calls[0][1].detail).toContain(
            ' • Large collections may take several minutes to complete.',
        );
    });

    it('formats copy-and-merge warnings as bullets', async () => {
        await new ConfirmOperationStep().prompt(createContext(true));

        expect(showWarningMessage.mock.calls[0][1].detail).toContain(
            'Important:\n' +
                ' • This will modify the existing collection.\n' +
                ' • Documents with matching _id values will be handled based on your conflict resolution setting.',
        );
    });
});
