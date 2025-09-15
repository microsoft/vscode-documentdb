/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ConflictResolutionStrategy } from '../../services/tasks/copy-and-paste/copyPasteConfig';
import { type PasteCollectionWizardContext } from './PasteCollectionWizardContext';

export class ConfirmOperationStep extends AzureWizardPromptStep<PasteCollectionWizardContext> {
    public async prompt(context: PasteCollectionWizardContext): Promise<void> {
        const operationTitle = context.isTargetExistingCollection ? l10n.t('Copy-and-Merge') : l10n.t('Copy-and-Paste');

        const targetCollection = context.isTargetExistingCollection
            ? context.targetCollectionName
            : context.newCollectionName;

        const conflictStrategy = this.formatConflictStrategy(context.conflictResolutionStrategy!);
        const indexesSetting = context.copyIndexes ? l10n.t('Yes') : l10n.t('No');

        const warningText = context.isTargetExistingCollection
            ? l10n.t(
                  '⚠️ Warning: This will modify the existing collection. Documents with matching _id values will be handled based on your conflict resolution setting.',
              )
            : l10n.t(
                  'This operation will copy all documents from the source to the target collection. Large collections may take several minutes to complete.',
              );

        // Combine all parts
        const confirmationMessage = [
            l10n.t('Source:'),
            ' • ' +
                l10n.t('Collection: "{0}"', context.sourceCollectionName) +
                (context.sourceCollectionSize
                    ? '\n   • ' + l10n.t('Approx. Size: {0} documents', context.sourceCollectionSize.toLocaleString())
                    : ''),
            ' • ' + l10n.t('Database: "{0}"', context.sourceDatabaseName),
            ' • ' + l10n.t('Connection: {0}', context.sourceConnectionName),
            '',
            l10n.t('Target:'),
            ' • ' + l10n.t('Collection: "{0}"', targetCollection!),
            ' • ' + l10n.t('Database: "{0}"', context.targetDatabaseName),
            ' • ' + l10n.t('Connection: {0}', context.targetConnectionName),
            '',
            l10n.t('Settings:'),
            ' • ' + l10n.t('Conflict Resolution: {0}', conflictStrategy),
            ' • ' + l10n.t('Copy Indexes: {0}', indexesSetting),
            '',
            warningText,
        ].join('\n');

        const actionButton = context.isTargetExistingCollection
            ? l10n.t('Start Copy-and-Merge')
            : l10n.t('Start Copy-and-Paste');

        const confirmation = await vscode.window.showInformationMessage(
            operationTitle,
            { modal: true, detail: confirmationMessage },
            actionButton,
        );

        if (confirmation !== actionButton) {
            throw new Error('Operation cancelled by user.');
        }
    }

    public shouldPrompt(): boolean {
        return true;
    }

    private formatConflictStrategy(strategy: ConflictResolutionStrategy): string {
        switch (strategy) {
            case ConflictResolutionStrategy.Abort:
                return l10n.t('Abort on first error');
            case ConflictResolutionStrategy.Skip:
                return l10n.t('Skip and Log (continue)');
            case ConflictResolutionStrategy.Overwrite:
                return l10n.t('Overwrite existing documents');
            default:
                return l10n.t('Unknown strategy');
        }
    }
}
