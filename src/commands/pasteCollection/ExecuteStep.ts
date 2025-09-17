/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { TaskService, TaskState } from '../../services/taskService/taskService';
import { CopyPasteCollectionTask } from '../../services/taskService/tasks/copy-and-paste/CopyPasteCollectionTask';
import { type CopyPasteConfig } from '../../services/taskService/tasks/copy-and-paste/copyPasteConfig';
import { DocumentDbDocumentReader } from '../../services/taskService/tasks/copy-and-paste/documentdb/documentDbDocumentReader';
import { DocumentDbDocumentWriter } from '../../services/taskService/tasks/copy-and-paste/documentdb/documentDbDocumentWriter';
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
                connectionId: sourceConnectionId,
                databaseName: sourceDatabaseName,
                collectionName: sourceCollectionName,
            },
            target: {
                connectionId: targetConnectionId,
                databaseName: targetDatabaseName,
                collectionName: finalTargetCollectionName,
            },
            onConflict: conflictResolutionStrategy,
        };

        // Create the document reader and writer instances
        const reader = new DocumentDbDocumentReader();
        const writer = new DocumentDbDocumentWriter();

        // Create the copy-paste task
        const task = new CopyPasteCollectionTask(config, reader, writer);

        // Register task with the task service
        TaskService.registerTask(task);

        // If the target is a database node, we need to refresh it once the task is working
        // so the new collection appears in the tree view
        if (context.targetNode instanceof DatabaseItem) {
            // Subscribe to task status updates to know when to refresh the tree
            const subscription = task.onDidChangeState(async (stateChange) => {
                // Once the task completes the Initializing state, refresh the database node
                if (stateChange.previousState === TaskState.Initializing) {
                    await new Promise<void>((resolve) => setTimeout(() => resolve(), 1000));
                    // Refresh the database node to show the new collection
                    ext.state.notifyChildrenChanged(context.targetNode.id);
                    // Unsubscribe since we only need to refresh once
                    subscription.dispose();
                }
            });
        }

        // Start the copy-paste task
        void task.start();
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
