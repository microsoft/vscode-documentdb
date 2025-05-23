/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, nonNullValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { CollectionNameStep } from './CollectionNameStep';
import { type CreateCollectionWizardContext } from './CreateCollectionWizardContext';
import { ExecuteStep } from './ExecuteStep';

export async function createCollection(context: IActionContext, node: DatabaseItem): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    context.telemetry.properties.experience = node.experience.api;

    const wizardContext: CreateCollectionWizardContext = {
        ...context,
        credentialsId: node.cluster.id,
        databaseId: node.databaseInfo.name,
        nodeId: node.id,
    };

    const wizard: AzureWizard<CreateCollectionWizardContext> = new AzureWizard(wizardContext, {
        title: l10n.t('Create collection'),
        promptSteps: [new CollectionNameStep()],
        executeSteps: [new ExecuteStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();

    const newCollectionName = nonNullValue(wizardContext.newCollectionName);
    showConfirmationAsInSettings(
        l10n.t('The "{newCollectionName}" collection has been created.', { newCollectionName }),
    );
}
