/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { nonNullValue } from '../../utils/nonNull';
import { CollectionNameStep } from './CollectionNameStep';
import { type CreateCollectionWizardContext } from './CreateCollectionWizardContext';
import { ExecuteStep } from './ExecuteStep';

interface CreateCollectionCommandOptions {
    /**
     * Which affordance asked for the collection, e.g. `treeContextMenu`,
     * `treeEmptyPlaceholder`, `clusterDashboard:emptyState`.
     */
    readonly activationSource?: string;
    readonly onNameResolved?: (collectionName: string) => Promise<void>;
}

export async function createCollection(
    context: IActionContext,
    node: DatabaseItem,
    _nodes?: DatabaseItem[],
    options?: CreateCollectionCommandOptions,
): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    context.telemetry.properties.experience = node.experience.api;
    context.telemetry.properties.activationSource = options?.activationSource ?? 'treeContextMenu';
    context.telemetry.properties.viewId = node.cluster.viewId ?? 'unknown';

    const wizardContext: CreateCollectionWizardContext = {
        ...context,
        credentialsId: node.cluster.clusterId,
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
    const newCollectionName = nonNullValue(
        wizardContext.newCollectionName,
        'wizardContext.newCollectionName',
        'createCollection.ts',
    );
    await options?.onNameResolved?.(newCollectionName);
    await wizard.execute();

    showConfirmationAsInSettings(
        l10n.t('The "{newCollectionName}" collection has been created.', { newCollectionName }),
    );
}
