/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CopyPasteCollectionTask } from './CopyPasteCollectionTask';
import {
    ConflictResolutionStrategy,
    type BulkWriteResult,
    type CopyPasteConfig,
    type DocumentDetails,
    type DocumentReader,
    type DocumentWriter,
} from './copyPasteTypes';
import { TaskState } from './taskService';

// Mock document reader
class MockDocumentReader implements DocumentReader {
    constructor(private documents: DocumentDetails[], private documentCount: number = documents.length) {}

    async *streamDocuments(): AsyncIterable<DocumentDetails> {
        for (const doc of this.documents) {
            yield doc;
        }
    }

    async countDocuments(): Promise<number> {
        return this.documentCount;
    }
}

// Mock document writer
class MockDocumentWriter implements DocumentWriter {
    public writtenDocuments: DocumentDetails[] = [];
    public writeError?: Error;
    public ensureCollectionCalled = false;

    async writeDocuments(
        _connectionId: string,
        _databaseName: string,
        _collectionName: string,
        documents: DocumentDetails[],
    ): Promise<BulkWriteResult> {
        if (this.writeError) {
            throw this.writeError;
        }

        this.writtenDocuments.push(...documents);
        return {
            insertedCount: documents.length,
            errors: [],
        };
    }

    async ensureCollectionExists(): Promise<void> {
        this.ensureCollectionCalled = true;
    }
}

describe('CopyPasteCollectionTask', () => {
    let config: CopyPasteConfig;
    let reader: MockDocumentReader;
    let writer: MockDocumentWriter;

    beforeEach(() => {
        config = {
            source: {
                connectionId: 'source-conn',
                databaseName: 'sourceDb',
                collectionName: 'sourceColl',
            },
            target: {
                connectionId: 'target-conn',
                databaseName: 'targetDb',
                collectionName: 'targetColl',
            },
            onConflict: ConflictResolutionStrategy.Abort,
        };

        reader = new MockDocumentReader([]);
        writer = new MockDocumentWriter();
    });

    describe('constructor', () => {
        it('should create task with correct initial state', () => {
            const task = new CopyPasteCollectionTask(config, reader, writer);

            expect(task.type).toBe('copy-paste-collection');
            expect(task.name).toContain('Copy collection sourceColl to targetColl');
            expect(task.id).toBeTruthy();

            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Pending);
            expect(status.progress).toBe(0);
            expect(status.message).toBe('Task created');
        });
    });

    describe('start', () => {
        it('should successfully copy documents from source to target', async () => {
            const testDocuments: DocumentDetails[] = [
                { id: '1', documentContent: { _id: '1', name: 'doc1' } },
                { id: '2', documentContent: { _id: '2', name: 'doc2' } },
                { id: '3', documentContent: { _id: '3', name: 'doc3' } },
            ];

            reader = new MockDocumentReader(testDocuments);
            const task = new CopyPasteCollectionTask(config, reader, writer);

            await task.start();

            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Completed);
            expect(status.progress).toBe(100);
            expect(writer.writtenDocuments).toHaveLength(3);
            expect(writer.ensureCollectionCalled).toBe(true);
            expect(writer.writtenDocuments[0].documentContent).toEqual({ _id: '1', name: 'doc1' });
        });

        it('should handle empty collections', async () => {
            reader = new MockDocumentReader([]);
            const task = new CopyPasteCollectionTask(config, reader, writer);

            await task.start();

            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Completed);
            expect(status.progress).toBe(100);
            expect(writer.writtenDocuments).toHaveLength(0);
            expect(writer.ensureCollectionCalled).toBe(true);
        });

        it('should fail and abort on write errors when using Abort strategy', async () => {
            const testDocuments: DocumentDetails[] = [
                { id: '1', documentContent: { _id: '1', name: 'doc1' } },
            ];

            reader = new MockDocumentReader(testDocuments);
            writer.writeError = new Error('Write failed');
            const task = new CopyPasteCollectionTask(config, reader, writer);

            await expect(task.start()).rejects.toThrow('Write failed');

            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Failed);
            expect(status.error).toBeInstanceOf(Error);
        });

        it('should throw error if task is already running', async () => {
            reader = new MockDocumentReader([]);
            const task = new CopyPasteCollectionTask(config, reader, writer);

            // Start the task without awaiting
            const promise1 = task.start();

            // Try to start again while running
            await expect(task.start()).rejects.toThrow('Task is already running');

            // Wait for first start to complete
            await promise1;
        });

        it('should throw error if task is not in pending state', async () => {
            reader = new MockDocumentReader([]);
            const task = new CopyPasteCollectionTask(config, reader, writer);

            await task.start(); // Complete the task

            // Try to start again
            await expect(task.start()).rejects.toThrow('Cannot start task in state: completed');
        });
    });

    describe('stop', () => {
        it('should stop a running task gracefully', async () => {
            // Create a slow reader that yields documents slowly
            const slowReader = {
                async *streamDocuments(): AsyncIterable<DocumentDetails> {
                    for (let i = 0; i < 1000; i++) {
                        yield { id: `${i}`, documentContent: { _id: `${i}`, value: i } };
                        // Add small delay to make task stoppable
                        await new Promise((resolve) => setTimeout(resolve, 1));
                    }
                },
                async countDocuments(): Promise<number> {
                    return 1000;
                },
            };

            const task = new CopyPasteCollectionTask(config, slowReader, writer);

            // Start the task
            const startPromise = task.start();

            // Wait a bit to let it start
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Stop the task
            await task.stop();

            // Wait for start to complete
            await startPromise;

            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Stopped);
        });

        it('should do nothing if task is not running', async () => {
            const task = new CopyPasteCollectionTask(config, reader, writer);

            await task.stop(); // Should not throw

            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Pending); // Should remain pending
        });
    });

    describe('delete', () => {
        it('should cleanup resources', async () => {
            const task = new CopyPasteCollectionTask(config, reader, writer);

            await task.delete(); // Should not throw

            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Pending); // Should not change state
        });
    });

    describe('progress tracking', () => {
        it('should report progress during copy operation', async () => {
            const testDocuments: DocumentDetails[] = Array.from({ length: 10 }, (_, i) => ({
                id: `${i}`,
                documentContent: { _id: `${i}`, value: i },
            }));

            reader = new MockDocumentReader(testDocuments);
            const task = new CopyPasteCollectionTask(config, reader, writer);

            const progressValues: number[] = [];
            const originalUpdateStatus = (task as unknown as { updateStatus: (updates: { progress?: number }) => void }).updateStatus;
            (task as unknown as { updateStatus: (updates: { progress?: number }) => void }).updateStatus = (updates: { progress?: number }) => {
                originalUpdateStatus.call(task, updates);
                if (updates.progress !== undefined) {
                    progressValues.push(updates.progress);
                }
            };

            await task.start();

            // Should have progress updates
            expect(progressValues.length).toBeGreaterThan(0);
            expect(progressValues[progressValues.length - 1]).toBe(100); // Final progress should be 100
        });
    });
});