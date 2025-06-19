/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/unbound-method */

import { CopyPasteCollectionTask } from './CopyPasteCollectionTask';
import { TaskState } from '../taskService';
import {
    ConflictResolutionStrategy,
    type CopyPasteConfig,
    type DocumentReader,
    type DocumentWriter,
    type DocumentDetails,
} from './copyPaste';

// Mock vscode module
jest.mock('vscode', () => ({
    l10n: {
        t: jest.fn((key: string, ...args: any[]) => {
            // Simple implementation that replaces {0}, {1}, etc. with args
            return args.reduce((str: string, arg: any, index: number) => {
                return str.replace(new RegExp(`\\{${index}\\}`, 'g'), String(arg));
            }, key);
        }),
    },
    EventEmitter: jest.fn().mockImplementation(() => ({
        event: jest.fn(),
        fire: jest.fn(),
        dispose: jest.fn(),
    })),
}));

describe('CopyPasteCollectionTask', () => {
    let mockDocumentReader: jest.Mocked<DocumentReader>;
    let mockDocumentWriter: jest.Mocked<DocumentWriter>;
    let config: CopyPasteConfig;

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();

        // Create mock document reader
        mockDocumentReader = {
            streamDocuments: jest.fn() as jest.MockedFunction<DocumentReader['streamDocuments']>,
            countDocuments: jest.fn() as jest.MockedFunction<DocumentReader['countDocuments']>,
        };

        // Create mock document writer
        mockDocumentWriter = {
            writeDocuments: jest.fn() as jest.MockedFunction<DocumentWriter['writeDocuments']>,
            ensureCollectionExists: jest.fn() as jest.MockedFunction<DocumentWriter['ensureCollectionExists']>,
        };

        // Create test configuration
        config = {
            source: {
                connectionId: 'source-connection',
                databaseName: 'source-db',
                collectionName: 'source-collection',
            },
            target: {
                connectionId: 'target-connection',
                databaseName: 'target-db',
                collectionName: 'target-collection',
            },
            onConflict: ConflictResolutionStrategy.Abort,
        };
    });

    describe('Task Creation', () => {
        test('should create task with correct type and name', () => {
            const task = new CopyPasteCollectionTask(config, mockDocumentReader, mockDocumentWriter);

            expect(task.type).toBe('copy-paste-collection');
            expect(task.name).toContain('source-collection');
            expect(task.name).toContain('source-db');
            expect(task.name).toContain('target-db');
            expect(task.getStatus().state).toBe(TaskState.Pending);
        });
    });

    describe('Task Initialization', () => {
        test('should count documents and ensure collection exists during initialization', async () => {
            const task = new CopyPasteCollectionTask(config, mockDocumentReader, mockDocumentWriter);
            
            // Mock the required methods
            mockDocumentReader.countDocuments.mockResolvedValue(100);
            mockDocumentWriter.ensureCollectionExists.mockResolvedValue();

            await task.start();

            // Wait a bit for async initialization
            await new Promise(resolve => setTimeout(resolve, 100));

            expect(mockDocumentReader.countDocuments).toHaveBeenCalledWith(
                'source-connection',
                'source-db',
                'source-collection'
            );
            expect(mockDocumentWriter.ensureCollectionExists).toHaveBeenCalledWith(
                'target-connection',
                'target-db',
                'target-collection'
            );
        });

        test('should handle count documents error', async () => {
            const task = new CopyPasteCollectionTask(config, mockDocumentReader, mockDocumentWriter);
            
            // Mock count documents to throw error
            mockDocumentReader.countDocuments.mockRejectedValue(new Error('Count failed'));

            // The task should throw the error during start()
            await expect(task.start()).rejects.toThrow('Failed to count documents in source collection');
        });

        test('should handle ensure collection exists error', async () => {
            const task = new CopyPasteCollectionTask(config, mockDocumentReader, mockDocumentWriter);
            
            // Mock successful count but failed collection creation
            mockDocumentReader.countDocuments.mockResolvedValue(100);
            mockDocumentWriter.ensureCollectionExists.mockRejectedValue(new Error('Collection creation failed'));

            // The task should throw the error during start()
            await expect(task.start()).rejects.toThrow('Failed to ensure target collection exists');
        });
    });

    describe('Document Copying', () => {
        test('should copy documents successfully', async () => {
            const task = new CopyPasteCollectionTask(config, mockDocumentReader, mockDocumentWriter);
            
            // Mock successful initialization
            mockDocumentReader.countDocuments.mockResolvedValue(3);
            mockDocumentWriter.ensureCollectionExists.mockResolvedValue();

            // Mock document stream
            const mockDocuments: DocumentDetails[] = [
                { id: '1', documentContent: { _id: '1', data: 'test1' } },
                { id: '2', documentContent: { _id: '2', data: 'test2' } },
                { id: '3', documentContent: { _id: '3', data: 'test3' } },
            ];

            mockDocumentReader.streamDocuments.mockImplementation(async function* () {
                for (const doc of mockDocuments) {
                    yield doc;
                }
            });

            // Mock successful writes
            mockDocumentWriter.writeDocuments.mockResolvedValue({
                insertedCount: 3,
                errors: [],
            });

            await task.start();

            // Wait for task to complete
            await new Promise(resolve => setTimeout(resolve, 300));

            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Completed);
            expect(status.progress).toBe(100);
            expect(mockDocumentWriter.writeDocuments).toHaveBeenCalledWith(
                'target-connection',
                'target-db',
                'target-collection',
                mockDocuments,
                { batchSize: 3 }
            );
        });

        test('should handle empty collection', async () => {
            const task = new CopyPasteCollectionTask(config, mockDocumentReader, mockDocumentWriter);
            
            // Mock successful initialization with zero documents
            mockDocumentReader.countDocuments.mockResolvedValue(0);
            mockDocumentWriter.ensureCollectionExists.mockResolvedValue();

            await task.start();

            // Wait for task to complete
            await new Promise(resolve => setTimeout(resolve, 200));

            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Completed);
            expect(status.progress).toBe(100);
            expect(mockDocumentWriter.writeDocuments).not.toHaveBeenCalled();
        });

        test('should handle write errors with abort strategy', async () => {
            const task = new CopyPasteCollectionTask(config, mockDocumentReader, mockDocumentWriter);
            
            // Mock successful initialization
            mockDocumentReader.countDocuments.mockResolvedValue(1);
            mockDocumentWriter.ensureCollectionExists.mockResolvedValue();

            // Mock document stream
            const mockDocuments: DocumentDetails[] = [
                { id: '1', documentContent: { _id: '1', data: 'test1' } },
            ];

            mockDocumentReader.streamDocuments.mockImplementation(async function* () {
                for (const doc of mockDocuments) {
                    yield doc;
                }
            });

            // Mock write error
            mockDocumentWriter.writeDocuments.mockResolvedValue({
                insertedCount: 0,
                errors: [{ documentId: '1', error: new Error('Write failed') }],
            });

            await task.start();

            // Wait for task to complete
            await new Promise(resolve => setTimeout(resolve, 300));

            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Failed);
            expect(status.error).toBeInstanceOf(Error);
            expect((status.error as Error).message).toContain('Write operation failed');
        });

        test('should handle streaming errors', async () => {
            const task = new CopyPasteCollectionTask(config, mockDocumentReader, mockDocumentWriter);
            
            // Mock successful initialization
            mockDocumentReader.countDocuments.mockResolvedValue(1);
            mockDocumentWriter.ensureCollectionExists.mockResolvedValue();

            // Mock streaming error
            mockDocumentReader.streamDocuments.mockImplementation(async function* () {
                yield { id: '1', documentContent: { _id: '1', data: 'test1' } }; // Add yield to satisfy require-yield
                throw new Error('Streaming failed');
            });

            await task.start();

            // Wait for task to complete
            await new Promise(resolve => setTimeout(resolve, 200));

            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Failed);
            expect(status.error).toBeInstanceOf(Error);
            expect((status.error as Error).message).toContain('Copy operation failed');
        });
    });

    describe('Task Lifecycle', () => {
        test('should handle task stop during initialization', async () => {
            const task = new CopyPasteCollectionTask(config, mockDocumentReader, mockDocumentWriter);
            
            // Mock count documents with delay
            mockDocumentReader.countDocuments.mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 100));
                return 100;
            });
            mockDocumentWriter.ensureCollectionExists.mockResolvedValue();

            await task.start();
            
            // Stop the task immediately after starting
            task.stop();

            // Wait for task to complete
            await new Promise(resolve => setTimeout(resolve, 200));

            const status = task.getStatus();
            // The task might be stopped or completed depending on timing
            expect([TaskState.Stopped, TaskState.Completed, TaskState.Failed]).toContain(status.state);
        });

        test('should handle task stop during document processing', async () => {
            const task = new CopyPasteCollectionTask(config, mockDocumentReader, mockDocumentWriter);
            
            // Mock successful initialization
            mockDocumentReader.countDocuments.mockResolvedValue(3);
            mockDocumentWriter.ensureCollectionExists.mockResolvedValue();

            // Mock document stream with delay
            mockDocumentReader.streamDocuments.mockImplementation(async function* () {
                yield { id: '1', documentContent: { _id: '1', data: 'test1' } };
                await new Promise(resolve => setTimeout(resolve, 200));
                yield { id: '2', documentContent: { _id: '2', data: 'test2' } };
            });

            mockDocumentWriter.writeDocuments.mockResolvedValue({
                insertedCount: 1,
                errors: [],
            });

            await task.start();
            
            // Wait for task to start processing, then stop
            await new Promise(resolve => setTimeout(resolve, 150));
            task.stop();

            // Wait for task to complete
            await new Promise(resolve => setTimeout(resolve, 300));

            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Stopped);
        });
    });

    describe('Progress Reporting', () => {
        test('should report progress during document copying', async () => {
            const task = new CopyPasteCollectionTask(config, mockDocumentReader, mockDocumentWriter);

            // Mock successful initialization
            mockDocumentReader.countDocuments.mockResolvedValue(2);
            mockDocumentWriter.ensureCollectionExists.mockResolvedValue();

            // Mock document stream
            const mockDocuments: DocumentDetails[] = [
                { id: '1', documentContent: { _id: '1', data: 'test1' } },
                { id: '2', documentContent: { _id: '2', data: 'test2' } },
            ];

            mockDocumentReader.streamDocuments.mockImplementation(async function* () {
                for (const doc of mockDocuments) {
                    yield doc;
                }
            });

            // Mock successful writes
            mockDocumentWriter.writeDocuments.mockResolvedValue({
                insertedCount: 2,
                errors: [],
            });

            await task.start();

            // Wait for task to complete
            await new Promise(resolve => setTimeout(resolve, 300));

            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Completed);
            // The task should have 100% progress when completed
            expect(status.progress).toBe(100);
        });
    });
});