/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ConflictResolutionStrategy } from '../../services/tasks/copy-and-paste/copyPasteConfig';
import { type PasteCollectionWizardContext } from './PasteCollectionWizardContext';

export class PromptConflictResolutionStep extends AzureWizardPromptStep<PasteCollectionWizardContext> {
    public async prompt(context: PasteCollectionWizardContext): Promise<void> {
        const promptItems = [
            {
                id: 'abort',
                label: l10n.t('Abort on first error'),
                detail: l10n.t(
                    'Abort entire operation on first write error. Recommended for safe data copy operations.',
                ),
                alwaysShow: true,
            },
            {
                id: 'skip',
                label: l10n.t('Skip and Log (continue)'),
                detail: l10n.t(
                    'Skip problematic documents and continue; issues are recorded. Good for scenarios where partial success is acceptable.',
                ),
                alwaysShow: true,
            },
            {
                id: 'overwrite',
                label: l10n.t('Overwrite existing documents'),
                detail: l10n.t(
                    'Overwrite existing documents that share the same _id; other write errors will abort the operation.',
                ),
                alwaysShow: true,
            },
            {
                id: 'generateNewIds',
                label: l10n.t('Generate new _id values'),
                detail: l10n.t(
                    'Create new unique _id values for all documents to avoid conflicts. Original _id values are preserved in _original_id field (or _original_id_1, _original_id_2, etc. if conflicts occur).',
                ),
                alwaysShow: true,
            },
        ];

        const selectedItem = await context.ui.showQuickPick(promptItems, {
            placeHolder: l10n.t('How should conflicts be handled during the copy operation?'),
            stepName: 'conflictResolution',
            suppressPersistence: true,
        });

        // Map selected item to actual strategy
        switch (selectedItem.id) {
            case 'abort':
                context.conflictResolutionStrategy = ConflictResolutionStrategy.Abort;
                break;
            case 'skip':
                context.conflictResolutionStrategy = ConflictResolutionStrategy.Skip;
                break;
            case 'overwrite':
                context.conflictResolutionStrategy = ConflictResolutionStrategy.Overwrite;
                break;
            case 'generateNewIds':
                context.conflictResolutionStrategy = ConflictResolutionStrategy.GenerateNewIds;
                break;
            default:
                throw new Error(l10n.t('Invalid conflict resolution strategy selected.'));
        }
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
