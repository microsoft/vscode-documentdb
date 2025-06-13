/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Example usage of the CopyPasteCollectionTask
 * 
 * This file demonstrates how to use the Copy-and-Paste functionality
 * to copy documents from one MongoDB collection to another.
 */

import {
    ConflictResolutionStrategy,
    CopyPasteCollectionTask,
    type CopyPasteConfig,
    MongoDocumentReader,
    MongoDocumentWriter,
    TaskStatus,
} from './index';

/**
 * Example function showing how to create and execute a copy-paste task
 */
export async function copyCollectionExample(): Promise<void> {
    // Configuration for the copy operation
    const config: CopyPasteConfig = {
        source: {
            connectionId: 'source-connection-id',
            databaseName: 'source-database',
            collectionName: 'source-collection',
        },
        target: {
            connectionId: 'target-connection-id', // Can be the same as source for same server
            databaseName: 'target-database',      // Can be the same as source for same database
            collectionName: 'target-collection',
        },
        onConflict: ConflictResolutionStrategy.Abort,
    };

    // Create MongoDB-specific reader and writer
    const reader = new MongoDocumentReader();
    const writer = new MongoDocumentWriter();

    // Create the task
    const task = new CopyPasteCollectionTask(
        'copy-task-' + Date.now(), // Unique task ID
        'Copy documents from source to target collection',
        config,
        reader,
        writer,
    );

    // Set up progress and status monitoring
    const statusUnsubscribe = task.onStatusChange((t) => {
        console.log(`Task status changed to: ${t.status}`);
        if (t.error) {
            console.error(`Task error: ${t.error.message}`);
        }
    });

    const progressUnsubscribe = task.onProgressChange((t) => {
        if (t.progress) {
            const percentage = t.progress.total > 0 
                ? Math.round((t.progress.completed / t.progress.total) * 100)
                : 0;
            console.log(`Progress: ${t.progress.completed}/${t.progress.total} (${percentage}%) - ${t.progress.message}`);
        }
    });

    try {
        // Execute the task
        await task.execute();
        
        if (task.status === TaskStatus.Completed) {
            console.log('Copy operation completed successfully!');
            console.log(`Final progress: ${task.progress?.completed}/${task.progress?.total} documents copied`);
        }
    } catch (error) {
        console.error('Copy operation failed:', error);
    } finally {
        // Clean up subscriptions
        statusUnsubscribe();
        progressUnsubscribe();
    }
}

/**
 * Example showing how to handle cancellation
 */
export async function copyWithCancellationExample(): Promise<void> {
    const config: CopyPasteConfig = {
        source: { connectionId: 'src', databaseName: 'db1', collectionName: 'coll1' },
        target: { connectionId: 'tgt', databaseName: 'db2', collectionName: 'coll2' },
        onConflict: ConflictResolutionStrategy.Abort,
    };

    const task = new CopyPasteCollectionTask(
        'cancellable-copy-task',
        'Copy with cancellation support',
        config,
        new MongoDocumentReader(),
        new MongoDocumentWriter(),
    );

    // Set up a timer to cancel the task after 10 seconds
    const cancelTimer = setTimeout(async () => {
        console.log('Cancelling task...');
        await task.cancel();
    }, 10000);

    try {
        await task.execute();
        clearTimeout(cancelTimer);
        console.log('Task completed before timeout');
    } catch (error) {
        clearTimeout(cancelTimer);
        if (task.status === TaskStatus.Failed && task.error?.message.includes('cancelled')) {
            console.log('Task was successfully cancelled');
        } else {
            console.error('Task failed with error:', error);
        }
    }
}

/**
 * Example showing how to use the task engine components in a command
 */
export async function createCopyPasteCommand(
    sourceConnectionId: string,
    sourceDatabaseName: string,
    sourceCollectionName: string,
    targetConnectionId: string,
    targetDatabaseName: string,
    targetCollectionName: string,
): Promise<void> {
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
        onConflict: ConflictResolutionStrategy.Abort,
    };

    const reader = new MongoDocumentReader();
    const writer = new MongoDocumentWriter();

    const task = new CopyPasteCollectionTask(
        `copy-${sourceConnectionId}-${sourceDatabaseName}-${sourceCollectionName}-to-${targetConnectionId}-${targetDatabaseName}-${targetCollectionName}`,
        `Copy ${sourceDatabaseName}.${sourceCollectionName} to ${targetDatabaseName}.${targetCollectionName}`,
        config,
        reader,
        writer,
    );

    // In a real VS Code extension, you would show progress in the UI
    task.onProgressChange((t) => {
        if (t.progress) {
            // Here you could update a VS Code progress indicator
            // vscode.window.withProgress(...) 
            console.log(`Copying: ${t.progress.completed}/${t.progress.total} documents`);
        }
    });

    await task.execute();
}