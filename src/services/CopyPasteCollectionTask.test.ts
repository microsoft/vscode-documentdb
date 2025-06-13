/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

// Mock implementations for testing
class MockDocumentReader implements DocumentReader {
    constructor(private documents: DocumentDetails[] = []) {}

    async *streamDocuments(
        _connectionId: string,
        _databaseName: string,
        _collectionName: string,
    ): AsyncGenerator<DocumentDetails> {
        for (const doc of this.documents) {
            yield doc;
        }
    }

    async countDocuments(_connectionId: string, _databaseName: string, _collectionName: string): Promise<number> {
        return this.documents.length;
    }
}

class MockDocumentWriter implements DocumentWriter {
    public writtenDocuments: DocumentDetails[] = [];
    public collectionExists: boolean = false;
    private shouldFail: boolean = false;

    setShouldFail(fail: boolean): void {
        this.shouldFail = fail;
    }

    async writeDocuments(
        _connectionId: string,
        _databaseName: string,
        _collectionName: string,
        documents: DocumentDetails[],
    ): Promise<BulkWriteResult> {
        if (this.shouldFail) {
            return {
                insertedCount: 0,
                errors: documents.map(doc => ({
                    documentId: doc.id,
                    error: new Error('Mock write error'),
                })),
            };
        }

        this.writtenDocuments.push(...documents);
        return {
            insertedCount: documents.length,
            errors: [],
        };
    }

    async ensureCollectionExists(_connectionId: string, _databaseName: string, _collectionName: string): Promise<void> {
        this.collectionExists = true;
    }
}

describe('CopyPasteCollectionTask', () => {
    const createConfig = (): CopyPasteConfig => ({
        source: {
            connectionId: 'source-conn',
            databaseName: 'source-db',
            collectionName: 'source-collection',
        },
        target: {
            connectionId: 'target-conn',
            databaseName: 'target-db',
            collectionName: 'target-collection',
        },
        onConflict: ConflictResolutionStrategy.Abort,
    });

    const createTestDocuments = (count: number): DocumentDetails[] => {
        return Array.from({ length: count }, (_, i) => ({
            id: `doc-${i}`,
            documentContent: { field: `value-${i}`, number: i },
        }));
    };

    it('should initialize with pending status', () => {
        const config = createConfig();
        const reader = new MockDocumentReader();
        const writer = new MockDocumentWriter();
        const task = new CopyPasteCollectionTask('test-id', config, reader, writer);

        expect(task.id).toBe('test-id');
        expect(task.status).toBe(TaskStatus.Pending);
        expect(task.progress).toBe(0);
    });

    it('should successfully copy documents from source to target', async () => {
        const testDocuments = createTestDocuments(3);
        const config = createConfig();
        const reader = new MockDocumentReader(testDocuments);
        const writer = new MockDocumentWriter();
        const task = new CopyPasteCollectionTask('test-id', config, reader, writer);

        await task.execute();

        expect(task.status).toBe(TaskStatus.Completed);
        expect(task.progress).toBe(100);
        expect(writer.collectionExists).toBe(true);
        expect(writer.writtenDocuments).toHaveLength(3);
        expect(writer.writtenDocuments).toEqual(testDocuments);
    });

    it('should handle empty source collection', async () => {
        const config = createConfig();
        const reader = new MockDocumentReader([]);
        const writer = new MockDocumentWriter();
        const task = new CopyPasteCollectionTask('test-id', config, reader, writer);

        await task.execute();

        expect(task.status).toBe(TaskStatus.Completed);
        expect(task.progress).toBe(100);
        expect(writer.writtenDocuments).toHaveLength(0);
    });

    it('should abort on write errors when conflict resolution is Abort', async () => {
        const testDocuments = createTestDocuments(2);
        const config = createConfig();
        const reader = new MockDocumentReader(testDocuments);
        const writer = new MockDocumentWriter();
        writer.setShouldFail(true);
        const task = new CopyPasteCollectionTask('test-id', config, reader, writer);

        await expect(task.execute()).rejects.toThrow('Write operation failed');
        expect(task.status).toBe(TaskStatus.Failed);
        expect(task.error).toBeDefined();
    });

    it('should handle task cancellation', async () => {
        const testDocuments = createTestDocuments(100);
        const config = createConfig();
        const reader = new MockDocumentReader(testDocuments);
        const writer = new MockDocumentWriter();
        const task = new CopyPasteCollectionTask('test-id', config, reader, writer);

        // Start the task
        const executePromise = task.execute();
        
        // Cancel it immediately
        await task.cancel();

        // The task should fail due to cancellation
        await expect(executePromise).rejects.toThrow('Task was cancelled');
        expect(task.status).toBe(TaskStatus.Failed);
        expect(task.cancelled).toBe(true);
    });

    it('should track progress during execution', async () => {
        const testDocuments = createTestDocuments(5);
        const config = createConfig();
        const reader = new MockDocumentReader(testDocuments);
        const writer = new MockDocumentWriter();
        const task = new CopyPasteCollectionTask('test-id', config, reader, writer);

        // Track initial progress
        const initialProgress = task.progress;
        expect(initialProgress).toBe(0);

        await task.execute();

        expect(task.status).toBe(TaskStatus.Completed);
        expect(task.progress).toBe(100);
        expect(task.progress).toBeGreaterThan(initialProgress);
    });

    it('should not allow execution when task is not in pending status', async () => {
        const config = createConfig();
        const reader = new MockDocumentReader();
        const writer = new MockDocumentWriter();
        const task = new CopyPasteCollectionTask('test-id', config, reader, writer);

        // Execute once
        await task.execute();
        expect(task.status).toBe(TaskStatus.Completed);

        // Try to execute again
        await expect(task.execute()).rejects.toThrow('Task test-id cannot be executed in status completed');
    });
});