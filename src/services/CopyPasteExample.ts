/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Example usage of the CopyPasteCollectionTask
 * This demonstrates how to use the task system for copy-paste operations
 */

import { CopyPasteCollectionTask } from './CopyPasteCollectionTask';
import {
    ConflictResolutionStrategy,
    type CopyPasteConfig,
    type DocumentDetails,
    type DocumentReader,
    type DocumentWriter,
    type BulkWriteResult,
} from './CopyPasteInterfaces';
import { TaskStatus } from './TaskEngine';

// Example MongoDB document reader implementation
class MongoDocumentReader implements DocumentReader {
    async *streamDocuments(
        _connectionId: string,
        _databaseName: string,
        _collectionName: string,
    ): AsyncGenerator<DocumentDetails> {
        // This would typically connect to MongoDB and stream documents
        // For example purposes, yielding mock data
        const mockDocuments = [
            { id: '507f1f77bcf86cd799439011', documentContent: { name: 'John', age: 30 } },
            { id: '507f1f77bcf86cd799439012', documentContent: { name: 'Jane', age: 25 } },
        ];

        for (const doc of mockDocuments) {
            yield doc;
        }
    }

    async countDocuments(_connectionId: string, _databaseName: string, _collectionName: string): Promise<number> {
        // This would typically query MongoDB for the count
        return 2; // Mock count
    }
}

// Example MongoDB document writer implementation  
class MongoDocumentWriter implements DocumentWriter {
    async writeDocuments(
        _connectionId: string,
        _databaseName: string,
        _collectionName: string,
        documents: DocumentDetails[],
    ): Promise<BulkWriteResult> {
        // This would typically perform bulk insert to MongoDB
        // For example purposes, simulate successful write
        return {
            insertedCount: documents.length,
            errors: [],
        };
    }

    async ensureCollectionExists(_connectionId: string, databaseName: string, collectionName: string): Promise<void> {
        // This would typically create the collection if it doesn't exist
        console.log(`Ensuring collection exists: ${databaseName}.${collectionName}`);
    }
}

// Example usage function
export async function exampleCopyPasteUsage(): Promise<void> {
    // Configuration for the copy-paste operation
    const config: CopyPasteConfig = {
        source: {
            connectionId: 'source-connection-id',
            databaseName: 'sourceDB',
            collectionName: 'sourceCollection',
        },
        target: {
            connectionId: 'target-connection-id',
            databaseName: 'targetDB',
            collectionName: 'targetCollection',
        },
        onConflict: ConflictResolutionStrategy.Abort,
    };

    // Create reader and writer instances
    const reader = new MongoDocumentReader();
    const writer = new MongoDocumentWriter();

    // Create and execute the copy-paste task
    const task = new CopyPasteCollectionTask('example-task-id', config, reader, writer);

    console.log(`Task ${task.id} status: ${task.status}`);

    try {
        await task.execute();
        console.log(`Task completed successfully. Status: ${task.status}, Progress: ${task.progress}%`);
    } catch (error) {
        console.error(`Task failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        console.log(`Task status: ${task.status}`);
        if (task.error) {
            console.error(`Task error: ${task.error.message}`);
        }
    }
}

// Example of how to monitor task progress
export async function exampleWithProgressMonitoring(): Promise<void> {
    const config: CopyPasteConfig = {
        source: {
            connectionId: 'source-connection-id',
            databaseName: 'sourceDB',
            collectionName: 'sourceCollection',
        },
        target: {
            connectionId: 'target-connection-id',
            databaseName: 'targetDB',
            collectionName: 'targetCollection',
        },
        onConflict: ConflictResolutionStrategy.Abort,
    };

    const reader = new MongoDocumentReader();
    const writer = new MongoDocumentWriter();
    const task = new CopyPasteCollectionTask('progress-example-task', config, reader, writer);

    // Monitor progress (in a real application, this could be done with intervals)
    const progressInterval = setInterval(() => {
        console.log(`Progress: ${task.progress}% - ${task.progressMessage || 'Processing...'}`);
        
        if (task.status === TaskStatus.Completed || task.status === TaskStatus.Failed) {
            clearInterval(progressInterval);
        }
    }, 1000);

    try {
        await task.execute();
        console.log('Task completed successfully!');
    } catch (error) {
        console.error('Task failed:', error);
    } finally {
        clearInterval(progressInterval);
    }
}