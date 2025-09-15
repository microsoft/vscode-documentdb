/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { TaskService } from '../../services/taskService';
import { CopyPasteCollectionTask } from '../../services/tasks/copy-and-paste/CopyPasteCollectionTask';
import { type CopyPasteConfig } from '../../services/tasks/copy-and-paste/copyPasteConfig';
import { DocumentDbDocumentReader } from '../../services/tasks/copy-and-paste/documentdb/documentDbDocumentReader';
import { DocumentDbDocumentWriter } from '../../services/tasks/copy-and-paste/documentdb/documentDbDocumentWriter';
import { nonNullValue } from '../../utils/nonNull';
import { type PasteCollectionWizardContext } from './PasteCollectionWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<PasteCollectionWizardContext> {
    public priority: number = 100;

    public async execute(context: PasteCollectionWizardContext): Promise<void> {
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
            'context.conflictResolutionStrategy',
            'ExecuteStep.ts',
        );

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

        // Start the copy-paste task
        await task.start();
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
