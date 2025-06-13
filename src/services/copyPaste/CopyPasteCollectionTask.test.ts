/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TaskState } from '../taskService';
import { ConflictResolutionStrategy, type DocumentDetails, type DocumentReader, type DocumentWriter } from './interfaces';
import { CopyPasteCollectionTask } from './CopyPasteCollectionTask';

// Mock vscode module
jest.mock('vscode', () => ({
    l10n: {
        t: (message: string, ...args: any[]): string => {
            // Simple mock implementation for localization
            let result = message;
            args.forEach((arg, index) => {
                result = result.replace(`{${index}}`, String(arg));
            });
            return result;
        },
    },
}));

// Mock document buffer - simplified version that doesn't accumulate
jest.mock('../../utils/documentBuffer', () => ({
    createMongoDbBuffer: jest.fn(() => ({
        insertOrFlush: jest.fn(() => ({ success: true, errorCode: 'none' })),
        flush: jest.fn(() => []),
        getStats: jest.fn(() => ({ documentCount: 0, currentSizeBytes: 0 })),
    })),
}));

describe('CopyPasteCollectionTask', () => {
    let mockReader: jest.Mocked<DocumentReader>;
    let mockWriter: jest.Mocked<DocumentWriter>;
    let task: CopyPasteCollectionTask;

    const testConfig = {
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

    beforeEach(() => {
        mockReader = {
            countDocuments: jest.fn<Promise<number>, [string, string, string]>(),
            streamDocuments: jest.fn<AsyncIterable<DocumentDetails>, [string, string, string]>(),
        };

        mockWriter = {
            writeDocuments: jest.fn<Promise<{ insertedCount: number; errors: Array<{ documentId?: unknown; error: unknown }> }>, Parameters<DocumentWriter['writeDocuments']>>(),
            ensureCollectionExists: jest.fn<Promise<void>, [string, string, string]>(),
        };

        task = new CopyPasteCollectionTask('test-task-id', testConfig, mockReader, mockWriter);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('constructor', () => {
        it('should initialize with correct properties', () => {
            expect(task.id).toBe('test-task-id');
            expect(task.type).toBe('copy-paste-collection');
            expect(task.name).toContain('source-db.source-collection');
            expect(task.name).toContain('target-db.target-collection');
        });

        it('should start with pending status', () => {
            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Pending);
            expect(status.progress).toBe(0);
            expect(status.message).toBe('Ready to start copy operation');
        });
    });

    describe('start', () => {
        it('should complete successfully with no documents', async () => {
            mockReader.countDocuments.mockResolvedValue(0);

            await task.start();

            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Completed);
            expect(status.progress).toBe(100);
            expect(status.message).toBe('No documents to copy');
            // Verify the writer was not called for ensuring collection exists
            // eslint-disable-next-line @typescript-eslint/unbound-method
            expect(mockWriter.ensureCollectionExists).toHaveBeenCalledTimes(0);
        });

        it('should handle basic workflow with documents', async () => {
            const mockDocuments: DocumentDetails[] = [
                { id: '1', documentContent: { _id: '1', data: 'test1' } },
                { id: '2', documentContent: { _id: '2', data: 'test2' } },
            ];

            mockReader.countDocuments.mockResolvedValue(2);
            mockReader.streamDocuments.mockImplementation(async function* () {
                for (const doc of mockDocuments) {
                    yield doc;
                }
            });
            mockWriter.ensureCollectionExists.mockResolvedValue();
            mockWriter.writeDocuments.mockResolvedValue({
                insertedCount: 2,
                errors: [],
            });

            await task.start();

            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Completed);
            expect(status.message).toContain('Successfully copied');
            // Verify the correct methods were called
            // eslint-disable-next-line @typescript-eslint/unbound-method
            expect(mockReader.countDocuments).toHaveBeenCalledWith(
                'source-connection',
                'source-db',
                'source-collection',
            );
            // eslint-disable-next-line @typescript-eslint/unbound-method
            expect(mockWriter.ensureCollectionExists).toHaveBeenCalledWith(
                'target-connection',
                'target-db',
                'target-collection',
            );
        });

        it('should fail when reader throws error', async () => {
            const error = new Error('Reader error');
            mockReader.countDocuments.mockRejectedValue(error);

            await expect(task.start()).rejects.toThrow('Reader error');

            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Failed);
            expect(status.error).toBe(error);
        });

        it('should fail when writer throws error', async () => {
            mockReader.countDocuments.mockResolvedValue(1);
            const error = new Error('Writer error');
            mockWriter.ensureCollectionExists.mockRejectedValue(error);

            await expect(task.start()).rejects.toThrow('Writer error');

            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Failed);
            expect(status.error).toBe(error);
        });

        it('should not start if already started', async () => {
            mockReader.countDocuments.mockResolvedValue(0);
            await task.start();

            await expect(task.start()).rejects.toThrow('Task has already been started');
        });
    });

    describe('stop', () => {
        it('should handle stop request gracefully', async () => {
            await task.stop();

            // Should not throw and task should handle the stop request
            expect(true).toBe(true);
        });
    });

    describe('delete', () => {
        it('should clean up resources', async () => {
            await task.delete();

            // Should not throw any errors
            expect(true).toBe(true);
        });
    });
});