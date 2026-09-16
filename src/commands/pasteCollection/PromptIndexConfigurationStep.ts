/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { DocumentDbCollectionIndexCopier } from '../../services/taskService/data-api/indexes/DocumentDbCollectionIndexCopier';
import { nonNullValue } from '../../utils/nonNull';
import { type PasteCollectionWizardContext } from './PasteCollectionWizardContext';

export class PromptIndexConfigurationStep extends AzureWizardPromptStep<PasteCollectionWizardContext> {
    public async prompt(context: PasteCollectionWizardContext): Promise<void> {
        const promptItems = [
            {
                id: 'copy',
                label: l10n.t('Yes, copy indexes'),
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
            placeHolder: l10n.t('Copy indexes from the source collection?'),
            stepName: 'indexConfiguration',
            suppressPersistence: true,
        });

        context.copyIndexes = selectedItem.id === 'copy';
        if (context.copyIndexes) {
            const targetCollectionName = context.isTargetExistingCollection
                ? nonNullValue(
                      context.targetCollectionName,
                      'targetCollectionName',
                      'context.targetCollectionName',
                  )
                : nonNullValue(context.newCollectionName, 'newCollectionName', 'context.newCollectionName');
            const indexCopier = new DocumentDbCollectionIndexCopier(
                {
                    clusterId: context.sourceConnectionId,
                    databaseName: context.sourceDatabaseName,
                    collectionName: context.sourceCollectionName,
                },
                {
                    clusterId: context.targetConnectionId,
                    databaseName: context.targetDatabaseName,
                    collectionName: targetCollectionName,
                },
            );
            context.sourceIndexCount = await indexCopier.countSourceIndexes();
            context.telemetry.measurements.sourceIndexCount = context.sourceIndexCount;
        }
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
