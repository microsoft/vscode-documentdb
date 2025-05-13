/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext, nonNullValue } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { type CreateDatabaseWizardContext } from './CreateDatabaseWizardContext';
import { DatabaseNameStep } from './DatabaseNameStep';
import { ExecuteStep } from './ExecuteStep';

export async function createAzureDatabase(context: IActionContext, node?: ClusterItemBase): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    return createDatabase(context, node);
}

export async function createDatabase(context: IActionContext, node: ClusterItemBase): Promise<void> {
    await createMongoDatabase(context, node);
}

async function createMongoDatabase(context: IActionContext, node: ClusterItemBase): Promise<void> {
    context.telemetry.properties.experience = node.experience.api;

    if (!CredentialCache.hasCredentials(node.cluster.id)) {
        throw new Error(
            l10n.t(
                'You are not signed in to the MongoDB Cluster. Please sign in (by expanding the node "{0}") and try again.',
                node.cluster.name,
            ),
        );
    }

    const wizardContext: CreateDatabaseWizardContext = {
        ...context,
        credentialsId: node.cluster.id,
        clusterName: node.cluster.name,
        nodeId: node.id,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Create database'),
        promptSteps: [new DatabaseNameStep()],
        executeSteps: [new ExecuteStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();

    const newDatabaseName = nonNullValue(wizardContext.databaseName);
    showConfirmationAsInSettings(l10n.t('The "{name}" database has been created.', { name: newDatabaseName }));
}
