/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { AtlasExperience } from '../../DocumentDBExperiences';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { nonNullValue } from '../../utils/nonNull';
import { InitialCollectionNameStep } from '../createCollection/InitialCollectionNameStep';
import { type CreateDatabaseWizardContext } from './CreateDatabaseWizardContext';
import { DatabaseNameStep } from './DatabaseNameStep';
import { ExecuteStep } from './ExecuteStep';

interface CreateDatabaseCommandOptions {
    /**
     * Which affordance asked for the database, e.g. `treeContextMenu`, `treeEmptyPlaceholder`,
     * `clusterDashboard:inventoryToolbar`. Defaults to `treeContextMenu` — the only caller that
     * cannot say is a menu entry.
     */
    readonly activationSource?: string;
    readonly onNameResolved?: (databaseName: string) => Promise<void>;
}

export async function createAzureDatabase(
    context: IActionContext,
    node: ClusterItemBase,
    nodes?: ClusterItemBase[],
    options?: CreateDatabaseCommandOptions,
): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    await createDatabase(context, node, nodes, options);
}

export async function createDatabase(
    context: IActionContext,
    node: ClusterItemBase,
    _nodes?: ClusterItemBase[],
    options?: CreateDatabaseCommandOptions,
): Promise<void> {
    await createMongoDatabase(context, node, options);
}

async function createMongoDatabase(
    context: IActionContext,
    node: ClusterItemBase,
    options?: CreateDatabaseCommandOptions,
): Promise<void> {
    context.telemetry.properties.experience = node.experience.api;
    context.telemetry.properties.activationSource = options?.activationSource ?? 'treeContextMenu';
    context.telemetry.properties.viewId = node.cluster.viewId ?? 'unknown';

    if (!CredentialCache.hasCredentials(node.cluster.clusterId)) {
        context.telemetry.properties.failureReason = 'notSignedIn';
        throw new Error(
            l10n.t(
                'You are not signed in to the DocumentDB cluster. Please sign in (by expanding the node "{0}") and try again.',
                node.cluster.name,
            ),
        );
    }

    const wizardContext: CreateDatabaseWizardContext = {
        ...context,
        credentialsId: node.cluster.clusterId,
        clusterName: node.cluster.name,
        nodeId: node.id,
        requiresInitialCollection: node.experience.api === AtlasExperience.api,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Create database'),
        promptSteps: [new DatabaseNameStep(), new InitialCollectionNameStep()],
        executeSteps: [new ExecuteStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    const newDatabaseName = nonNullValue(wizardContext.databaseName, 'wizardContext.databaseName', 'createDatabase.ts');
    await options?.onNameResolved?.(newDatabaseName);
    await wizard.execute();

    showConfirmationAsInSettings(l10n.t('The "{name}" database has been created.', { name: newDatabaseName }));
}
