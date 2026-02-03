/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { DocumentDbDocumentReader } from '../../services/taskService/data-api/readers/DocumentDbDocumentReader';
import { DocumentDbStreamingWriter } from '../../services/taskService/data-api/writers/DocumentDbStreamingWriter';
import { CopyPasteCollectionTask } from '../../services/taskService/tasks/copy-and-paste/CopyPasteCollectionTask';
import { type CopyPasteConfig } from '../../services/taskService/tasks/copy-and-paste/copyPasteConfig';
import { isTerminalState, TaskService, TaskState, type Task } from '../../services/taskService/taskService';
import { DatabaseItem } from '../../tree/documentdb/DatabaseItem';
import { nonNullValue } from '../../utils/nonNull';
import { type PasteCollectionWizardContext } from './PasteCollectionWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<PasteCollectionWizardContext> {
    public priority: number = 100;

    public async execute(context: PasteCollectionWizardContext): Promise<void> {
        // Record initial telemetry for execution attempt
        context.telemetry.properties.executionStarted = 'true';

        // Extract all required values from the wizard context
        const sourceConnectionId = context.sourceConnectionId;
        const sourceDatabaseName = context.sourceDatabaseName;
        const sourceCollectionName = context.sourceCollectionName;

        const targetConnectionId = context.targetConnectionId;
        const targetDatabaseName = context.targetDatabaseName;
        // Determine the final target collection name based on whether we're using an existing collection or creating a new one
        const finalTargetCollectionName = context.isTargetExistingCollection
            ? nonNullValue(context.targetCollectionName, 'targetCollectionName', 'context.targetCollectionName')
            : nonNullValue(context.newCollectionName, 'newCollectionName', 'context.targetCollectionName');

        const conflictResolutionStrategy = nonNullValue(
            context.conflictResolutionStrategy,
            'conflictResolutionStrategy',
            'context.conflictResolutionStrategy',
        );

        // Record telemetry for task configuration
        context.telemetry.properties.isCrossConnection = sourceConnectionId !== targetConnectionId ? 'true' : 'false';
        context.telemetry.properties.isCrossDatabase = sourceDatabaseName !== targetDatabaseName ? 'true' : 'false';
        context.telemetry.properties.sameCollectionName =
            sourceCollectionName === finalTargetCollectionName ? 'true' : 'false';

        // Build the configuration for the copy-paste task
        const config: CopyPasteConfig = {
            source: {
                clusterId: sourceConnectionId,
                databaseName: sourceDatabaseName,
                collectionName: sourceCollectionName,
            },
            target: {
                clusterId: targetConnectionId,
                databaseName: targetDatabaseName,
                collectionName: finalTargetCollectionName,
            },
            onConflict: conflictResolutionStrategy,
        };

        // Create the document reader and writer instances
        const reader = new DocumentDbDocumentReader(sourceConnectionId, sourceDatabaseName, sourceCollectionName);
        const targetClient = await ClustersClient.getClient(targetConnectionId);
        const writer = new DocumentDbStreamingWriter(targetClient, targetDatabaseName, finalTargetCollectionName);

        // Create the copy-paste task
        const task = new CopyPasteCollectionTask(config, reader, writer);

        // Register task with the task service
        TaskService.registerTask(task);

        // Calculate database IDs upfront to determine refresh behavior
        const targetDatabaseId =
            context.targetNode instanceof DatabaseItem
                ? context.targetNode.id
                : context.targetNode.id.substring(0, context.targetNode.id.lastIndexOf('/'));

        const sourceDatabaseId = ext.copiedCollectionNode?.id
            ? ext.copiedCollectionNode.id.substring(0, ext.copiedCollectionNode.id.lastIndexOf('/'))
            : undefined;

        // Determine if source and target are in the same database
        const isSameDatabase = sourceDatabaseId === targetDatabaseId;

        // Set up tree annotations to show progress on source and target nodes
        // For the source: skip auto-refresh if it's in the same database as target (will be covered by target refresh)
        if (ext.copiedCollectionNode?.id) {
            void this.annotateNodeDuringTask(
                ext.copiedCollectionNode.id,
                vscode.l10n.t('Copying…'),
                task,
                isSameDatabase,
            );
        }

        // For database targets: annotate the new collection once it's created
        // For collection targets: annotate the collection directly
        if (context.targetNode instanceof DatabaseItem) {
            const newCollectionId = `${targetDatabaseId}/${finalTargetCollectionName}`;
            // Annotate new collection from after Initializing until task ends
            void this.annotateNodeAfterState(
                newCollectionId,
                vscode.l10n.t('Pasting…'),
                task,
                TaskState.Initializing,
                true,
            );
        } else {
            void this.annotateNodeDuringTask(context.targetNode.id, vscode.l10n.t('Pasting…'), task, true);
        }

        // Subscribe to task status updates to know when to refresh the tree:
        // 1. When pasting into a database, refresh after Initializing so the new collection appears
        // 2. When task completes (success or failure), refresh at database level so collection
        //    descriptions (document counts) update correctly
        const subscription = task.onDidChangeState(async (stateChange) => {
            // For database targets: refresh early so new collection appears in tree
            if (context.targetNode instanceof DatabaseItem && stateChange.previousState === TaskState.Initializing) {
                await new Promise<void>((resolve) => setTimeout(resolve, 1000));
                ext.state.notifyChildrenChanged(targetDatabaseId);
            }

            // On terminal state (success or failure): always refresh at database level
            // This ensures collection document counts update correctly and annotations are cleared
            if (isTerminalState(stateChange.newState)) {
                // Small delay to ensure backend has processed changes
                await new Promise<void>((resolve) => setTimeout(resolve, 1000));
                ext.state.notifyChildrenChanged(targetDatabaseId);

                subscription.dispose();
            }
        });

        // Start the copy-paste task
        void task.start();
    }

    /**
     * Annotates a tree node with a temporary description while the task is running.
     * The annotation is automatically cleared when the task reaches a terminal state.
     * @param nodeId - The ID of the node to annotate
     * @param label - The temporary description to show
     * @param task - The task to monitor for completion
     * @param dontRefreshOnRemove - If true, prevents automatic refresh when the annotation is removed
     */
    private annotateNodeDuringTask(nodeId: string, label: string, task: Task, dontRefreshOnRemove?: boolean): void {
        void ext.state.runWithTemporaryDescription(
            nodeId,
            label,
            () => {
                return new Promise<void>((resolve) => {
                    const subscription = task.onDidChangeState((event) => {
                        if (isTerminalState(event.newState)) {
                            subscription.dispose();
                            resolve();
                        }
                    });
                });
            },
            dontRefreshOnRemove,
        );
    }

    /**
     * Annotates a tree node with a temporary description starting after a specific state is exited.
     * @param nodeId - The ID of the node to annotate
     * @param label - The temporary description to show
     * @param task - The task to monitor
     * @param afterState - The state that, when exited, starts the annotation
     * @param dontRefreshOnRemove - If true, prevents automatic refresh when the annotation is removed
     */
    private annotateNodeAfterState(
        nodeId: string,
        label: string,
        task: Task,
        afterState: TaskState,
        dontRefreshOnRemove?: boolean,
    ): void {
        // Wait for the afterState to be exited, then start the annotation
        const startSubscription = task.onDidChangeState((event) => {
            if (event.previousState === afterState) {
                startSubscription.dispose();
                // Now annotate until terminal state
                void this.annotateNodeDuringTask(nodeId, label, task, dontRefreshOnRemove);
            } else if (isTerminalState(event.newState)) {
                // Task ended before we could start - clean up
                startSubscription.dispose();
            }
        });
    }

    public shouldExecute(context: PasteCollectionWizardContext): boolean {
        // Execute only if we have all required configuration from the wizard
        const hasRequiredSourceInfo = !!(
            context.sourceConnectionId &&
            context.sourceDatabaseName &&
            context.sourceCollectionName
        );

        const hasRequiredTargetInfo = !!(context.targetConnectionId && context.targetDatabaseName);

        const hasTargetCollectionName = context.isTargetExistingCollection
            ? !!context.targetCollectionName
            : !!context.newCollectionName;

        const hasConflictResolution = !!context.conflictResolutionStrategy;

        return hasRequiredSourceInfo && hasRequiredTargetInfo && hasTargetCollectionName && hasConflictResolution;
    }
}
