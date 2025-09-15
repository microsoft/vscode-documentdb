/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type AzureWizardPromptStep, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { ConflictResolutionStrategy } from '../../services/taskService/tasks/copy-and-paste/copyPasteConfig';
import { CollectionItem } from '../../tree/documentdb/CollectionItem';
import { DatabaseItem } from '../../tree/documentdb/DatabaseItem';
import { ConfirmOperationStep } from './ConfirmOperationStep';
import { ExecuteStep } from './ExecuteStep';
import { type PasteCollectionWizardContext } from './PasteCollectionWizardContext';
import { PromptConflictResolutionStep } from './PromptConflictResolutionStep';
import { PromptNewCollectionNameStep } from './PromptNewCollectionNameStep';

export async function pasteCollection(
    context: IActionContext,
    targetNode: CollectionItem | DatabaseItem,
): Promise<void> {
    // Record telemetry for wizard start
    context.telemetry.properties.wizardStarted = 'true';

    if (!targetNode) {
        throw new Error(l10n.t('No target node selected.'));
    }

    // Check if a source collection has been copied
    const sourceNode = ext.copiedCollectionNode;
    if (!sourceNode) {
        context.telemetry.properties.noSourceCollection = 'true';
        context.telemetry.properties.wizardCompletedSuccessfully = 'false';
        context.telemetry.properties.wizardFailureReason = 'noSourceCollection';
        void vscode.window.showWarningMessage(
            l10n.t(
                'No collection has been marked for copy. Please use "Copy Collection..." first to select a source collection.',
            ),
            { modal: true },
        );
        return;
    }

    // Validate that we support the source and target types
    // (This should never happen in practice since the command is only available on these node types)
    if (!(sourceNode instanceof CollectionItem)) {
        // Add telemetry for debugging invalid source node type
        context.telemetry.properties.invalidSourceNodeType = (sourceNode as unknown)?.constructor?.name ?? 'undefined';
        context.telemetry.properties.sourceNodeExists = String(!!sourceNode);
        context.telemetry.properties.wizardCompletedSuccessfully = 'false';
        context.telemetry.properties.wizardFailureReason = 'invalidSourceNodeType';
        if (sourceNode) {
            context.telemetry.properties.sourceNodeProperties = Object.getOwnPropertyNames(sourceNode).join(',');
            context.telemetry.properties.sourceNodeHasCluster = String('cluster' in sourceNode);
            context.telemetry.properties.sourceNodeHasCollectionInfo = String('collectionInfo' in sourceNode);
        }

        throw new Error(l10n.t('Internal error. Invalid source node type.'), { cause: sourceNode });
    }

    if (!(targetNode instanceof CollectionItem) && !(targetNode instanceof DatabaseItem)) {
        // Add telemetry for debugging invalid target node type
        context.telemetry.properties.invalidTargetNodeType = (targetNode as unknown)?.constructor?.name ?? 'undefined';
        context.telemetry.properties.targetNodeExists = String(!!targetNode);
        context.telemetry.properties.wizardCompletedSuccessfully = 'false';
        context.telemetry.properties.wizardFailureReason = 'invalidTargetNodeType';
        if (targetNode) {
            context.telemetry.properties.targetNodeProperties = Object.getOwnPropertyNames(targetNode).join(',');
            context.telemetry.properties.targetNodeHasCluster = String('cluster' in targetNode);
            context.telemetry.properties.targetNodeHasDatabaseInfo = String('databaseInfo' in targetNode);
            context.telemetry.properties.targetNodeHasCollectionInfo = String('collectionInfo' in targetNode);
        }

        throw new Error(l10n.t('Internal error. Invalid target node type.'), { cause: targetNode });
    }

    // Determine target details based on node type
    const isTargetExistingCollection = targetNode instanceof CollectionItem;

    // Record telemetry for operation type and scope
    context.telemetry.properties.operationType = isTargetExistingCollection
        ? 'copyToExistingCollection'
        : 'copyToDatabase';
    context.telemetry.properties.targetNodeType = targetNode instanceof CollectionItem ? 'collection' : 'database';

    const targetCollectionName = isTargetExistingCollection
        ? (targetNode as CollectionItem).collectionInfo.name
        : undefined;

    let sourceCollectionSize: number | undefined = undefined;
    try {
        sourceCollectionSize = await (
            await ClustersClient.getClient(sourceNode.cluster.id)
        ).estimateDocumentCount(sourceNode.databaseInfo.name, sourceNode.collectionInfo.name);
        context.telemetry.measurements.sourceCollectionSize = sourceCollectionSize;
    } catch (error) {
        context.telemetry.properties.sourceCollectionSizeError = String(error);
    }

    // Create wizard context
    const wizardContext: PasteCollectionWizardContext = {
        ...context,
        sourceCollectionName: sourceNode.collectionInfo.name,
        sourceDatabaseName: sourceNode.databaseInfo.name,
        sourceConnectionId: sourceNode.cluster.id,
        sourceConnectionName: sourceNode.cluster.name,
        sourceCollectionSize,
        targetNode,
        targetConnectionId: targetNode.cluster.id,
        targetConnectionName: targetNode.cluster.name,
        targetDatabaseName: targetNode.databaseInfo.name,
        targetCollectionName,
        isTargetExistingCollection,
    };

    // Check for circular dependency when pasting into the same collection
    if (
        isTargetExistingCollection &&
        wizardContext.sourceConnectionId === wizardContext.targetConnectionId &&
        wizardContext.sourceDatabaseName === wizardContext.targetDatabaseName &&
        wizardContext.sourceCollectionName === wizardContext.targetCollectionName
    ) {
        const errorTitle = l10n.t('Cannot copy collection to itself');
        const errorDetail = l10n.t(
            'This operation is not supported as it would create a circular dependency and never terminate. Please select a different target collection or database.',
        );
        void vscode.window.showErrorMessage(errorTitle, { modal: true, detail: errorDetail });
        context.telemetry.properties.sameCollectionTarget = 'true';
        context.telemetry.properties.wizardCompletedSuccessfully = 'false';
        context.telemetry.properties.wizardFailureReason = 'circularDependency';
        return;
    }

    // Create wizard with appropriate steps
    const promptSteps: AzureWizardPromptStep<PasteCollectionWizardContext>[] = [];

    // Only prompt for new collection name if pasting into a database (creating new collection)
    if (!isTargetExistingCollection) {
        promptSteps.push(new PromptNewCollectionNameStep());
    }

    // Only prompt for conflict resolution when pasting into an existing collection
    if (isTargetExistingCollection) {
        promptSteps.push(new PromptConflictResolutionStep());
    } else {
        wizardContext.conflictResolutionStrategy = ConflictResolutionStrategy.Abort;
    }

    // TODO: We don't support copying indexes yet, so skip this step for now,
    // but keep this here to speed up development once we get to that point
    // --> promptSteps.push(new PromptIndexConfigurationStep());

    promptSteps.push(new ConfirmOperationStep());

    // Record telemetry for wizard configuration
    context.telemetry.measurements.totalPromptSteps = promptSteps.length;

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Paste Collection'),
        promptSteps,
        executeSteps: [new ExecuteStep()],
    });

    try {
        // Record prompt phase timing
        const promptStartTime = Date.now();
        context.telemetry.measurements.promptPhaseStartTime = promptStartTime;

        await wizard.prompt();

        const promptEndTime = Date.now();
        context.telemetry.measurements.promptPhaseEndTime = promptEndTime;
        context.telemetry.measurements.promptPhaseDuration = promptEndTime - promptStartTime;
        context.telemetry.properties.promptPhaseCompleted = 'true';

        await wizard.execute();

        context.telemetry.properties.executePhaseCompleted = 'true';
        context.telemetry.properties.wizardCompletedSuccessfully = 'true';
    } catch (error) {
        // Record failure telemetry
        context.telemetry.properties.wizardCompletedSuccessfully = 'false';

        if (error instanceof Error && error.message.includes('cancelled')) {
            // User cancelled the wizard, don't show error
            context.telemetry.properties.wizardFailureReason = 'userCancelled';
            context.telemetry.properties.wizardCancelledByUser = 'true';
            return;
        }

        context.telemetry.properties.wizardFailureReason = 'executionError';
        context.telemetry.properties.wizardErrorMessage = error instanceof Error ? error.message : String(error);

        const errorMessage = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(l10n.t('Failed to paste collection: {0}', errorMessage));
        throw error;
    }
}
