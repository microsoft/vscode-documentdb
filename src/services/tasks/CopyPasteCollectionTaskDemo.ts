/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CopyPasteCollectionTask } from './CopyPasteCollectionTask';
import { ConflictResolutionStrategy, type CopyPasteConfig } from './copyPaste';
import { MongoDocumentReader } from './copyPaste/MongoDocumentReader';
import { MongoDocumentWriter } from './copyPaste/MongoDocumentWriter';
import { TaskService } from '../taskService';

/**
 * Example function demonstrating how to create and use a CopyPasteCollectionTask
 * with MongoDB-specific implementations.
 *
 * @param sourceConnectionId Connection ID for the source database
 * @param targetConnectionId Connection ID for the target database  
 * @param sourceDatabaseName Name of the source database
 * @param targetDatabaseName Name of the target database
 * @param sourceCollectionName Name of the source collection
 * @param targetCollectionName Name of the target collection
 * @returns Promise that resolves when the task is registered and started
 */
export async function createMongoCopyPasteTask(
    sourceConnectionId: string,
    targetConnectionId: string,
    sourceDatabaseName: string,
    targetDatabaseName: string,
    sourceCollectionName: string,
    targetCollectionName: string,
): Promise<CopyPasteCollectionTask> {
    // Create the configuration for the copy-paste operation
    const config: CopyPasteConfig = {
        source: {
            connectionId: sourceConnectionId,
            databaseName: sourceDatabaseName,
            collectionName: sourceCollectionName,
        },
        target: {
            connectionId: targetConnectionId,
            databaseName: targetDatabaseName,
            collectionName: targetCollectionName,
        },
        onConflict: ConflictResolutionStrategy.Abort, // Only supported strategy in basic implementation
    };

    // Create MongoDB-specific reader and writer
    const documentReader = new MongoDocumentReader();
    const documentWriter = new MongoDocumentWriter();

    // Create the copy-paste task
    const task = new CopyPasteCollectionTask(config, documentReader, documentWriter);

    // Register the task with the TaskService
    TaskService.registerTask(task);

    // Start the task
    await task.start();

    return task;
}

/**
 * Example function showing how to monitor a copy-paste task's progress.
 *
 * @param task The CopyPasteCollectionTask to monitor
 */
export function monitorCopyPasteTask(task: CopyPasteCollectionTask): void {
    // Subscribe to status changes
    const statusSubscription = task.onDidChangeStatus((status) => {
        console.log(`Task ${task.id}: ${status.state} - ${status.message || ''}`);
        if (status.progress !== undefined) {
            console.log(`  Progress: ${status.progress}%`);
        }
        if (status.error) {
            console.error(`  Error:`, status.error);
        }
    });

    // Subscribe to state changes
    const stateSubscription = task.onDidChangeState((event) => {
        console.log(`Task ${event.taskId}: State changed from ${event.previousState} to ${event.newState}`);
    });

    // Clean up subscriptions when task is complete or failed
    const cleanupSubscriptions = () => {
        statusSubscription.dispose();
        stateSubscription.dispose();
    };

    // Auto-cleanup when task reaches a final state
    task.onDidChangeState((event) => {
        if (['Completed', 'Failed', 'Stopped'].includes(event.newState)) {
            cleanupSubscriptions();
        }
    });
}