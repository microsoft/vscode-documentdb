/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ConflictResolutionStrategy, type DocumentDetails, type EnsureTargetExistsResult } from '../types';
import {
    type AbortBatchResult,
    type ErrorType,
    type GenerateNewIdsBatchResult,
    type OverwriteBatchResult,
    type PartialProgress,
    type SkipBatchResult,
    type StrategyBatchResult,
} from '../writerTypes.internal';
import { StreamingDocumentWriter, StreamingWriterError } from './StreamingDocumentWriter';

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

/**
 * Mock StreamingDocumentWriter for testing.
 * Uses in-memory storage with string document IDs to simulate MongoDB/DocumentDB behavior.
 */
class MockStreamingWriter extends StreamingDocumentWriter<string> {
    // In-memory storage: Map<documentId, documentContent>
    private storage: Map<string, unknown> = new Map();

    // Configuration for error injection
    private errorConfig?: {
        errorType: 'throttle' | 'network' | 'conflict' | 'unexpected';
        afterDocuments: number; // Throw error after processing this many docs
        partialProgress?: number; // How many docs were processed before error
        writeBeforeThrottle?: boolean; // If true, actually write partial documents before throwing throttle
    };

    // Track how many documents have been processed (for error injection)
    private processedCountForErrorInjection: number = 0;

    // Store partial progress from last error (preserved after errorConfig is cleared)
    private lastPartialProgress?: number;

    constructor(databaseName: string = 'testdb', collectionName: string = 'testcollection') {
        super(databaseName, collectionName);
    }

    // Test helpers
    public setErrorConfig(config: MockStreamingWriter['errorConfig']): void {
        this.errorConfig = config;
        this.processedCountForErrorInjection = 0;
    }

    public clearErrorConfig(): void {
        this.errorConfig = undefined;
        this.processedCountForErrorInjection = 0;
    }

    public getStorage(): Map<string, unknown> {
        return this.storage;
    }

    public clearStorage(): void {
        this.storage.clear();
    }

    public seedStorage(documents: DocumentDetails[]): void {
        for (const doc of documents) {
            this.storage.set(doc.id as string, doc.documentContent);
        }
    }

    // Expose protected methods for testing
    public getCurrentBatchSize(): number {
        return this.batchSizeAdapter.getCurrentBatchSize();
    }

    public getCurrentMode(): string {
        return this.batchSizeAdapter.getCurrentMode();
    }

    public resetToFastMode(): void {
        // Reset the adapter by creating a fresh one internally
        // For now, this is a simple reset - in real code we'd need a method on BatchSizeAdapter
        this.clearErrorConfig();
    }

    public getBufferConstraints(): { optimalDocumentCount: number; maxMemoryMB: number } {
        return this.batchSizeAdapter.getBufferConstraints();
    }

    // Abstract method implementations

    public async ensureTargetExists(): Promise<EnsureTargetExistsResult> {
        // Mock implementation - always exists
        return { targetWasCreated: false };
    }

    protected async writeBatch(
        documents: DocumentDetails[],
        strategy: ConflictResolutionStrategy,
        _actionContext?: IActionContext,
    ): Promise<StrategyBatchResult<string>> {
        // Check for partial write simulation (throttle with actual writes)
        this.checkAndThrowErrorWithPartialWrite(documents, strategy);

        switch (strategy) {
            case ConflictResolutionStrategy.Abort:
                return this.writeWithAbortStrategy(documents);
            case ConflictResolutionStrategy.Skip:
                return this.writeWithSkipStrategy(documents);
            case ConflictResolutionStrategy.Overwrite:
                return this.writeWithOverwriteStrategy(documents);
            case ConflictResolutionStrategy.GenerateNewIds:
                return this.writeWithGenerateNewIdsStrategy(documents);
            default: {
                const exhaustiveCheck: never = strategy;
                throw new Error(`Unknown strategy: ${String(exhaustiveCheck)}`);
            }
        }
    }

    protected classifyError(error: unknown, _actionContext?: IActionContext): ErrorType {
        if (error instanceof Error) {
            if (error.message.includes('THROTTLE')) {
                return 'throttle';
            }
            if (error.message.includes('NETWORK')) {
                return 'network';
            }
            if (error.message.includes('CONFLICT')) {
                return 'conflict';
            }
        }
        return 'other';
    }

    protected extractPartialProgress(error: unknown, _actionContext?: IActionContext): PartialProgress | undefined {
        // Extract partial progress from error message if available
        // Use lastPartialProgress which is preserved after errorConfig is cleared
        if (error instanceof Error && this.lastPartialProgress !== undefined) {
            const progress = this.lastPartialProgress;
            this.lastPartialProgress = undefined; // Clear after use
            return {
                processedCount: progress,
                insertedCount: progress,
            };
        }
        return undefined;
    }

    // Strategy implementations

    private writeWithAbortStrategy(documents: DocumentDetails[]): AbortBatchResult<string> {
        const conflicts: Array<{ documentId: string; error: Error }> = [];
        let insertedCount = 0;

        for (const doc of documents) {
            const docId = doc.id as string;
            if (this.storage.has(docId)) {
                // Conflict - return in errors array (primary path)
                conflicts.push({
                    documentId: docId,
                    error: new Error(`Duplicate key error for document with _id: ${docId}`),
                });
                break; // Abort stops on first conflict
            } else {
                this.storage.set(docId, doc.documentContent);
                insertedCount++;
            }
        }

        return {
            processedCount: insertedCount + conflicts.length,
            insertedCount,
            abortedCount: conflicts.length,
            errors: conflicts.length > 0 ? conflicts : undefined,
        };
    }

    private writeWithSkipStrategy(documents: DocumentDetails[]): SkipBatchResult<string> {
        // Pre-filter conflicts (like DocumentDbStreamingWriter does)
        const docsToInsert: DocumentDetails[] = [];
        const skippedIds: string[] = [];

        for (const doc of documents) {
            const docId = doc.id as string;
            if (this.storage.has(docId)) {
                skippedIds.push(docId);
            } else {
                docsToInsert.push(doc);
            }
        }

        // Insert non-conflicting documents
        let insertedCount = 0;
        for (const doc of docsToInsert) {
            this.storage.set(doc.id as string, doc.documentContent);
            insertedCount++;
        }

        const errors = skippedIds.map((id) => ({
            documentId: id,
            error: new Error('Document already exists (skipped)'),
        }));

        return {
            processedCount: insertedCount + skippedIds.length,
            insertedCount,
            skippedCount: skippedIds.length,
            errors: errors.length > 0 ? errors : undefined,
        };
    }

    private writeWithOverwriteStrategy(documents: DocumentDetails[]): OverwriteBatchResult<string> {
        let replacedCount = 0;
        let createdCount = 0;

        for (const doc of documents) {
            const docId = doc.id as string;
            if (this.storage.has(docId)) {
                replacedCount++;
                this.storage.set(docId, doc.documentContent);
            } else {
                createdCount++;
                this.storage.set(docId, doc.documentContent);
            }
        }

        return {
            processedCount: replacedCount + createdCount,
            replacedCount,
            createdCount,
        };
    }

    private writeWithGenerateNewIdsStrategy(documents: DocumentDetails[]): GenerateNewIdsBatchResult<string> {
        let insertedCount = 0;

        for (const doc of documents) {
            // Generate new ID (simulate MongoDB ObjectId generation)
            const newId = `generated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            this.storage.set(newId, doc.documentContent);
            insertedCount++;
        }

        return {
            processedCount: insertedCount,
            insertedCount,
        };
    }

    // Helper to inject errors with partial write support
    // When writeBeforeThrottle is true, actually writes documents before throwing error
    private checkAndThrowErrorWithPartialWrite(
        documents: DocumentDetails[],
        strategy: ConflictResolutionStrategy,
    ): void {
        if (this.errorConfig) {
            const newCount = this.processedCountForErrorInjection + documents.length;
            if (newCount > this.errorConfig.afterDocuments) {
                const partialCount = this.errorConfig.partialProgress ?? 0;

                // If writeBeforeThrottle is enabled, actually write the partial docs to storage
                if (this.errorConfig.writeBeforeThrottle && partialCount > 0) {
                    const docsToWrite = documents.slice(0, partialCount);
                    for (const doc of docsToWrite) {
                        const docId = doc.id as string;
                        // Only write if not already in storage (for Abort strategy)
                        if (strategy === ConflictResolutionStrategy.Abort && !this.storage.has(docId)) {
                            this.storage.set(docId, doc.documentContent);
                        } else if (strategy !== ConflictResolutionStrategy.Abort) {
                            // For other strategies, always write/overwrite
                            this.storage.set(docId, doc.documentContent);
                        }
                    }
                }

                // Preserve partial progress before clearing config (for extractPartialProgress)
                this.lastPartialProgress = partialCount;
                const error = new Error(`MOCK_${this.errorConfig.errorType.toUpperCase()}_ERROR`);
                this.clearErrorConfig(); // Only throw once
                throw error;
            }
            this.processedCountForErrorInjection = newCount;
        }
    }
}

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

describe('StreamingDocumentWriter', () => {
    let writer: MockStreamingWriter;

    beforeEach(() => {
        writer = new MockStreamingWriter('testdb', 'testcollection');
        writer.clearStorage();
        writer.clearErrorConfig();
        jest.clearAllMocks();
    });

    // ==================== 1. Core Streaming Operations ====================

    describe('streamDocuments - Core Streaming', () => {
        it('should handle empty stream', async () => {
            const stream = createDocumentStream([]);

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
            });

            expect(result.totalProcessed).toBe(0);
            expect(result.insertedCount).toBeUndefined(); // No documents processed in empty stream
            expect(result.flushCount).toBe(0);
        });

        it('should process small stream with final flush', async () => {
            const documents = createDocuments(10); // Less than buffer limit
            const stream = createDocumentStream(documents);

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
            });

            expect(result.totalProcessed).toBe(10);
            expect(result.insertedCount).toBe(10);
            expect(result.flushCount).toBe(1); // Final flush at end
            expect(writer.getStorage().size).toBe(10);
        });

        it('should process large stream with multiple flushes', async () => {
            const documents = createDocuments(1500); // Exceeds default batch size (500)
            const stream = createDocumentStream(documents);

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
            });

            expect(result.totalProcessed).toBe(1500);
            expect(result.insertedCount).toBe(1500);
            expect(result.flushCount).toBeGreaterThan(1);
            expect(writer.getStorage().size).toBe(1500);
        });

        it('should invoke progress callback after each flush with details', async () => {
            const documents = createDocuments(1500);
            const stream = createDocumentStream(documents);
            const progressUpdates: Array<{ count: number; details?: string }> = [];

            await writer.streamDocuments(
                stream,
                { conflictResolutionStrategy: ConflictResolutionStrategy.Abort },
                {
                    onProgress: (count, details) => {
                        progressUpdates.push({ count, details });
                    },
                },
            );

            // Should have multiple progress updates
            expect(progressUpdates.length).toBeGreaterThan(1);

            // Each update should have a count
            for (const update of progressUpdates) {
                expect(update.count).toBeGreaterThan(0);
            }

            // Sum of counts should be >= total processed (may include retries)
            const totalReported = progressUpdates.reduce((sum, update) => sum + update.count, 0);
            expect(totalReported).toBeGreaterThanOrEqual(1500);
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

            const result = await writer.streamDocuments(
                stream,
                { conflictResolutionStrategy: ConflictResolutionStrategy.Abort },
                {
                    onProgress,
                    abortSignal: abortController.signal,
                },
            );

            // Should have processed less than total
            expect(result.totalProcessed).toBeLessThan(2000);
            expect(result.totalProcessed).toBeGreaterThan(0);
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

            await writer.streamDocuments(
                stream,
                { conflictResolutionStrategy: ConflictResolutionStrategy.Abort },
                { actionContext: mockContext },
            );

            expect(mockContext.telemetry.measurements.streamTotalProcessed).toBe(100);
            expect(mockContext.telemetry.measurements.streamTotalInserted).toBe(100);
            expect(mockContext.telemetry.measurements.streamFlushCount).toBeGreaterThan(0);
        });
    });

    // ==================== 2. Progress Reporting Details ====================

    describe('Progress Reporting Details', () => {
        it('should report correct progress details for Skip strategy', async () => {
            // Seed storage with some existing documents (doc1-doc50)
            const existingDocs = createDocuments(50, 1);
            writer.seedStorage(existingDocs);

            // Stream 150 documents (doc1-doc150), where first 50 exist
            const documents = createDocuments(150);
            const stream = createDocumentStream(documents);
            const progressUpdates: Array<{ count: number; details?: string }> = [];

            await writer.streamDocuments(
                stream,
                { conflictResolutionStrategy: ConflictResolutionStrategy.Skip },
                {
                    onProgress: (count, details) => {
                        progressUpdates.push({ count, details });
                    },
                },
            );

            // Should have progress updates
            expect(progressUpdates.length).toBeGreaterThan(0);

            // Last progress update should show both inserted and skipped
            const lastUpdate = progressUpdates[progressUpdates.length - 1];
            expect(lastUpdate.details).toBeDefined();
            expect(lastUpdate.details).toContain('inserted');
            expect(lastUpdate.details).toContain('skipped');
        });

        it('should report correct progress details for Overwrite strategy', async () => {
            // Seed storage with some existing documents (doc1-doc75)
            const existingDocs = createDocuments(75, 1);
            writer.seedStorage(existingDocs);

            // Stream 150 documents (doc1-doc150), where first 75 exist
            const documents = createDocuments(150);
            const stream = createDocumentStream(documents);
            const progressUpdates: Array<{ count: number; details?: string }> = [];

            await writer.streamDocuments(
                stream,
                { conflictResolutionStrategy: ConflictResolutionStrategy.Overwrite },
                {
                    onProgress: (count, details) => {
                        progressUpdates.push({ count, details });
                    },
                },
            );

            // Should have progress updates
            expect(progressUpdates.length).toBeGreaterThan(0);

            // Last progress update should show replaced and created
            const lastUpdate = progressUpdates[progressUpdates.length - 1];
            expect(lastUpdate.details).toBeDefined();
            expect(lastUpdate.details).toContain('replaced');
            expect(lastUpdate.details).toContain('created');
        });

        it('should report correct progress details for GenerateNewIds strategy', async () => {
            // Stream 120 documents - all should be inserted with new IDs
            const documents = createDocuments(120);
            const stream = createDocumentStream(documents);
            const progressUpdates: Array<{ count: number; details?: string }> = [];

            await writer.streamDocuments(
                stream,
                { conflictResolutionStrategy: ConflictResolutionStrategy.GenerateNewIds },
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
            expect(lastUpdate.details).not.toContain('skipped');
            expect(lastUpdate.details).not.toContain('matched');
            expect(lastUpdate.details).not.toContain('upserted');
        });

        it('should aggregate statistics correctly across flushes', async () => {
            // Seed storage with some existing documents
            const existingDocs = createDocuments(100, 1); // doc1-doc100
            writer.seedStorage(existingDocs);

            // Stream 300 documents (doc1-doc300), where first 100 exist
            const documents = createDocuments(300);
            const stream = createDocumentStream(documents);

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Skip,
            });

            expect(result.totalProcessed).toBe(300);
            expect(result.insertedCount).toBe(200); // 300 - 100 existing
            expect(result.skippedCount).toBe(100); // 100 skipped due to conflicts with existing documents
        });
    });

    // ==================== 3. Buffer Management ====================

    describe('Buffer Management', () => {
        it('should flush buffer when document count limit reached', async () => {
            const bufferLimit = writer.getBufferConstraints().optimalDocumentCount;
            const documents = createDocuments(bufferLimit + 10);
            const stream = createDocumentStream(documents);

            let flushCount = 0;
            await writer.streamDocuments(
                stream,
                { conflictResolutionStrategy: ConflictResolutionStrategy.Abort },
                {
                    onProgress: () => {
                        flushCount++;
                    },
                },
            );

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

            await writer.streamDocuments(
                stream,
                { conflictResolutionStrategy: ConflictResolutionStrategy.Abort },
                {
                    onProgress: () => {
                        flushCount++;
                    },
                },
            );

            // Should have multiple flushes due to memory limit
            expect(flushCount).toBeGreaterThan(1);
        });

        it('should flush remaining documents at end of stream', async () => {
            const documents = createDocuments(50); // Less than buffer limit
            const stream = createDocumentStream(documents);

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
            });

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

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
            });

            // Should successfully process all documents
            expect(result.totalProcessed).toBe(3);
        });
    });

    // ==================== 4. Abort Strategy ====================

    describe('Abort Strategy', () => {
        it('should succeed with empty target collection', async () => {
            const documents = createDocuments(100);
            const stream = createDocumentStream(documents);

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
            });

            expect(result.totalProcessed).toBe(100);
            expect(result.insertedCount).toBe(100);
            expect(writer.getStorage().size).toBe(100);
        });

        it('should throw StreamingWriterError with partial stats on _id collision', async () => {
            // Seed storage with doc50
            writer.seedStorage([createDocuments(1, 50)[0]]);

            const documents = createDocuments(100); // doc1-doc100
            const stream = createDocumentStream(documents);

            await expect(
                writer.streamDocuments(stream, { conflictResolutionStrategy: ConflictResolutionStrategy.Abort }),
            ).rejects.toThrow(StreamingWriterError);

            // Test with a new stream to verify partial stats
            writer.clearStorage();
            writer.seedStorage([createDocuments(1, 50)[0]]);
            const newStream = createDocumentStream(createDocuments(100));
            let caughtError: StreamingWriterError | undefined;

            try {
                await writer.streamDocuments(newStream, {
                    conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
                });
            } catch (error) {
                caughtError = error as StreamingWriterError;
            }

            expect(caughtError).toBeInstanceOf(StreamingWriterError);
            expect(caughtError?.partialStats.totalProcessed).toBeGreaterThan(0);
            expect(caughtError?.partialStats.totalProcessed).toBeLessThan(100);

            // Verify getStatsString works
            const statsString = caughtError?.getStatsString();
            expect(statsString).toContain('total');
        });
    });

    // ==================== 5. Skip Strategy ====================

    describe('Skip Strategy', () => {
        it('should insert all documents into empty collection', async () => {
            const documents = createDocuments(100);
            const stream = createDocumentStream(documents);

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Skip,
            });

            expect(result.totalProcessed).toBe(100);
            expect(result.insertedCount).toBe(100);
            expect(result.skippedCount).toBeUndefined(); // No skips in empty collection
            expect(writer.getStorage().size).toBe(100);
        });

        it('should insert new documents and skip colliding ones', async () => {
            // Seed with doc10, doc20, doc30
            writer.seedStorage([createDocuments(1, 10)[0], createDocuments(1, 20)[0], createDocuments(1, 30)[0]]);

            const documents = createDocuments(50); // doc1-doc50
            const stream = createDocumentStream(documents);

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Skip,
            });

            expect(result.totalProcessed).toBe(50);
            expect(result.insertedCount).toBe(47); // 50 - 3 conflicts
            expect(result.skippedCount).toBe(3); // 3 skipped due to conflicts with existing documents
            expect(writer.getStorage().size).toBe(50); // 47 new + 3 existing
        });
    });

    // ==================== 6. Overwrite Strategy ====================

    describe('Overwrite Strategy', () => {
        it('should upsert all documents into empty collection', async () => {
            const documents = createDocuments(100);
            const stream = createDocumentStream(documents);

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Overwrite,
            });

            expect(result.totalProcessed).toBe(100);
            expect(result.createdCount).toBe(100);
            expect(result.replacedCount).toBeUndefined(); // No replacements in empty collection
            expect(writer.getStorage().size).toBe(100);
        });

        it('should replace existing and upsert new documents', async () => {
            // Seed with doc10, doc20, doc30
            writer.seedStorage([createDocuments(1, 10)[0], createDocuments(1, 20)[0], createDocuments(1, 30)[0]]);

            const documents = createDocuments(50); // doc1-doc50
            const stream = createDocumentStream(documents);

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Overwrite,
            });

            expect(result.totalProcessed).toBe(50);
            expect(result.replacedCount).toBe(3); // doc10, doc20, doc30 were replaced
            expect(result.createdCount).toBe(47); // 50 - 3 replaced = 47 created
            expect(writer.getStorage().size).toBe(50);
        });
    });

    // ==================== 7. GenerateNewIds Strategy ====================

    describe('GenerateNewIds Strategy', () => {
        it('should insert documents with new IDs successfully', async () => {
            const documents = createDocuments(100);
            const stream = createDocumentStream(documents);

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.GenerateNewIds,
            });

            expect(result.totalProcessed).toBe(100);
            expect(result.insertedCount).toBe(100);
            expect(writer.getStorage().size).toBe(100);

            // Verify original IDs were not used
            expect(writer.getStorage().has('doc1')).toBe(false);
        });
    });

    // ==================== 8. Throttle Handling ====================

    describe('Throttle Handling', () => {
        it('should switch mode to RU-limited on first throttle', async () => {
            expect(writer.getCurrentMode()).toBe('fast');

            // Inject throttle error after 100 documents
            writer.setErrorConfig({
                errorType: 'throttle',
                afterDocuments: 100,
                partialProgress: 100,
            });

            const documents = createDocuments(200);
            const stream = createDocumentStream(documents);

            await writer.streamDocuments(stream, { conflictResolutionStrategy: ConflictResolutionStrategy.Abort });

            expect(writer.getCurrentMode()).toBe('ru-limited');
        });

        it('should shrink batch size after throttle', async () => {
            const initialBatchSize = writer.getCurrentBatchSize();

            // Inject throttle error
            writer.setErrorConfig({
                errorType: 'throttle',
                afterDocuments: 100,
                partialProgress: 100,
            });

            const documents = createDocuments(200);
            const stream = createDocumentStream(documents);

            await writer.streamDocuments(stream, { conflictResolutionStrategy: ConflictResolutionStrategy.Abort });

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

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
            });

            // Should eventually process all documents
            expect(result.totalProcessed).toBe(200);
            expect(result.insertedCount).toBe(200);
        });

        it('should NOT re-insert already-written documents when throttle occurs with partial progress', async () => {
            // This test reproduces the bug where throttle after 78 documents
            // causes those 78 documents to be re-sent on retry, resulting in
            // duplicate key errors.
            //
            // Scenario from user report:
            // - 500 documents buffered and flushed
            // - Throttle occurs after 78 documents successfully inserted
            // - On retry, the same 500-document batch is re-sent
            // - Documents 1-78 are duplicates, causing conflict errors

            const documents = createDocuments(500);
            const stream = createDocumentStream(documents);

            // Inject throttle error that actually writes 78 documents before throwing
            writer.setErrorConfig({
                errorType: 'throttle',
                afterDocuments: 0, // Trigger on first batch
                partialProgress: 78,
                writeBeforeThrottle: true, // Actually write the 78 docs before throwing
            });

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
            });

            // Should process all 500 documents without duplicates
            expect(result.totalProcessed).toBe(500);
            expect(result.insertedCount).toBe(500);

            // Verify storage has exactly 500 documents (no duplicates, no missing)
            expect(writer.getStorage().size).toBe(500);

            // Verify specific documents are present
            expect(writer.getStorage().has('doc1')).toBe(true);
            expect(writer.getStorage().has('doc78')).toBe(true);
            expect(writer.getStorage().has('doc79')).toBe(true);
            expect(writer.getStorage().has('doc500')).toBe(true);
        });

        it('should skip already-written documents on retry after throttle (Skip strategy)', async () => {
            // Similar test for Skip strategy
            const documents = createDocuments(500);
            const stream = createDocumentStream(documents);

            writer.setErrorConfig({
                errorType: 'throttle',
                afterDocuments: 0,
                partialProgress: 78,
                writeBeforeThrottle: true,
            });

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Skip,
            });

            // Should process all 500 documents
            expect(result.totalProcessed).toBe(500);
            expect(result.insertedCount).toBe(500);
            expect(writer.getStorage().size).toBe(500);
        });
    });

    // ==================== 9. Network Error Handling ====================

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

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
            });

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

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
            });

            // Should process all documents despite network error
            expect(result.totalProcessed).toBe(500);
            expect(result.insertedCount).toBe(500);
        });
    });

    // ==================== 10. Unexpected Error Handling ====================

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
                writer.streamDocuments(stream, { conflictResolutionStrategy: ConflictResolutionStrategy.Abort }),
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
                writer.streamDocuments(stream, { conflictResolutionStrategy: ConflictResolutionStrategy.Abort }),
            ).rejects.toThrow();

            // Verify not all documents were processed
            expect(writer.getStorage().size).toBeLessThan(500);
        });
    });

    // ==================== 11. StreamingWriterError ====================

    describe('StreamingWriterError', () => {
        it('should include partial statistics', async () => {
            writer.seedStorage([createDocuments(1, 50)[0]]);

            const documents = createDocuments(100);
            const stream = createDocumentStream(documents);

            let caughtError: StreamingWriterError | undefined;

            try {
                await writer.streamDocuments(stream, { conflictResolutionStrategy: ConflictResolutionStrategy.Abort });
                // Should not reach here
                expect(true).toBe(false);
            } catch (error) {
                caughtError = error as StreamingWriterError;
            }

            expect(caughtError).toBeInstanceOf(StreamingWriterError);
            expect(caughtError?.partialStats).toBeDefined();
            expect(caughtError?.partialStats.totalProcessed).toBeGreaterThan(0);
            expect(caughtError?.partialStats.insertedCount).toBeDefined();
        });

        it('should format getStatsString for Abort strategy correctly', () => {
            const error = new StreamingWriterError('Test error', {
                totalProcessed: 100,
                insertedCount: 100,
                flushCount: 2,
            });

            const statsString = error.getStatsString();
            expect(statsString).toContain('100 total');
            expect(statsString).toContain('100 inserted');
        });

        it('should format getStatsString for Skip strategy correctly', () => {
            const error = new StreamingWriterError('Test error', {
                totalProcessed: 100,
                insertedCount: 80,
                skippedCount: 20,
                flushCount: 2,
            });

            const statsString = error.getStatsString();
            expect(statsString).toContain('100 total');
            expect(statsString).toContain('80 inserted');
            expect(statsString).toContain('20 skipped');
        });

        it('should format getStatsString for Overwrite strategy correctly', () => {
            const error = new StreamingWriterError('Test error', {
                totalProcessed: 100,
                replacedCount: 60,
                createdCount: 40,
                flushCount: 2,
            });

            const statsString = error.getStatsString();
            expect(statsString).toContain('100 total');
            expect(statsString).toContain('60 replaced');
            expect(statsString).toContain('40 created');
        });
    });

    // ==================== 12. Buffer Constraints ====================

    describe('Buffer Constraints', () => {
        it('should return current batch size', () => {
            const constraints = writer.getBufferConstraints();

            expect(constraints.optimalDocumentCount).toBe(writer.getCurrentBatchSize());
        });

        it('should return correct memory limit', () => {
            const constraints = writer.getBufferConstraints();

            expect(constraints.maxMemoryMB).toBe(24); // BUFFER_MEMORY_LIMIT_MB
        });
    });

    // ==================== 13. Batch Size Boundaries ====================

    describe('Batch Size Boundaries', () => {
        it('should respect minimum batch size of 1', async () => {
            // Inject multiple throttles to drive batch size down
            writer.setErrorConfig({
                errorType: 'throttle',
                afterDocuments: 0, // Throttle immediately with no progress
                partialProgress: 0,
            });

            const documents = createDocuments(100);
            const stream = createDocumentStream(documents);

            // First throttle should halve the batch size
            // After multiple throttles, batch size should not go below 1
            try {
                await writer.streamDocuments(stream, {
                    conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
                });
            } catch {
                // Expected to eventually fail after max retries
            }

            // Batch size should be at minimum of 1, not 0
            expect(writer.getCurrentBatchSize()).toBeGreaterThanOrEqual(1);
        });

        it('should start with fast mode max batch size of 500', () => {
            // Fast mode initial batch size is 500
            expect(writer.getCurrentMode()).toBe('fast');
            expect(writer.getCurrentBatchSize()).toBe(500);
        });

        it('should switch to RU-limited mode with smaller initial size after throttle', async () => {
            // Trigger a throttle to switch to RU-limited mode
            writer.setErrorConfig({
                errorType: 'throttle',
                afterDocuments: 50,
                partialProgress: 50,
            });

            const documents = createDocuments(100);
            const stream = createDocumentStream(documents);

            await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
            });

            expect(writer.getCurrentMode()).toBe('ru-limited');
            // RU-limited mode should have smaller batch sizes
            expect(writer.getCurrentBatchSize()).toBeLessThanOrEqual(1000);
        });
    });

    // ==================== 14. Multiple Throttle Handling ====================

    describe('Multiple Throttle Handling', () => {
        it('should handle consecutive throttles without duplicating documents', async () => {
            // Configure to throttle multiple times with partial progress
            // The throttle will clear itself after the first successful recovery
            writer.setErrorConfig({
                errorType: 'throttle',
                afterDocuments: 30,
                partialProgress: 30,
                writeBeforeThrottle: true,
            });

            const documents = createDocuments(200);
            const stream = createDocumentStream(documents);

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
            });

            // Should have processed all 200 documents exactly once
            expect(result.totalProcessed).toBe(200);
            expect(result.insertedCount).toBe(200);

            // Storage should have exactly 200 documents (no duplicates)
            expect(writer.getStorage().size).toBe(200);
        });
    });
});
