/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type AzureWizardPromptStep, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { CollectionItem } from '../../tree/documentdb/CollectionItem';
import { DatabaseItem } from '../../tree/documentdb/DatabaseItem';
import { ConfirmOperationStep } from './ConfirmOperationStep';
import { type PasteCollectionWizardContext } from './PasteCollectionWizardContext';
import { PromptConflictResolutionStep } from './PromptConflictResolutionStep';
import { PromptIndexConfigurationStep } from './PromptIndexConfigurationStep';
import { PromptNewCollectionNameStep } from './PromptNewCollectionNameStep';

export async function pasteCollection(
    context: IActionContext,
    targetNode: CollectionItem | DatabaseItem,
): Promise<void> {
    if (!targetNode) {
        throw new Error(l10n.t('No target node selected.'));
    }

    // Check if a source collection has been copied
    const sourceNode = ext.copiedCollectionNode;
    if (!sourceNode) {
        context.telemetry.properties.noSourceCollection = 'true';
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

    // Create wizard with appropriate steps
    const promptSteps: AzureWizardPromptStep<PasteCollectionWizardContext>[] = [];

    // Only prompt for new collection name if pasting into a database (creating new collection)
    if (!isTargetExistingCollection) {
        promptSteps.push(new PromptNewCollectionNameStep());
    }

    // Always prompt for conflict resolution and index configuration
    promptSteps.push(new PromptConflictResolutionStep());
    promptSteps.push(new PromptIndexConfigurationStep());
    promptSteps.push(new ConfirmOperationStep());

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Paste Collection'),
        promptSteps,
        executeSteps: [], // No execute steps since we're only scaffolding the UX
    });

    try {
        await wizard.prompt();

        // NOTE: This is where the actual task execution would be called
        // For now, we're only scaffolding the UX, so we just show a message
        void vscode.window.showInformationMessage(
            l10n.t('Wizard completed successfully! (Task execution not implemented yet)'),
        );

        // TODO: Remove this scaffolding code and implement actual task execution:
        // const config: CopyPasteConfig = {
        //     source: {
        //         connectionId: wizardContext.sourceConnectionId,
        //         databaseName: wizardContext.sourceDatabaseName,
        //         collectionName: wizardContext.sourceCollectionName,
        //     },
        //     target: {
        //         connectionId: wizardContext.targetConnectionId,
        //         databaseName: wizardContext.targetDatabaseName,
        //         collectionName: wizardContext.finalTargetCollectionName!,
        //     },
        //     onConflict: wizardContext.conflictResolutionStrategy!,
        // };

        // const reader = new DocumentDbDocumentReader();
        // const writer = new DocumentDbDocumentWriter();
        // const task = new CopyPasteCollectionTask(config, reader, writer);
        // TaskService.registerTask(task);
        // await task.start();
    } catch (error) {
        if (error instanceof Error && error.message.includes('cancelled')) {
            // User cancelled the wizard, don't show error
            return;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(l10n.t('Failed to paste collection: {0}', errorMessage));
        throw error;
    }
}
