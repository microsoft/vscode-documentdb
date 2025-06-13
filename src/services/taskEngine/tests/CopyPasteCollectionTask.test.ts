/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type BulkWriteResult,
    ConflictResolutionStrategy,
    CopyPasteCollectionTask,
    type CopyPasteConfig,
    type DocumentDetails,
    type DocumentReader,
    type DocumentWriter,
    TaskStatus,
} from '../index';

describe('CopyPasteCollectionTask', () => {
    let mockDocumentReader: jest.Mocked<DocumentReader>;
    let mockDocumentWriter: jest.Mocked<DocumentWriter>;
    let config: CopyPasteConfig;

    const sampleDocuments: DocumentDetails[] = [
        { id: '1', documentContent: { name: 'doc1', value: 10 } },
        { id: '2', documentContent: { name: 'doc2', value: 20 } },
        { id: '3', documentContent: { name: 'doc3', value: 30 } },
    ];

    beforeEach(() => {
        mockDocumentReader = {
            streamDocuments: jest.fn(),
            countDocuments: jest.fn(),
        };

        mockDocumentWriter = {
            writeDocuments: jest.fn(),
        };

        config = {
            source: {
                connectionId: 'source-conn',
                databaseName: 'sourceDb',
                collectionName: 'sourceCollection',
            },
            target: {
                connectionId: 'target-conn',
                databaseName: 'targetDb',
                collectionName: 'targetCollection',
            },
            onConflict: ConflictResolutionStrategy.Abort,
        };
    });

    describe('initialization', () => {
        it('should create task with pending status', () => {
            const task = new CopyPasteCollectionTask(config, mockDocumentReader, mockDocumentWriter);

            expect(task.status).toBe(TaskStatus.Pending);
            expect(task.progress.percentage).toBe(0);
            expect(task.error).toBeUndefined();
        });

        it('should have unique id', () => {
            const task1 = new CopyPasteCollectionTask(config, mockDocumentReader, mockDocumentWriter);
            const task2 = new CopyPasteCollectionTask(config, mockDocumentReader, mockDocumentWriter);

            expect(task1.id).toBeDefined();
            expect(task2.id).toBeDefined();
            expect(task1.id).not.toBe(task2.id);
        });
    });

    describe('configuration validation', () => {
        it('should fail with invalid source configuration', async () => {
            const invalidConfig = {
                ...config,
                source: {
                    connectionId: '',
                    databaseName: 'sourceDb',
                    collectionName: 'sourceCollection',
                },
            };

            const task = new CopyPasteCollectionTask(invalidConfig, mockDocumentReader, mockDocumentWriter);
            await task.execute();

            expect(task.status).toBe(TaskStatus.Failed);
            expect(task.error?.message).toContain('Invalid source configuration');
        });

        it('should fail with invalid target configuration', async () => {
            const invalidConfig = {
                ...config,
                target: {
                    connectionId: 'target-conn',
                    databaseName: '',
                    collectionName: 'targetCollection',
                },
            };

            const task = new CopyPasteCollectionTask(invalidConfig, mockDocumentReader, mockDocumentWriter);
            await task.execute();

            expect(task.status).toBe(TaskStatus.Failed);
            expect(task.error?.message).toContain('Invalid target configuration');
        });
    });

    describe('execution', () => {
        it('should successfully copy documents', async () => {
            // Setup mocks
            mockDocumentReader.countDocuments.mockResolvedValue(sampleDocuments.length);
            mockDocumentReader.streamDocuments.mockImplementation(async function* () {
                for (const doc of sampleDocuments) {
                    yield doc;
                }
            });

            const bulkWriteResult: BulkWriteResult = {
                insertedCount: sampleDocuments.length,
                errors: [],
            };
            mockDocumentWriter.writeDocuments.mockResolvedValue(bulkWriteResult);

            const task = new CopyPasteCollectionTask(config, mockDocumentReader, mockDocumentWriter);
            await task.execute();

            expect(task.status).toBe(TaskStatus.Completed);
            expect(task.progress.processedCount).toBe(sampleDocuments.length);
            expect(task.progress.percentage).toBe(100);
            // eslint-disable-next-line @typescript-eslint/unbound-method
            expect(mockDocumentReader.countDocuments).toHaveBeenCalledWith(
                config.source.connectionId,
                config.source.databaseName,
                config.source.collectionName,
            );
            // eslint-disable-next-line @typescript-eslint/unbound-method
            expect(mockDocumentWriter.writeDocuments).toHaveBeenCalledTimes(1);
        });

        it('should handle read errors', async () => {
            mockDocumentReader.countDocuments.mockRejectedValue(new Error('Connection failed'));

            const task = new CopyPasteCollectionTask(config, mockDocumentReader, mockDocumentWriter);
            await task.execute();

            expect(task.status).toBe(TaskStatus.Failed);
            expect(task.error?.message).toContain('Failed to count source documents');
        });

        it('should handle write errors with abort strategy', async () => {
            // Setup mocks
            mockDocumentReader.countDocuments.mockResolvedValue(sampleDocuments.length);
            mockDocumentReader.streamDocuments.mockImplementation(async function* () {
                for (const doc of sampleDocuments) {
                    yield doc;
                }
            });

            const bulkWriteResult: BulkWriteResult = {
                insertedCount: 0,
                errors: [{ documentId: '1', error: new Error('Write failed') }],
            };
            mockDocumentWriter.writeDocuments.mockResolvedValue(bulkWriteResult);

            const task = new CopyPasteCollectionTask(config, mockDocumentReader, mockDocumentWriter);
            await task.execute();

            expect(task.status).toBe(TaskStatus.Failed);
            expect(task.error?.message).toContain('Bulk write errors');
        });
    });

    describe('cancellation', () => {
        it('should cancel task', () => {
            const task = new CopyPasteCollectionTask(config, mockDocumentReader, mockDocumentWriter);
            task.cancel();

            expect(task.status).toBe(TaskStatus.Failed);
            expect(task.error?.message).toBe('Task was cancelled');
        });
    });

    describe('progress tracking', () => {
        it('should report progress updates', async () => {
            const progressUpdates: Array<{ percentage: number; message?: string }> = [];
            
            mockDocumentReader.countDocuments.mockResolvedValue(sampleDocuments.length);
            mockDocumentReader.streamDocuments.mockImplementation(async function* () {
                for (const doc of sampleDocuments) {
                    yield doc;
                }
            });

            const bulkWriteResult: BulkWriteResult = {
                insertedCount: sampleDocuments.length,
                errors: [],
            };
            mockDocumentWriter.writeDocuments.mockResolvedValue(bulkWriteResult);

            const task = new CopyPasteCollectionTask(config, mockDocumentReader, mockDocumentWriter);
            
            task.onProgress((progress) => {
                progressUpdates.push({ percentage: progress.percentage, message: progress.message });
            });

            await task.execute();

            expect(progressUpdates.length).toBeGreaterThan(0);
            expect(progressUpdates[0].percentage).toBe(0);
            expect(progressUpdates[progressUpdates.length - 1].percentage).toBe(100);
        });
    });
});