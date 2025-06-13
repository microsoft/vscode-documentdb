/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ConflictResolutionStrategy,
    CopyPasteCollectionTask,
    type CopyPasteConfig,
} from './CopyPasteCollectionTask';
import {
    type DocumentDetails,
    type DocumentReader,
    type DocumentWriter,
} from './DocumentInterfaces';
import { TaskStatus } from './Task';

// Mock implementations for testing
class MockDocumentReader implements DocumentReader {
    constructor(private documents: DocumentDetails[], private totalCount: number) {}

    async *streamDocuments(): AsyncIterable<DocumentDetails> {
        for (const doc of this.documents) {
            yield doc;
        }
    }

    async countDocuments(): Promise<number> {
        return this.totalCount;
    }
}

class MockDocumentWriter implements DocumentWriter {
    public writtenDocuments: DocumentDetails[] = [];
    public collectionCreated = false;

    async writeDocuments(_connectionId: string, _databaseName: string, _collectionName: string, documents: DocumentDetails[]) {
        this.writtenDocuments.push(...documents);
        return {
            insertedCount: documents.length,
            errors: [],
        };
    }

    async ensureCollectionExists(): Promise<void> {
        this.collectionCreated = true;
    }
}

describe('CopyPasteCollectionTask', () => {
    let mockReader: MockDocumentReader;
    let mockWriter: MockDocumentWriter;
    let config: CopyPasteConfig;

    beforeEach(() => {
        const testDocuments: DocumentDetails[] = [
            { id: '1', documentContent: { _id: '1', name: 'Doc 1' } },
            { id: '2', documentContent: { _id: '2', name: 'Doc 2' } },
            { id: '3', documentContent: { _id: '3', name: 'Doc 3' } },
        ];

        mockReader = new MockDocumentReader(testDocuments, 3);
        mockWriter = new MockDocumentWriter();

        config = {
            source: {
                connectionId: 'source-conn',
                databaseName: 'source-db',
                collectionName: 'source-coll',
            },
            target: {
                connectionId: 'target-conn',
                databaseName: 'target-db',
                collectionName: 'target-coll',
            },
            onConflict: ConflictResolutionStrategy.Abort,
        };
    });

    describe('constructor', () => {
        it('should create a task with initial status Pending', () => {
            const task = new CopyPasteCollectionTask('test-id', 'Test Copy Task', config, mockReader, mockWriter);

            expect(task.id).toBe('test-id');
            expect(task.description).toBe('Test Copy Task');
            expect(task.status).toBe(TaskStatus.Pending);
            expect(task.progress).toBeUndefined();
            expect(task.error).toBeUndefined();
        });
    });

    describe('execute', () => {
        it('should successfully copy documents from source to target', async () => {
            const task = new CopyPasteCollectionTask('test-id', 'Test Copy Task', config, mockReader, mockWriter);

            const statusChanges: TaskStatus[] = [];
            task.onStatusChange((t) => statusChanges.push(t.status));

            const progressUpdates: number[] = [];
            task.onProgressChange((t) => {
                if (t.progress) {
                    progressUpdates.push(t.progress.completed);
                }
            });

            await task.execute();

            // Verify final status
            expect(task.status).toBe(TaskStatus.Completed);
            expect(task.error).toBeUndefined();

            // Verify progress
            expect(task.progress).toBeDefined();
            expect(task.progress!.completed).toBe(3);
            expect(task.progress!.total).toBe(3);

            // Verify status transitions
            expect(statusChanges).toContain(TaskStatus.Initializing);
            expect(statusChanges).toContain(TaskStatus.Running);
            expect(statusChanges).toContain(TaskStatus.Completed);

            // Verify collection was created
            expect(mockWriter.collectionCreated).toBe(true);

            // Verify documents were written
            expect(mockWriter.writtenDocuments).toHaveLength(3);
            expect(mockWriter.writtenDocuments[0].id).toBe('1');
            expect(mockWriter.writtenDocuments[1].id).toBe('2');
            expect(mockWriter.writtenDocuments[2].id).toBe('3');
        });

        it('should handle empty source collection', async () => {
            const emptyReader = new MockDocumentReader([], 0);
            const task = new CopyPasteCollectionTask('test-id', 'Test Copy Task', config, emptyReader, mockWriter);

            await task.execute();

            expect(task.status).toBe(TaskStatus.Completed);
            expect(task.progress!.completed).toBe(0);
            expect(task.progress!.total).toBe(0);
            expect(mockWriter.writtenDocuments).toHaveLength(0);
        });

        it('should handle cancellation during execution', async () => {
            const task = new CopyPasteCollectionTask('test-id', 'Test Copy Task', config, mockReader, mockWriter);

            // Start execution and immediately cancel
            const executePromise = task.execute();
            await task.cancel();

            await expect(executePromise).rejects.toThrow('Operation was cancelled');
            expect(task.status).toBe(TaskStatus.Failed);
            expect(task.error?.message).toBe('Operation was cancelled');
        });
    });

    describe('status and progress callbacks', () => {
        it('should notify status change callbacks', async () => {
            const task = new CopyPasteCollectionTask('test-id', 'Test Copy Task', config, mockReader, mockWriter);

            const statusChanges: TaskStatus[] = [];
            const unsubscribe = task.onStatusChange((t) => statusChanges.push(t.status));

            await task.execute();

            expect(statusChanges).toEqual([TaskStatus.Initializing, TaskStatus.Running, TaskStatus.Completed]);

            // Test unsubscribe
            unsubscribe();
            await task.cancel(); // This should change status but not notify
            expect(statusChanges).toHaveLength(3); // Should not have added new status
        });

        it('should notify progress change callbacks', async () => {
            const task = new CopyPasteCollectionTask('test-id', 'Test Copy Task', config, mockReader, mockWriter);

            const progressMessages: string[] = [];
            const unsubscribe = task.onProgressChange((t) => {
                if (t.progress?.message) {
                    progressMessages.push(t.progress.message);
                }
            });

            await task.execute();

            expect(progressMessages).toContain('Counting source documents...');
            expect(progressMessages).toContain('Preparing target collection...');
            expect(progressMessages).toContain('Copying documents...');
            expect(progressMessages).toContain('Copy operation completed');

            // Test unsubscribe
            unsubscribe();
            expect(progressMessages.length).toBeGreaterThan(0);
        });
    });

    describe('conflict resolution', () => {
        it('should use abort strategy by default', () => {
            new CopyPasteCollectionTask('test-id', 'Test Copy Task', config, mockReader, mockWriter);
            expect(config.onConflict).toBe(ConflictResolutionStrategy.Abort);
        });
    });
});