/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ConflictResolutionStrategy, type DocumentDetails } from '../types';
import { MockDocumentWriter } from './BaseDocumentWriter.test';
import { StreamDocumentWriter, StreamWriterError } from './StreamDocumentWriter';

// Mock extensionVariables (ext) module
jest.mock('../../../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            appendLine: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
            trace: jest.fn(),
            appendLog: jest.fn(),
            show: jest.fn(),
            info: jest.fn(),
        },
    },
}));

// Mock vscode module
jest.mock('vscode', () => ({
    l10n: {
        t: (key: string, ...args: string[]): string => {
            return args.length > 0 ? `${key} ${args.join(' ')}` : key;
        },
    },
}));

// Helper function to create test documents
function createDocuments(count: number, startId: number = 1): DocumentDetails[] {
    return Array.from({ length: count }, (_, i) => ({
        id: `doc${startId + i}`,
        documentContent: { name: `Document ${startId + i}`, value: Math.random() },
    }));
}

// Helper to create async iterable from array
async function* createDocumentStream(documents: DocumentDetails[]): AsyncIterable<DocumentDetails> {
    for (const doc of documents) {
        yield doc;
    }
}

describe('StreamDocumentWriter', () => {
    let writer: MockDocumentWriter;
    let streamer: StreamDocumentWriter;

    beforeEach(() => {
        writer = new MockDocumentWriter('testdb', 'testcollection', ConflictResolutionStrategy.Abort);
        streamer = new StreamDocumentWriter(writer);
        writer.clearStorage();
        writer.clearErrorConfig();
        jest.clearAllMocks();
    });

    // ==================== 6. Core Streaming ====================

    describe('streamDocuments - Core Streaming', () => {
        it('should handle empty stream', async () => {
            const stream = createDocumentStream([]);

            const result = await streamer.streamDocuments(
                { conflictResolutionStrategy: ConflictResolutionStrategy.Abort },
                stream,
            );

            expect(result.totalProcessed).toBe(0);
            expect(result.insertedCount).toBe(0);
            expect(result.flushCount).toBe(0);
        });

        it('should process small stream without flush', async () => {
            const documents = createDocuments(10); // Less than buffer limit
            const stream = createDocumentStream(documents);

            const result = await streamer.streamDocuments(
                { conflictResolutionStrategy: ConflictResolutionStrategy.Abort },
                stream,
            );

            expect(result.totalProcessed).toBe(10);
            expect(result.insertedCount).toBe(10);
            expect(result.flushCount).toBe(1); // Final flush at end
            expect(writer.getStorage().size).toBe(10);
        });

        it('should process large stream with multiple flushes', async () => {
            const documents = createDocuments(1500); // Exceeds default batch size (500)
            const stream = createDocumentStream(documents);

            const result = await streamer.streamDocuments(
                { conflictResolutionStrategy: ConflictResolutionStrategy.Abort },
                stream,
            );

            expect(result.totalProcessed).toBe(1500);
            expect(result.insertedCount).toBe(1500);
            expect(result.flushCount).toBeGreaterThan(1);
            expect(writer.getStorage().size).toBe(1500);
        });

        it('should invoke progress callback after each flush with details', async () => {
            const documents = createDocuments(1500);
            const stream = createDocumentStream(documents);
            const progressUpdates: Array<{ count: number; details?: string }> = [];

            await streamer.streamDocuments({ conflictResolutionStrategy: ConflictResolutionStrategy.Abort }, stream, {
                onProgress: (count, details) => {
                    progressUpdates.push({ count, details });
                },
            });

            // Should have multiple progress updates
            expect(progressUpdates.length).toBeGreaterThan(1);

            // Each update should have a count
            for (const update of progressUpdates) {
                expect(update.count).toBeGreaterThan(0);
            }

            // Sum of counts should equal total processed
            const totalReported = progressUpdates.reduce((sum, update) => sum + update.count, 0);
            expect(totalReported).toBeGreaterThanOrEqual(1500);
        });

        it('should report correct progress details for Skip strategy', async () => {
            writer = new MockDocumentWriter('testdb', 'testcollection', ConflictResolutionStrategy.Skip);
            streamer = new StreamDocumentWriter(writer);

            // Seed storage with some existing documents (doc1-doc50)
            const existingDocs = createDocuments(50, 1);
            writer.seedStorage(existingDocs);

            // Stream 150 documents (doc1-doc150), where first 50 exist
            const documents = createDocuments(150);
            const stream = createDocumentStream(documents);
            const progressUpdates: Array<{ count: number; details?: string }> = [];

            await streamer.streamDocuments({ conflictResolutionStrategy: ConflictResolutionStrategy.Skip }, stream, {
                onProgress: (count, details) => {
                    progressUpdates.push({ count, details });
                },
            });

            // Should have progress updates
            expect(progressUpdates.length).toBeGreaterThan(0);

            // Last progress update should show both inserted and skipped
            const lastUpdate = progressUpdates[progressUpdates.length - 1];
            expect(lastUpdate.details).toBeDefined();
            expect(lastUpdate.details).toContain('inserted');
            expect(lastUpdate.details).toContain('skipped');
            expect(lastUpdate.details).toContain('100'); // 100 inserted
            expect(lastUpdate.details).toContain('50'); // 50 skipped
        });

        it('should report correct progress details for Overwrite strategy', async () => {
            writer = new MockDocumentWriter('testdb', 'testcollection', ConflictResolutionStrategy.Overwrite);
            streamer = new StreamDocumentWriter(writer);

            // Seed storage with some existing documents (doc1-doc75)
            const existingDocs = createDocuments(75, 1);
            writer.seedStorage(existingDocs);

            // Stream 150 documents (doc1-doc150), where first 75 exist (will be matched/replaced)
            const documents = createDocuments(150);
            const stream = createDocumentStream(documents);
            const progressUpdates: Array<{ count: number; details?: string }> = [];

            await streamer.streamDocuments(
                { conflictResolutionStrategy: ConflictResolutionStrategy.Overwrite },
                stream,
                {
                    onProgress: (count, details) => {
                        progressUpdates.push({ count, details });
                    },
                },
            );

            // Should have progress updates
            expect(progressUpdates.length).toBeGreaterThan(0);

            // Last progress update should show matched and upserted
            const lastUpdate = progressUpdates[progressUpdates.length - 1];
            expect(lastUpdate.details).toBeDefined();
            expect(lastUpdate.details).toContain('matched');
            expect(lastUpdate.details).toContain('upserted');
            expect(lastUpdate.details).toContain('75'); // 75 matched (existing docs)
            expect(lastUpdate.details).toContain('75'); // 75 upserted (new docs)
        });

        it('should report correct progress details for GenerateNewIds strategy', async () => {
            writer = new MockDocumentWriter('testdb', 'testcollection', ConflictResolutionStrategy.GenerateNewIds);
            streamer = new StreamDocumentWriter(writer);

            // Stream 120 documents - all should be inserted with new IDs
            const documents = createDocuments(120);
            const stream = createDocumentStream(documents);
            const progressUpdates: Array<{ count: number; details?: string }> = [];

            await streamer.streamDocuments(
                { conflictResolutionStrategy: ConflictResolutionStrategy.GenerateNewIds },
                stream,
                {
                    onProgress: (count, details) => {
                        progressUpdates.push({ count, details });
                    },
                },
            );

            // Should have progress updates
            expect(progressUpdates.length).toBeGreaterThan(0);

            // Last progress update should show only inserted (no skipped/matched/upserted)
            const lastUpdate = progressUpdates[progressUpdates.length - 1];
            expect(lastUpdate.details).toBeDefined();
            expect(lastUpdate.details).toContain('inserted');
            expect(lastUpdate.details).toContain('120');
            expect(lastUpdate.details).not.toContain('skipped');
            expect(lastUpdate.details).not.toContain('matched');
            expect(lastUpdate.details).not.toContain('upserted');
        });

        it('should report correct progress details for Abort strategy', async () => {
            writer = new MockDocumentWriter('testdb', 'testcollection', ConflictResolutionStrategy.Abort);
            streamer = new StreamDocumentWriter(writer);

            // Stream 100 documents - all should be inserted (no conflicts in Abort strategy for this test)
            const documents = createDocuments(100);
            const stream = createDocumentStream(documents);
            const progressUpdates: Array<{ count: number; details?: string }> = [];

            await streamer.streamDocuments({ conflictResolutionStrategy: ConflictResolutionStrategy.Abort }, stream, {
                onProgress: (count, details) => {
                    progressUpdates.push({ count, details });
                },
            });

            // Should have progress updates
            expect(progressUpdates.length).toBeGreaterThan(0);

            // Last progress update should show only inserted (no skipped/matched/upserted)
            const lastUpdate = progressUpdates[progressUpdates.length - 1];
            expect(lastUpdate.details).toBeDefined();
            expect(lastUpdate.details).toContain('inserted');
            expect(lastUpdate.details).toContain('100');
            expect(lastUpdate.details).not.toContain('skipped');
            expect(lastUpdate.details).not.toContain('matched');
            expect(lastUpdate.details).not.toContain('upserted');
        });

        it('should aggregate statistics correctly across flushes', async () => {
            writer = new MockDocumentWriter('testdb', 'testcollection', ConflictResolutionStrategy.Skip);
            streamer = new StreamDocumentWriter(writer);

            // Seed storage with some existing documents
            const existingDocs = createDocuments(100, 1); // doc1-doc100
            writer.seedStorage(existingDocs);

            // Stream 300 documents (doc1-doc300), where first 100 exist
            const documents = createDocuments(300);
            const stream = createDocumentStream(documents);

            const result = await streamer.streamDocuments(
                { conflictResolutionStrategy: ConflictResolutionStrategy.Skip },
                stream,
            );

            expect(result.totalProcessed).toBe(300);
            expect(result.insertedCount).toBe(200); // 300 - 100 existing
            expect(result.collidedCount).toBe(100); // 100 collided with existing documents
        });

        it('should record telemetry when actionContext provided', async () => {
            const documents = createDocuments(100);
            const stream = createDocumentStream(documents);
            const mockContext: IActionContext = {
                telemetry: {
                    properties: {},
                    measurements: {},
                },
            } as IActionContext;

            await streamer.streamDocuments({ conflictResolutionStrategy: ConflictResolutionStrategy.Abort }, stream, {
                actionContext: mockContext,
            });

            expect(mockContext.telemetry.measurements.streamTotalProcessed).toBe(100);
            expect(mockContext.telemetry.measurements.streamTotalInserted).toBe(100);
            expect(mockContext.telemetry.measurements.streamFlushCount).toBeGreaterThan(0);
        });

        it('should respect abort signal', async () => {
            const documents = createDocuments(2000);
            const stream = createDocumentStream(documents);
            const abortController = new AbortController();

            // Abort after first progress update
            let progressCount = 0;
            const onProgress = (): void => {
                progressCount++;
                if (progressCount === 1) {
                    abortController.abort();
                }
            };

            const result = await streamer.streamDocuments(
                { conflictResolutionStrategy: ConflictResolutionStrategy.Abort },
                stream,
                {
                    onProgress,
                    abortSignal: abortController.signal,
                },
            );

            // Should have processed less than total
            expect(result.totalProcessed).toBeLessThan(2000);
            expect(result.totalProcessed).toBeGreaterThan(0);
        });
    });

    // ==================== 7. Buffer Management ====================

    describe('Buffer Management', () => {
        it('should flush buffer when document count limit reached', async () => {
            const bufferLimit = writer.getBufferConstraints().optimalDocumentCount;
            const documents = createDocuments(bufferLimit + 10);
            const stream = createDocumentStream(documents);

            let flushCount = 0;
            await streamer.streamDocuments({ conflictResolutionStrategy: ConflictResolutionStrategy.Abort }, stream, {
                onProgress: () => {
                    flushCount++;
                },
            });

            // Should have at least 2 flushes (one when limit hit, one at end)
            expect(flushCount).toBeGreaterThanOrEqual(2);
        });

        it('should flush buffer when memory limit reached', async () => {
            // Create large documents to exceed memory limit
            const largeDocuments = Array.from({ length: 100 }, (_, i) => ({
                id: `doc${i + 1}`,
                documentContent: {
                    name: `Document ${i + 1}`,
                    largeData: 'x'.repeat(1024 * 1024), // 1MB per document
                },
            }));

            const stream = createDocumentStream(largeDocuments);
            let flushCount = 0;

            await streamer.streamDocuments({ conflictResolutionStrategy: ConflictResolutionStrategy.Abort }, stream, {
                onProgress: () => {
                    flushCount++;
                },
            });

            // Should have multiple flushes due to memory limit
            expect(flushCount).toBeGreaterThan(1);
        });

        it('should flush remaining documents at end of stream', async () => {
            const documents = createDocuments(50); // Less than buffer limit
            const stream = createDocumentStream(documents);

            const result = await streamer.streamDocuments(
                { conflictResolutionStrategy: ConflictResolutionStrategy.Abort },
                stream,
            );

            expect(result.totalProcessed).toBe(50);
            expect(result.flushCount).toBe(1); // Final flush
            expect(writer.getStorage().size).toBe(50);
        });

        it('should estimate document memory with reasonable values', async () => {
            const documents = [
                { id: 'small', documentContent: { value: 1 } },
                { id: 'medium', documentContent: { value: 'x'.repeat(1000) } },
                { id: 'large', documentContent: { value: 'x'.repeat(100000) } },
            ];

            const stream = createDocumentStream(documents);

            const result = await streamer.streamDocuments(
                { conflictResolutionStrategy: ConflictResolutionStrategy.Abort },
                stream,
            );

            // Should successfully process all documents
            expect(result.totalProcessed).toBe(3);
        });
    });

    // ==================== 8. Abort Strategy ====================

    describe('Abort Strategy', () => {
        it('should succeed with empty target collection', async () => {
            const documents = createDocuments(100);
            const stream = createDocumentStream(documents);

            const result = await streamer.streamDocuments(
                { conflictResolutionStrategy: ConflictResolutionStrategy.Abort },
                stream,
            );

            expect(result.totalProcessed).toBe(100);
            expect(result.insertedCount).toBe(100);
            expect(writer.getStorage().size).toBe(100);
        });

        it('should throw StreamWriterError with partial stats on _id collision after N documents', async () => {
            // Seed storage with doc50
            writer.seedStorage([createDocuments(1, 50)[0]]);

            const documents = createDocuments(100); // doc1-doc100
            const stream = createDocumentStream(documents);

            await expect(
                streamer.streamDocuments({ conflictResolutionStrategy: ConflictResolutionStrategy.Abort }, stream),
            ).rejects.toThrow(StreamWriterError);

            // Test with a new stream to verify partial stats
            const newStream = createDocumentStream(createDocuments(100));
            let caughtError: StreamWriterError | undefined;

            try {
                await streamer.streamDocuments(
                    { conflictResolutionStrategy: ConflictResolutionStrategy.Abort },
                    newStream,
                );
            } catch (error) {
                caughtError = error as StreamWriterError;
            }

            expect(caughtError).toBeInstanceOf(StreamWriterError);
            expect(caughtError?.partialStats.totalProcessed).toBeGreaterThan(0);
            expect(caughtError?.partialStats.totalProcessed).toBeLessThan(100);

            // Verify getStatsString works
            const statsString = caughtError?.getStatsString();
            expect(statsString).toContain('total');
        });
    });

    // ==================== 9. Skip Strategy ====================

    describe('Skip Strategy', () => {
        beforeEach(() => {
            writer = new MockDocumentWriter('testdb', 'testcollection', ConflictResolutionStrategy.Skip);
            streamer = new StreamDocumentWriter(writer);
        });

        it('should insert all documents into empty collection', async () => {
            const documents = createDocuments(100);
            const stream = createDocumentStream(documents);

            const result = await streamer.streamDocuments(
                { conflictResolutionStrategy: ConflictResolutionStrategy.Skip },
                stream,
            );

            expect(result.totalProcessed).toBe(100);
            expect(result.insertedCount).toBe(100);
            expect(result.collidedCount).toBe(0);
            expect(writer.getStorage().size).toBe(100);
        });

        it('should insert new documents and skip colliding ones', async () => {
            // Seed with doc10, doc20, doc30
            writer.seedStorage([createDocuments(1, 10)[0], createDocuments(1, 20)[0], createDocuments(1, 30)[0]]);

            const documents = createDocuments(50); // doc1-doc50
            const stream = createDocumentStream(documents);

            const result = await streamer.streamDocuments(
                { conflictResolutionStrategy: ConflictResolutionStrategy.Skip },
                stream,
            );

            expect(result.totalProcessed).toBe(50);
            expect(result.insertedCount).toBe(47); // 50 - 3 conflicts
            expect(result.collidedCount).toBe(3); // 3 collided with existing documents
            expect(writer.getStorage().size).toBe(50); // 47 new + 3 existing
        });
    });

    // ==================== 10. Overwrite Strategy ====================

    describe('Overwrite Strategy', () => {
        beforeEach(() => {
            writer = new MockDocumentWriter('testdb', 'testcollection', ConflictResolutionStrategy.Overwrite);
            streamer = new StreamDocumentWriter(writer);
        });

        it('should upsert all documents into empty collection', async () => {
            const documents = createDocuments(100);
            const stream = createDocumentStream(documents);

            const result = await streamer.streamDocuments(
                { conflictResolutionStrategy: ConflictResolutionStrategy.Overwrite },
                stream,
            );

            expect(result.totalProcessed).toBe(100);
            expect(result.upsertedCount).toBe(100);
            expect(result.matchedCount).toBe(0);
            expect(writer.getStorage().size).toBe(100);
        });

        it('should replace existing and upsert new documents', async () => {
            // Seed with doc10, doc20, doc30
            writer.seedStorage([createDocuments(1, 10)[0], createDocuments(1, 20)[0], createDocuments(1, 30)[0]]);

            const documents = createDocuments(50); // doc1-doc50
            const stream = createDocumentStream(documents);

            const result = await streamer.streamDocuments(
                { conflictResolutionStrategy: ConflictResolutionStrategy.Overwrite },
                stream,
            );

            expect(result.totalProcessed).toBe(50);
            expect(result.matchedCount).toBe(3); // doc10, doc20, doc30
            expect(result.upsertedCount).toBe(47); // 50 - 3 matched
            expect(writer.getStorage().size).toBe(50);
        });
    });

    // ==================== 11. GenerateNewIds Strategy ====================

    describe('GenerateNewIds Strategy', () => {
        beforeEach(() => {
            writer = new MockDocumentWriter('testdb', 'testcollection', ConflictResolutionStrategy.GenerateNewIds);
            streamer = new StreamDocumentWriter(writer);
        });

        it('should insert documents with new IDs successfully', async () => {
            const documents = createDocuments(100);
            const stream = createDocumentStream(documents);

            const result = await streamer.streamDocuments(
                { conflictResolutionStrategy: ConflictResolutionStrategy.GenerateNewIds },
                stream,
            );

            expect(result.totalProcessed).toBe(100);
            expect(result.insertedCount).toBe(100);
            expect(writer.getStorage().size).toBe(100);

            // Verify original IDs were not used
            expect(writer.getStorage().has('doc1')).toBe(false);
        });
    });

    // ==================== 12. Throttle Handling ====================

    describe('Throttle Handling', () => {
        it('should trigger mode switch to RU-limited on first throttle', async () => {
            expect(writer.getCurrentMode().mode).toBe('fast');

            // Inject throttle error after 100 documents
            writer.setErrorConfig({
                errorType: 'throttle',
                afterDocuments: 100,
                partialProgress: 100,
            });

            const documents = createDocuments(200);
            const stream = createDocumentStream(documents);

            await streamer.streamDocuments({ conflictResolutionStrategy: ConflictResolutionStrategy.Abort }, stream);

            expect(writer.getCurrentMode().mode).toBe('ru-limited');
        });

        it('should update buffer size (shrink batch) after throttle', async () => {
            const initialBatchSize = writer.getCurrentBatchSize();

            // Inject throttle error
            writer.setErrorConfig({
                errorType: 'throttle',
                afterDocuments: 100,
                partialProgress: 100,
            });

            const documents = createDocuments(200);
            const stream = createDocumentStream(documents);

            await streamer.streamDocuments({ conflictResolutionStrategy: ConflictResolutionStrategy.Abort }, stream);

            const finalBatchSize = writer.getCurrentBatchSize();
            expect(finalBatchSize).toBeLessThan(initialBatchSize);
        });

        it('should continue processing after throttle with retries', async () => {
            // Inject throttle error after 100 documents
            writer.setErrorConfig({
                errorType: 'throttle',
                afterDocuments: 100,
                partialProgress: 100,
            });

            const documents = createDocuments(200);
            const stream = createDocumentStream(documents);

            const result = await streamer.streamDocuments(
                { conflictResolutionStrategy: ConflictResolutionStrategy.Abort },
                stream,
            );

            // Should eventually process all documents
            expect(result.totalProcessed).toBe(200);
            expect(result.insertedCount).toBe(200);
        });

        it('should handle multiple throttle errors and continue to adjust batch size', async () => {
            const initialBatchSize = writer.getCurrentBatchSize();

            // First throttle
            writer.setErrorConfig({
                errorType: 'throttle',
                afterDocuments: 100,
                partialProgress: 100,
            });

            let documents = createDocuments(150);
            let stream = createDocumentStream(documents);
            await streamer.streamDocuments({ conflictResolutionStrategy: ConflictResolutionStrategy.Abort }, stream);

            const batchSizeAfterFirst = writer.getCurrentBatchSize();
            expect(batchSizeAfterFirst).toBeLessThan(initialBatchSize);

            // Second throttle
            writer.resetToFastMode(); // Reset for new stream
            writer.setErrorConfig({
                errorType: 'throttle',
                afterDocuments: 50,
                partialProgress: 50,
            });

            documents = createDocuments(100, 200);
            stream = createDocumentStream(documents);
            await streamer.streamDocuments({ conflictResolutionStrategy: ConflictResolutionStrategy.Abort }, stream);

            const batchSizeAfterSecond = writer.getCurrentBatchSize();
            expect(batchSizeAfterSecond).toBeLessThan(initialBatchSize);
        });
    });

    // ==================== 13. Network Error Handling ====================

    describe('Network Error Handling', () => {
        it('should trigger retry with exponential backoff on network error', async () => {
            // Inject network error after 50 documents
            writer.setErrorConfig({
                errorType: 'network',
                afterDocuments: 50,
                partialProgress: 0,
            });

            const documents = createDocuments(100);
            const stream = createDocumentStream(documents);

            const result = await streamer.streamDocuments(
                { conflictResolutionStrategy: ConflictResolutionStrategy.Abort },
                stream,
            );

            // Should eventually succeed after retry
            expect(result.totalProcessed).toBe(100);
            expect(result.insertedCount).toBe(100);
        });

        it('should recover from network error and continue processing', async () => {
            // Inject network error in the middle
            writer.setErrorConfig({
                errorType: 'network',
                afterDocuments: 250,
                partialProgress: 0,
            });

            const documents = createDocuments(500);
            const stream = createDocumentStream(documents);

            const result = await streamer.streamDocuments(
                { conflictResolutionStrategy: ConflictResolutionStrategy.Abort },
                stream,
            );

            // Should process all documents despite network error
            expect(result.totalProcessed).toBe(500);
            expect(result.insertedCount).toBe(500);
        });
    });

    // ==================== 14. Unexpected Error Handling ====================

    describe('Unexpected Error Handling', () => {
        it('should throw unexpected error (unknown type) immediately', async () => {
            // Inject unexpected error
            writer.setErrorConfig({
                errorType: 'unexpected',
                afterDocuments: 50,
                partialProgress: 0,
            });

            const documents = createDocuments(100);
            const stream = createDocumentStream(documents);

            await expect(
                streamer.streamDocuments({ conflictResolutionStrategy: ConflictResolutionStrategy.Abort }, stream),
            ).rejects.toThrow('MOCK_UNEXPECTED_ERROR');
        });

        it('should stop processing on unexpected error during streaming', async () => {
            // Inject unexpected error after some progress
            writer.setErrorConfig({
                errorType: 'unexpected',
                afterDocuments: 100,
                partialProgress: 0,
            });

            const documents = createDocuments(500);
            const stream = createDocumentStream(documents);

            await expect(
                streamer.streamDocuments({ conflictResolutionStrategy: ConflictResolutionStrategy.Abort }, stream),
            ).rejects.toThrow();

            // Verify not all documents were processed
            expect(writer.getStorage().size).toBeLessThan(500);
        });
    });

    // ==================== 15. StreamWriterError ====================

    describe('StreamWriterError', () => {
        it('should include partial statistics', async () => {
            writer.seedStorage([createDocuments(1, 50)[0]]);

            const documents = createDocuments(100);
            const stream = createDocumentStream(documents);

            let caughtError: StreamWriterError | undefined;

            try {
                await streamer.streamDocuments(
                    { conflictResolutionStrategy: ConflictResolutionStrategy.Abort },
                    stream,
                );
                // Should not reach here
                expect(true).toBe(false);
            } catch (error) {
                caughtError = error as StreamWriterError;
            }

            expect(caughtError).toBeInstanceOf(StreamWriterError);
            expect(caughtError?.partialStats).toBeDefined();
            expect(caughtError?.partialStats.totalProcessed).toBeGreaterThan(0);
            expect(caughtError?.partialStats.insertedCount).toBeDefined();
        });

        it('should format getStatsString for Abort strategy correctly', () => {
            const error = new StreamWriterError('Test error', {
                totalProcessed: 100,
                insertedCount: 100,
                collidedCount: 0,
                matchedCount: 0,
                upsertedCount: 0,
                flushCount: 2,
            });

            const statsString = error.getStatsString();
            expect(statsString).toContain('100 total');
            expect(statsString).toContain('100 inserted');
        });

        it('should format getStatsString for Skip strategy correctly', () => {
            const error = new StreamWriterError('Test error', {
                totalProcessed: 100,
                insertedCount: 80,
                collidedCount: 20,
                matchedCount: 0,
                upsertedCount: 0,
                flushCount: 2,
            });

            const statsString = error.getStatsString();
            expect(statsString).toContain('100 total');
            expect(statsString).toContain('80 inserted');
            expect(statsString).toContain('20 skipped');
        });

        it('should format getStatsString for Overwrite strategy correctly', () => {
            const error = new StreamWriterError('Test error', {
                totalProcessed: 100,
                insertedCount: 0,
                collidedCount: 0,
                matchedCount: 60,
                upsertedCount: 40,
                flushCount: 2,
            });

            const statsString = error.getStatsString();
            expect(statsString).toContain('100 total');
            expect(statsString).toContain('60 matched');
            expect(statsString).toContain('40 upserted');
        });
    });

    // ==================== 16. Progress Reporting Details ====================

    describe('Progress Reporting Details', () => {
        it('should report progress with count for Abort strategy', async () => {
            const documents = createDocuments(100);
            const stream = createDocumentStream(documents);
            const progressCounts: number[] = [];

            await streamer.streamDocuments({ conflictResolutionStrategy: ConflictResolutionStrategy.Abort }, stream, {
                onProgress: (count, _details) => {
                    progressCounts.push(count);
                },
            });

            // Should have received progress callbacks with counts
            expect(progressCounts.length).toBeGreaterThan(0);
            const totalReported = progressCounts.reduce((sum, count) => sum + count, 0);
            expect(totalReported).toBeGreaterThan(0);
        });

        it('should report progress with count for Skip strategy', async () => {
            writer = new MockDocumentWriter('testdb', 'testcollection', ConflictResolutionStrategy.Skip);
            streamer = new StreamDocumentWriter(writer);

            // Seed with some documents
            writer.seedStorage(createDocuments(20));

            const documents = createDocuments(100);
            const stream = createDocumentStream(documents);
            const progressCounts: number[] = [];

            await streamer.streamDocuments({ conflictResolutionStrategy: ConflictResolutionStrategy.Skip }, stream, {
                onProgress: (count, _details) => {
                    progressCounts.push(count);
                },
            });

            // Should have received progress callbacks with counts
            expect(progressCounts.length).toBeGreaterThan(0);
            const totalReported = progressCounts.reduce((sum, count) => sum + count, 0);
            expect(totalReported).toBeGreaterThan(0);
        });

        it('should report progress with count for Overwrite strategy', async () => {
            writer = new MockDocumentWriter('testdb', 'testcollection', ConflictResolutionStrategy.Overwrite);
            streamer = new StreamDocumentWriter(writer);

            // Seed with some documents
            writer.seedStorage(createDocuments(20));

            const documents = createDocuments(100);
            const stream = createDocumentStream(documents);
            const progressCounts: number[] = [];

            await streamer.streamDocuments(
                { conflictResolutionStrategy: ConflictResolutionStrategy.Overwrite },
                stream,
                {
                    onProgress: (count, _details) => {
                        progressCounts.push(count);
                    },
                },
            );

            // Should have received progress callbacks with counts
            expect(progressCounts.length).toBeGreaterThan(0);
            const totalReported = progressCounts.reduce((sum, count) => sum + count, 0);
            expect(totalReported).toBeGreaterThan(0);
        });
    });
});
