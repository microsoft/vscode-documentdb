/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type PasteCollectionWizardContext } from './PasteCollectionWizardContext';

export class PromptIndexConfigurationStep extends AzureWizardPromptStep<PasteCollectionWizardContext> {
    public async prompt(context: PasteCollectionWizardContext): Promise<void> {
        const promptItems = [
            {
                id: 'copy',
                label: l10n.t('Yes, copy {0} indexes', context.sourceIndexCount.toLocaleString()),
                detail: l10n.t('Copy all secondary index definitions from source to target collection.'),
                alwaysShow: true,
            },
            {
                id: 'skip',
                label: l10n.t('No, only copy documents'),
                detail: l10n.t('Copy only documents without recreating indexes.'),
                alwaysShow: true,
            },
        ];

        const selectedItem = await context.ui.showQuickPick(promptItems, {
            placeHolder: l10n.t('Copy {0} indexes from the source collection?', context.sourceIndexCount.toLocaleString()),
            stepName: 'indexConfiguration',
            suppressPersistence: true,
        });

        context.copyIndexes = selectedItem.id === 'copy';
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
