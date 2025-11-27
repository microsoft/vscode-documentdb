/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ConflictResolutionStrategy, type DocumentDetails, type EnsureTargetExistsResult } from '../types';
import { StreamingDocumentWriter, StreamingWriterError } from './StreamingDocumentWriter';
import {
    type AbortBatchResult,
    type ErrorType,
    type GenerateNewIdsBatchResult,
    type OverwriteBatchResult,
    type PartialProgress,
    type SkipBatchResult,
    type StrategyBatchResult,
} from './writerTypes.internal';

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
        this.clearErrorConfig();
    }

    public getBufferConstraints(): { optimalDocumentCount: number; maxMemoryMB: number } {
        return this.batchSizeAdapter.getBufferConstraints();
    }

    // Abstract method implementations

    public async ensureTargetExists(): Promise<EnsureTargetExistsResult> {
        return { targetWasCreated: false };
    }

    protected async writeBatch(
        documents: DocumentDetails[],
        strategy: ConflictResolutionStrategy,
        _actionContext?: IActionContext,
    ): Promise<StrategyBatchResult<string>> {
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
        if (error instanceof Error && this.lastPartialProgress !== undefined) {
            const progress = this.lastPartialProgress;
            this.lastPartialProgress = undefined;
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
                conflicts.push({
                    documentId: docId,
                    error: new Error(`Duplicate key error for document with _id: ${docId}`),
                });
                break;
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
            const newId = `generated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            this.storage.set(newId, doc.documentContent);
            insertedCount++;
        }

        return {
            processedCount: insertedCount,
            insertedCount,
        };
    }

    private checkAndThrowErrorWithPartialWrite(
        documents: DocumentDetails[],
        strategy: ConflictResolutionStrategy,
    ): void {
        if (this.errorConfig) {
            const newCount = this.processedCountForErrorInjection + documents.length;
            if (newCount > this.errorConfig.afterDocuments) {
                const partialCount = this.errorConfig.partialProgress ?? 0;

                if (this.errorConfig.writeBeforeThrottle && partialCount > 0) {
                    const docsToWrite = documents.slice(0, partialCount);
                    for (const doc of docsToWrite) {
                        const docId = doc.id as string;
                        if (strategy === ConflictResolutionStrategy.Abort && !this.storage.has(docId)) {
                            this.storage.set(docId, doc.documentContent);
                        } else if (strategy !== ConflictResolutionStrategy.Abort) {
                            this.storage.set(docId, doc.documentContent);
                        }
                    }
                }

                this.lastPartialProgress = partialCount;
                const error = new Error(`MOCK_${this.errorConfig.errorType.toUpperCase()}_ERROR`);
                this.clearErrorConfig();
                throw error;
            }
            this.processedCountForErrorInjection = newCount;
        }
    }
}

// =============================================================================
// TEST HELPERS
// =============================================================================

function createDocuments(count: number, startId: number = 1): DocumentDetails[] {
    return Array.from({ length: count }, (_, i) => ({
        id: `doc${startId + i}`,
        documentContent: { name: `Document ${startId + i}`, value: Math.random() },
    }));
}

/**
 * Creates a sparse collection pattern with gaps for testing.
 *
 * Pattern for 100-doc range (doc1-doc100):
 * - doc1-doc20:  NO documents (20 empty slots)
 * - doc21-doc35: 15 documents EXIST
 * - doc36-doc60: NO documents (25 empty slots)
 * - doc61-doc80: 20 documents EXIST
 * - doc81-doc100: NO documents (20 empty slots)
 *
 * Total: 35 existing documents with realistic gaps
 *
 * This pattern helps test:
 * - How writes handle gaps at the start
 * - Mid-batch conflicts after some successful inserts
 * - Second gap followed by more conflicts
 * - Clean ending with no conflicts
 */
function createSparseCollection(): DocumentDetails[] {
    return [
        ...createDocuments(15, 21), // doc21-doc35 (15 docs)
        ...createDocuments(20, 61), // doc61-doc80 (20 docs)
    ];
}

/** Number of documents that exist in sparse collection */
const SPARSE_EXISTING_COUNT = 35;

/** Number of documents that will be inserted (not conflicting) when writing doc1-doc100 to sparse collection */
const SPARSE_INSERT_COUNT = 65;

async function* createDocumentStream(documents: DocumentDetails[]): AsyncIterable<DocumentDetails> {
    for (const doc of documents) {
        yield doc;
    }
}

// =============================================================================
// TESTS
// =============================================================================

describe('StreamingDocumentWriter', () => {
    let writer: MockStreamingWriter;

    beforeEach(() => {
        writer = new MockStreamingWriter('testdb', 'testcollection');
        writer.clearStorage();
        writer.clearErrorConfig();
        jest.clearAllMocks();
    });

    // =========================================================================
    // 1. CORE STREAMING OPERATIONS
    // =========================================================================

    describe('Core Streaming Operations', () => {
        it('should handle empty stream', async () => {
            const stream = createDocumentStream([]);

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
            });

            expect(result.totalProcessed).toBe(0);
            expect(result.flushCount).toBe(0);
        });

        it('should process small stream with final flush', async () => {
            const documents = createDocuments(10);
            const stream = createDocumentStream(documents);

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
            });

            expect(result.totalProcessed).toBe(10);
            expect(result.insertedCount).toBe(10);
            expect(result.flushCount).toBe(1);
            expect(writer.getStorage().size).toBe(10);
        });

        it('should process large stream with multiple flushes', async () => {
            const documents = createDocuments(1500);
            const stream = createDocumentStream(documents);

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
            });

            expect(result.totalProcessed).toBe(1500);
            expect(result.insertedCount).toBe(1500);
            expect(result.flushCount).toBeGreaterThan(1);
            expect(writer.getStorage().size).toBe(1500);
        });

        it('should invoke progress callback after each flush', async () => {
            const documents = createDocuments(1500);
            const stream = createDocumentStream(documents);
            const progressUpdates: Array<{ count: number; details?: string }> = [];

            await writer.streamDocuments(
                stream,
                { conflictResolutionStrategy: ConflictResolutionStrategy.Abort },
                { onProgress: (count, details) => progressUpdates.push({ count, details }) },
            );

            expect(progressUpdates.length).toBeGreaterThan(1);
            for (const update of progressUpdates) {
                expect(update.count).toBeGreaterThan(0);
            }
        });

        it('should respect abort signal', async () => {
            const documents = createDocuments(2000);
            const stream = createDocumentStream(documents);
            const abortController = new AbortController();

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
                { onProgress, abortSignal: abortController.signal },
            );

            expect(result.totalProcessed).toBeLessThan(2000);
            expect(result.totalProcessed).toBeGreaterThan(0);
        });

        it('should record telemetry when actionContext provided', async () => {
            const documents = createDocuments(100);
            const stream = createDocumentStream(documents);
            const mockContext: IActionContext = {
                telemetry: { properties: {}, measurements: {} },
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

    // =========================================================================
    // 2. CONFLICT RESOLUTION STRATEGIES
    // =========================================================================

    describe('Conflict Resolution Strategies', () => {
        // =====================================================================
        // 2.1 ABORT STRATEGY
        // =====================================================================

        describe('Abort Strategy', () => {
            describe('collection state scenarios', () => {
                it('should insert all documents into empty collection', async () => {
                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
                    });

                    expect(result.totalProcessed).toBe(100);
                    expect(result.insertedCount).toBe(100);
                    expect(writer.getStorage().size).toBe(100);
                });

                it('should abort on first conflict in sparse collection', async () => {
                    // Sparse pattern: gaps at 1-20, docs at 21-35, gaps at 36-60, docs at 61-80, gaps at 81-100
                    writer.seedStorage(createSparseCollection());

                    const documents = createDocuments(100); // doc1-doc100
                    const stream = createDocumentStream(documents);

                    // Should abort when hitting first existing doc (doc21)
                    await expect(
                        writer.streamDocuments(stream, {
                            conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
                        }),
                    ).rejects.toThrow(StreamingWriterError);

                    // doc1-doc20 inserted (20 docs) + 35 existing = 55 total
                    expect(writer.getStorage().size).toBe(20 + SPARSE_EXISTING_COUNT);
                });

                it('should abort when 50% of batch exists (collision at doc50)', async () => {
                    // Seed with doc50 (collision point)
                    writer.seedStorage([createDocuments(1, 50)[0]]);

                    const documents = createDocuments(100); // doc1-doc100
                    const stream = createDocumentStream(documents);

                    await expect(
                        writer.streamDocuments(stream, {
                            conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
                        }),
                    ).rejects.toThrow(StreamingWriterError);

                    // Only doc1-doc49 should be inserted before collision
                    expect(writer.getStorage().size).toBe(50); // 49 new + 1 existing
                });
            });

            describe('with throttling', () => {
                it('should recover from throttle and complete all inserts (empty collection)', async () => {
                    writer.setErrorConfig({
                        errorType: 'throttle',
                        afterDocuments: 30,
                        partialProgress: 30,
                        writeBeforeThrottle: true,
                    });

                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
                    });

                    expect(result.totalProcessed).toBe(100);
                    expect(result.insertedCount).toBe(100);
                    expect(writer.getStorage().size).toBe(100);
                });

                it('should abort after throttle recovery when hitting sparse conflict', async () => {
                    // Sparse: doc21-35 and doc61-80 exist
                    // Throttle after 15 docs (doc1-doc15 written), then retry
                    // Should abort when hitting doc21
                    writer.seedStorage(createSparseCollection());
                    writer.setErrorConfig({
                        errorType: 'throttle',
                        afterDocuments: 15,
                        partialProgress: 15,
                        writeBeforeThrottle: true,
                    });

                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    // Should abort when hitting first conflict (doc21) after throttle recovery
                    await expect(
                        writer.streamDocuments(stream, {
                            conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
                        }),
                    ).rejects.toThrow(StreamingWriterError);

                    // doc1-doc20 inserted before conflict at doc21
                    expect(writer.getStorage().size).toBe(20 + SPARSE_EXISTING_COUNT);
                });

                it('should abort on collision even after throttle recovery', async () => {
                    writer.seedStorage([createDocuments(1, 80)[0]]); // doc80 exists
                    writer.setErrorConfig({
                        errorType: 'throttle',
                        afterDocuments: 30,
                        partialProgress: 30,
                        writeBeforeThrottle: true,
                    });

                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    await expect(
                        writer.streamDocuments(stream, {
                            conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
                        }),
                    ).rejects.toThrow(StreamingWriterError);
                });
            });

            describe('with network errors', () => {
                it('should recover from network error and complete (empty collection)', async () => {
                    writer.setErrorConfig({
                        errorType: 'network',
                        afterDocuments: 30,
                        partialProgress: 0,
                    });

                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
                    });

                    expect(result.totalProcessed).toBe(100);
                    expect(result.insertedCount).toBe(100);
                });

                it('should abort after network recovery when hitting sparse conflict', async () => {
                    // Sparse: doc21-35 and doc61-80 exist
                    // Network error after 15 docs, then retry and hit conflict at doc21
                    writer.seedStorage(createSparseCollection());
                    writer.setErrorConfig({
                        errorType: 'network',
                        afterDocuments: 15,
                        partialProgress: 0,
                    });

                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    // Should abort when hitting first conflict (doc21) after network recovery
                    await expect(
                        writer.streamDocuments(stream, {
                            conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
                        }),
                    ).rejects.toThrow(StreamingWriterError);

                    // doc1-doc20 inserted before conflict at doc21
                    expect(writer.getStorage().size).toBe(20 + SPARSE_EXISTING_COUNT);
                });

                it('should abort on collision after network recovery', async () => {
                    writer.seedStorage([createDocuments(1, 80)[0]]);
                    writer.setErrorConfig({
                        errorType: 'network',
                        afterDocuments: 30,
                        partialProgress: 0,
                    });

                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    await expect(
                        writer.streamDocuments(stream, {
                            conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
                        }),
                    ).rejects.toThrow(StreamingWriterError);
                });
            });
        });

        // =====================================================================
        // 2.2 SKIP STRATEGY
        // =====================================================================

        describe('Skip Strategy', () => {
            describe('collection state scenarios', () => {
                it('should insert all documents into empty collection', async () => {
                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Skip,
                    });

                    expect(result.totalProcessed).toBe(100);
                    expect(result.insertedCount).toBe(100);
                    expect(result.skippedCount).toBeUndefined();
                    expect(writer.getStorage().size).toBe(100);
                });

                it('should skip conflicts in sparse collection', async () => {
                    // Sparse: doc21-35 (15) and doc61-80 (20) exist = 35 total
                    writer.seedStorage(createSparseCollection());

                    const documents = createDocuments(100); // doc1-doc100
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Skip,
                    });

                    expect(result.totalProcessed).toBe(100);
                    expect(result.insertedCount).toBe(SPARSE_INSERT_COUNT); // 65 new docs
                    expect(result.skippedCount).toBe(SPARSE_EXISTING_COUNT); // 35 skipped
                    expect(writer.getStorage().size).toBe(100); // All slots filled
                });

                it('should skip 50% when half of batch exists', async () => {
                    // Seed with doc1-doc50
                    writer.seedStorage(createDocuments(50, 1));

                    const documents = createDocuments(100); // doc1-doc100
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Skip,
                    });

                    expect(result.totalProcessed).toBe(100);
                    expect(result.insertedCount).toBe(50); // doc51-doc100
                    expect(result.skippedCount).toBe(50); // doc1-doc50 skipped
                    expect(writer.getStorage().size).toBe(100);
                });

                it('should handle alternating gaps and conflicts', async () => {
                    // Custom pattern: doc5, doc15, doc25, doc35, doc45 exist (5 docs)
                    writer.seedStorage([
                        createDocuments(1, 5)[0],
                        createDocuments(1, 15)[0],
                        createDocuments(1, 25)[0],
                        createDocuments(1, 35)[0],
                        createDocuments(1, 45)[0],
                    ]);

                    const documents = createDocuments(50); // doc1-doc50
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Skip,
                    });

                    expect(result.totalProcessed).toBe(50);
                    expect(result.insertedCount).toBe(45); // 50 - 5 conflicts
                    expect(result.skippedCount).toBe(5);
                    expect(writer.getStorage().size).toBe(50);
                });
            });

            describe('with throttling', () => {
                it('should recover from throttle and complete (empty collection)', async () => {
                    writer.setErrorConfig({
                        errorType: 'throttle',
                        afterDocuments: 30,
                        partialProgress: 30,
                        writeBeforeThrottle: true,
                    });

                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Skip,
                    });

                    expect(result.totalProcessed).toBe(100);
                    expect(result.insertedCount).toBe(100);
                    expect(writer.getStorage().size).toBe(100);
                });

                it('should recover from throttle with 50% existing', async () => {
                    writer.seedStorage(createDocuments(50, 1));
                    writer.setErrorConfig({
                        errorType: 'throttle',
                        afterDocuments: 30,
                        partialProgress: 30,
                        writeBeforeThrottle: true,
                    });

                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Skip,
                    });

                    // Total processed should be 100
                    // First 30 docs written before throttle overlap with existing (doc1-doc30 already in doc1-doc50)
                    // After retry, remaining docs are processed, skipping existing ones
                    expect(result.totalProcessed).toBe(100);
                    // Final storage should have 100 docs (50 existing + 50 new from doc51-doc100)
                    expect(writer.getStorage().size).toBe(100);
                });

                it('should NOT re-insert already-written documents after throttle (500 doc batch)', async () => {
                    // Reproduces bug where throttle after 78 docs causes duplicates on retry
                    writer.setErrorConfig({
                        errorType: 'throttle',
                        afterDocuments: 0,
                        partialProgress: 78,
                        writeBeforeThrottle: true,
                    });

                    const documents = createDocuments(500);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Skip,
                    });

                    expect(result.totalProcessed).toBe(500);
                    expect(result.insertedCount).toBe(500);
                    expect(writer.getStorage().size).toBe(500);
                });

                it('should recover from throttle with sparse collection', async () => {
                    // Sparse: doc21-35 (15) and doc61-80 (20) exist = 35 total
                    // Throttle at doc15 (in first gap), then continue and skip conflicts
                    writer.seedStorage(createSparseCollection());
                    writer.setErrorConfig({
                        errorType: 'throttle',
                        afterDocuments: 15,
                        partialProgress: 15,
                        writeBeforeThrottle: true,
                    });

                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Skip,
                    });

                    expect(result.totalProcessed).toBe(100);
                    // 65 inserted (gaps: 1-20, 36-60, 81-100), 35 skipped (21-35, 61-80)
                    expect(result.insertedCount).toBe(SPARSE_INSERT_COUNT);
                    expect(result.skippedCount).toBe(SPARSE_EXISTING_COUNT);
                    expect(writer.getStorage().size).toBe(100);
                });
            });

            describe('with network errors', () => {
                it('should recover from network error (empty collection)', async () => {
                    writer.setErrorConfig({
                        errorType: 'network',
                        afterDocuments: 30,
                        partialProgress: 0,
                    });

                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Skip,
                    });

                    expect(result.totalProcessed).toBe(100);
                    expect(result.insertedCount).toBe(100);
                });

                it('should recover from network error with 50% existing', async () => {
                    writer.seedStorage(createDocuments(50, 1));
                    writer.setErrorConfig({
                        errorType: 'network',
                        afterDocuments: 30,
                        partialProgress: 0,
                    });

                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Skip,
                    });

                    expect(result.totalProcessed).toBe(100);
                    expect(result.insertedCount).toBe(50);
                    expect(result.skippedCount).toBe(50);
                });

                it('should recover from network error with sparse collection', async () => {
                    // Sparse: doc21-35 (15) and doc61-80 (20) exist = 35 total
                    // Network error at doc15 (in first gap), then continue and skip conflicts
                    writer.seedStorage(createSparseCollection());
                    writer.setErrorConfig({
                        errorType: 'network',
                        afterDocuments: 15,
                        partialProgress: 0,
                    });

                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Skip,
                    });

                    expect(result.totalProcessed).toBe(100);
                    expect(result.insertedCount).toBe(SPARSE_INSERT_COUNT);
                    expect(result.skippedCount).toBe(SPARSE_EXISTING_COUNT);
                    expect(writer.getStorage().size).toBe(100);
                });
            });
        });

        // =====================================================================
        // 2.3 OVERWRITE STRATEGY
        // =====================================================================

        describe('Overwrite Strategy', () => {
            describe('collection state scenarios', () => {
                it('should create all documents in empty collection', async () => {
                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Overwrite,
                    });

                    expect(result.totalProcessed).toBe(100);
                    expect(result.createdCount).toBe(100);
                    expect(result.replacedCount).toBeUndefined();
                    expect(writer.getStorage().size).toBe(100);
                });

                it('should replace conflicts in sparse collection', async () => {
                    // Sparse: doc21-35 (15) and doc61-80 (20) exist = 35 total
                    writer.seedStorage(createSparseCollection());

                    const documents = createDocuments(100); // doc1-doc100
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Overwrite,
                    });

                    expect(result.totalProcessed).toBe(100);
                    expect(result.createdCount).toBe(SPARSE_INSERT_COUNT); // 65 created
                    expect(result.replacedCount).toBe(SPARSE_EXISTING_COUNT); // 35 replaced
                    expect(writer.getStorage().size).toBe(100); // All slots filled
                });

                it('should replace 50% and create 50% when half exists', async () => {
                    writer.seedStorage(createDocuments(50, 1));

                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Overwrite,
                    });

                    expect(result.totalProcessed).toBe(100);
                    expect(result.replacedCount).toBe(50);
                    expect(result.createdCount).toBe(50);
                    expect(writer.getStorage().size).toBe(100);
                });

                it('should handle alternating gaps and replacements', async () => {
                    // Custom pattern: doc5, doc15, doc25, doc35, doc45 exist (5 docs)
                    writer.seedStorage([
                        createDocuments(1, 5)[0],
                        createDocuments(1, 15)[0],
                        createDocuments(1, 25)[0],
                        createDocuments(1, 35)[0],
                        createDocuments(1, 45)[0],
                    ]);

                    const documents = createDocuments(50); // doc1-doc50
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Overwrite,
                    });

                    expect(result.totalProcessed).toBe(50);
                    expect(result.replacedCount).toBe(5);
                    expect(result.createdCount).toBe(45);
                    expect(writer.getStorage().size).toBe(50);
                });
            });

            describe('with throttling', () => {
                it('should recover from throttle (empty collection)', async () => {
                    writer.setErrorConfig({
                        errorType: 'throttle',
                        afterDocuments: 30,
                        partialProgress: 30,
                        writeBeforeThrottle: true,
                    });

                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Overwrite,
                    });

                    expect(result.totalProcessed).toBe(100);
                    expect(writer.getStorage().size).toBe(100);
                });

                it('should recover from throttle with 50% existing', async () => {
                    writer.seedStorage(createDocuments(50, 1));
                    writer.setErrorConfig({
                        errorType: 'throttle',
                        afterDocuments: 30,
                        partialProgress: 30,
                        writeBeforeThrottle: true,
                    });

                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Overwrite,
                    });

                    expect(result.totalProcessed).toBe(100);
                    expect(writer.getStorage().size).toBe(100);
                });

                it('should recover from throttle with sparse collection', async () => {
                    // Sparse: doc21-35 (15) and doc61-80 (20) exist = 35 total
                    // Throttle at doc15 (in first gap), then continue and replace/create
                    writer.seedStorage(createSparseCollection());
                    writer.setErrorConfig({
                        errorType: 'throttle',
                        afterDocuments: 15,
                        partialProgress: 15,
                        writeBeforeThrottle: true,
                    });

                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Overwrite,
                    });

                    expect(result.totalProcessed).toBe(100);
                    // All 100 docs should be in storage after completion
                    expect(writer.getStorage().size).toBe(100);
                    // Verify that operation completed with creates and replaces
                    expect(result.createdCount).toBeGreaterThan(0);
                    expect(result.replacedCount).toBeGreaterThan(0);
                });
            });

            describe('with network errors', () => {
                it('should recover from network error (empty collection)', async () => {
                    writer.setErrorConfig({
                        errorType: 'network',
                        afterDocuments: 30,
                        partialProgress: 0,
                    });

                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Overwrite,
                    });

                    expect(result.totalProcessed).toBe(100);
                    expect(writer.getStorage().size).toBe(100);
                });

                it('should recover from network error with 50% existing', async () => {
                    writer.seedStorage(createDocuments(50, 1));
                    writer.setErrorConfig({
                        errorType: 'network',
                        afterDocuments: 30,
                        partialProgress: 0,
                    });

                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Overwrite,
                    });

                    expect(result.totalProcessed).toBe(100);
                    expect(result.replacedCount).toBe(50);
                    expect(result.createdCount).toBe(50);
                });

                it('should recover from network error with sparse collection', async () => {
                    // Sparse: doc21-35 (15) and doc61-80 (20) exist = 35 total
                    // Network error at doc15 (in first gap), then continue and replace/create
                    writer.seedStorage(createSparseCollection());
                    writer.setErrorConfig({
                        errorType: 'network',
                        afterDocuments: 15,
                        partialProgress: 0,
                    });

                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Overwrite,
                    });

                    expect(result.totalProcessed).toBe(100);
                    expect(result.createdCount).toBe(SPARSE_INSERT_COUNT);
                    expect(result.replacedCount).toBe(SPARSE_EXISTING_COUNT);
                    expect(writer.getStorage().size).toBe(100);
                });
            });
        });

        // =====================================================================
        // 2.4 GENERATE NEW IDS STRATEGY
        // =====================================================================

        describe('GenerateNewIds Strategy', () => {
            describe('collection state scenarios', () => {
                it('should insert all with new IDs in empty collection', async () => {
                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.GenerateNewIds,
                    });

                    expect(result.totalProcessed).toBe(100);
                    expect(result.insertedCount).toBe(100);
                    expect(writer.getStorage().size).toBe(100);
                    expect(writer.getStorage().has('doc1')).toBe(false); // Original IDs not used
                });

                it('should insert all with new IDs when collection has existing docs', async () => {
                    writer.seedStorage(createDocuments(50, 1));

                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.GenerateNewIds,
                    });

                    expect(result.totalProcessed).toBe(100);
                    expect(result.insertedCount).toBe(100);
                    expect(writer.getStorage().size).toBe(150); // 50 existing + 100 new
                });
            });

            describe('with throttling', () => {
                it('should recover from throttle', async () => {
                    writer.setErrorConfig({
                        errorType: 'throttle',
                        afterDocuments: 30,
                        partialProgress: 30,
                        writeBeforeThrottle: true,
                    });

                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.GenerateNewIds,
                    });

                    expect(result.totalProcessed).toBe(100);
                    expect(result.insertedCount).toBe(100);
                });
            });

            describe('with network errors', () => {
                it('should recover from network error', async () => {
                    writer.setErrorConfig({
                        errorType: 'network',
                        afterDocuments: 30,
                        partialProgress: 0,
                    });

                    const documents = createDocuments(100);
                    const stream = createDocumentStream(documents);

                    const result = await writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.GenerateNewIds,
                    });

                    expect(result.totalProcessed).toBe(100);
                    expect(result.insertedCount).toBe(100);
                });
            });
        });
    });

    // =========================================================================
    // 3. ERROR HANDLING
    // =========================================================================

    describe('Error Handling', () => {
        // =====================================================================
        // 3.1 THROTTLE ERROR HANDLING
        // =====================================================================

        describe('Throttle Error Handling', () => {
            it('should switch to RU-limited mode on first throttle', async () => {
                expect(writer.getCurrentMode()).toBe('fast');

                writer.setErrorConfig({
                    errorType: 'throttle',
                    afterDocuments: 100,
                    partialProgress: 100,
                });

                const documents = createDocuments(200);
                const stream = createDocumentStream(documents);

                await writer.streamDocuments(stream, {
                    conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
                });

                expect(writer.getCurrentMode()).toBe('ru-limited');
            });

            it('should shrink batch size after throttle', async () => {
                const initialBatchSize = writer.getCurrentBatchSize();

                writer.setErrorConfig({
                    errorType: 'throttle',
                    afterDocuments: 100,
                    partialProgress: 100,
                });

                const documents = createDocuments(200);
                const stream = createDocumentStream(documents);

                await writer.streamDocuments(stream, {
                    conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
                });

                expect(writer.getCurrentBatchSize()).toBeLessThan(initialBatchSize);
            });

            it('should handle consecutive throttles without duplicating documents', async () => {
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

                expect(result.totalProcessed).toBe(200);
                expect(result.insertedCount).toBe(200);
                expect(writer.getStorage().size).toBe(200);
            });

            it('should report accurate stats after throttle with partial progress', async () => {
                writer.setErrorConfig({
                    errorType: 'throttle',
                    afterDocuments: 0,
                    partialProgress: 78,
                    writeBeforeThrottle: true,
                });

                const documents = createDocuments(500);
                const stream = createDocumentStream(documents);
                const progressUpdates: number[] = [];

                const result = await writer.streamDocuments(
                    stream,
                    { conflictResolutionStrategy: ConflictResolutionStrategy.Abort },
                    { onProgress: (count) => progressUpdates.push(count) },
                );

                expect(result.totalProcessed).toBe(500);
                expect(result.insertedCount).toBe(500);

                // First progress update should include the partial progress
                expect(progressUpdates[0]).toBe(78);
            });
        });

        // =====================================================================
        // 3.2 NETWORK ERROR HANDLING
        // =====================================================================

        describe('Network Error Handling', () => {
            it('should retry with exponential backoff on network error', async () => {
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

                expect(result.totalProcessed).toBe(100);
                expect(result.insertedCount).toBe(100);
            });

            it('should recover from network error mid-stream (large stream)', async () => {
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

                expect(result.totalProcessed).toBe(500);
                expect(result.insertedCount).toBe(500);
            });
        });

        // =====================================================================
        // 3.3 UNEXPECTED ERROR HANDLING
        // =====================================================================

        describe('Unexpected Error Handling', () => {
            it('should throw unexpected error immediately (no retry)', async () => {
                writer.setErrorConfig({
                    errorType: 'unexpected',
                    afterDocuments: 50,
                    partialProgress: 0,
                });

                const documents = createDocuments(100);
                const stream = createDocumentStream(documents);

                await expect(
                    writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
                    }),
                ).rejects.toThrow('MOCK_UNEXPECTED_ERROR');
            });

            it('should stop processing on unexpected error', async () => {
                writer.setErrorConfig({
                    errorType: 'unexpected',
                    afterDocuments: 100,
                    partialProgress: 0,
                });

                const documents = createDocuments(500);
                const stream = createDocumentStream(documents);

                await expect(
                    writer.streamDocuments(stream, {
                        conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
                    }),
                ).rejects.toThrow();

                expect(writer.getStorage().size).toBeLessThan(500);
            });
        });
    });

    // =========================================================================
    // 4. STREAMING WRITER ERROR
    // =========================================================================

    describe('StreamingWriterError', () => {
        it('should include partial statistics on collision', async () => {
            writer.seedStorage([createDocuments(1, 50)[0]]);

            const documents = createDocuments(100);
            const stream = createDocumentStream(documents);

            let caughtError: StreamingWriterError | undefined;

            try {
                await writer.streamDocuments(stream, {
                    conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
                });
            } catch (error) {
                caughtError = error as StreamingWriterError;
            }

            expect(caughtError).toBeInstanceOf(StreamingWriterError);
            expect(caughtError?.partialStats).toBeDefined();
            expect(caughtError?.partialStats.totalProcessed).toBeGreaterThan(0);
            expect(caughtError?.partialStats.insertedCount).toBeDefined();
        });

        it('should format getStatsString for Abort strategy', () => {
            const error = new StreamingWriterError('Test error', {
                totalProcessed: 100,
                insertedCount: 100,
                flushCount: 2,
            });

            const statsString = error.getStatsString();
            expect(statsString).toContain('100 total');
            expect(statsString).toContain('100 inserted');
        });

        it('should format getStatsString for Skip strategy', () => {
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

        it('should format getStatsString for Overwrite strategy', () => {
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

    // =========================================================================
    // 5. PROGRESS REPORTING
    // =========================================================================

    describe('Progress Reporting', () => {
        it('should report progress details for Skip strategy (with skips)', async () => {
            writer.seedStorage(createDocuments(50, 1));

            const documents = createDocuments(150);
            const stream = createDocumentStream(documents);
            const progressUpdates: Array<{ count: number; details?: string }> = [];

            await writer.streamDocuments(
                stream,
                { conflictResolutionStrategy: ConflictResolutionStrategy.Skip },
                { onProgress: (count, details) => progressUpdates.push({ count, details }) },
            );

            expect(progressUpdates.length).toBeGreaterThan(0);
            const lastUpdate = progressUpdates[progressUpdates.length - 1];
            expect(lastUpdate.details).toContain('inserted');
            expect(lastUpdate.details).toContain('skipped');
        });

        it('should report progress details for Overwrite strategy', async () => {
            writer.seedStorage(createDocuments(75, 1));

            const documents = createDocuments(150);
            const stream = createDocumentStream(documents);
            const progressUpdates: Array<{ count: number; details?: string }> = [];

            await writer.streamDocuments(
                stream,
                { conflictResolutionStrategy: ConflictResolutionStrategy.Overwrite },
                { onProgress: (count, details) => progressUpdates.push({ count, details }) },
            );

            expect(progressUpdates.length).toBeGreaterThan(0);
            const lastUpdate = progressUpdates[progressUpdates.length - 1];
            expect(lastUpdate.details).toContain('replaced');
            expect(lastUpdate.details).toContain('created');
        });

        it('should report progress details for GenerateNewIds strategy', async () => {
            const documents = createDocuments(120);
            const stream = createDocumentStream(documents);
            const progressUpdates: Array<{ count: number; details?: string }> = [];

            await writer.streamDocuments(
                stream,
                { conflictResolutionStrategy: ConflictResolutionStrategy.GenerateNewIds },
                { onProgress: (count, details) => progressUpdates.push({ count, details }) },
            );

            expect(progressUpdates.length).toBeGreaterThan(0);
            const lastUpdate = progressUpdates[progressUpdates.length - 1];
            expect(lastUpdate.details).toContain('inserted');
            expect(lastUpdate.details).not.toContain('skipped');
        });

        it('should aggregate statistics correctly across multiple flushes', async () => {
            writer.seedStorage(createDocuments(100, 1));

            const documents = createDocuments(300);
            const stream = createDocumentStream(documents);

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Skip,
            });

            expect(result.totalProcessed).toBe(300);
            expect(result.insertedCount).toBe(200);
            expect(result.skippedCount).toBe(100);
        });
    });

    // =========================================================================
    // 6. BUFFER MANAGEMENT
    // =========================================================================

    describe('Buffer Management', () => {
        it('should flush when document count limit reached', async () => {
            const bufferLimit = writer.getBufferConstraints().optimalDocumentCount;
            const documents = createDocuments(bufferLimit + 10);
            const stream = createDocumentStream(documents);

            let flushCount = 0;
            await writer.streamDocuments(
                stream,
                { conflictResolutionStrategy: ConflictResolutionStrategy.Abort },
                { onProgress: () => flushCount++ },
            );

            expect(flushCount).toBeGreaterThanOrEqual(2);
        });

        it('should flush when memory limit reached', async () => {
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
                { onProgress: () => flushCount++ },
            );

            expect(flushCount).toBeGreaterThan(1);
        });

        it('should flush remaining documents at end of stream', async () => {
            const documents = createDocuments(50);
            const stream = createDocumentStream(documents);

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
            });

            expect(result.totalProcessed).toBe(50);
            expect(result.flushCount).toBe(1);
            expect(writer.getStorage().size).toBe(50);
        });

        it('should handle various document sizes', async () => {
            const documents = [
                { id: 'small', documentContent: { value: 1 } },
                { id: 'medium', documentContent: { value: 'x'.repeat(1000) } },
                { id: 'large', documentContent: { value: 'x'.repeat(100000) } },
            ];

            const stream = createDocumentStream(documents);

            const result = await writer.streamDocuments(stream, {
                conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
            });

            expect(result.totalProcessed).toBe(3);
        });
    });

    // =========================================================================
    // 7. BATCH SIZE BEHAVIOR
    // =========================================================================

    describe('Batch Size Behavior', () => {
        it('should start with fast mode (batch size 500)', () => {
            expect(writer.getCurrentMode()).toBe('fast');
            expect(writer.getCurrentBatchSize()).toBe(500);
        });

        it('should respect minimum batch size of 1', async () => {
            writer.setErrorConfig({
                errorType: 'throttle',
                afterDocuments: 0,
                partialProgress: 0,
            });

            const documents = createDocuments(100);
            const stream = createDocumentStream(documents);

            try {
                await writer.streamDocuments(stream, {
                    conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
                });
            } catch {
                // Expected to fail after max retries
            }

            expect(writer.getCurrentBatchSize()).toBeGreaterThanOrEqual(1);
        });

        it('should switch to RU-limited mode after throttle', async () => {
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
            expect(writer.getCurrentBatchSize()).toBeLessThanOrEqual(1000);
        });

        it('should return correct buffer constraints', () => {
            const constraints = writer.getBufferConstraints();

            expect(constraints.optimalDocumentCount).toBe(writer.getCurrentBatchSize());
            expect(constraints.maxMemoryMB).toBe(24);
        });

        describe('batch size growth', () => {
            it('should grow batch size after successful writes in fast mode', async () => {
                // In fast mode, batch size should grow by 20% after each successful flush
                const initialBatchSize = writer.getCurrentBatchSize();
                expect(initialBatchSize).toBe(500);

                // Write enough documents to trigger multiple flushes
                const documents = createDocuments(2000);
                const stream = createDocumentStream(documents);

                await writer.streamDocuments(stream, {
                    conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
                });

                // Batch size should have grown after successful flushes
                const finalBatchSize = writer.getCurrentBatchSize();
                expect(finalBatchSize).toBeGreaterThan(initialBatchSize);
                expect(writer.getCurrentMode()).toBe('fast');
            });

            it('should grow batch size after throttle recovery in RU-limited mode', async () => {
                // First, trigger throttle to switch to RU-limited mode
                writer.setErrorConfig({
                    errorType: 'throttle',
                    afterDocuments: 50,
                    partialProgress: 50,
                    writeBeforeThrottle: true,
                });

                const documents1 = createDocuments(100);
                const stream1 = createDocumentStream(documents1);

                await writer.streamDocuments(stream1, {
                    conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
                });

                expect(writer.getCurrentMode()).toBe('ru-limited');
                const batchSizeAfterThrottle = writer.getCurrentBatchSize();

                // Now clear error config and write more documents
                writer.clearErrorConfig();
                writer.clearStorage();

                // Write enough documents to trigger multiple flushes and growth
                const documents2 = createDocuments(500);
                const stream2 = createDocumentStream(documents2);

                await writer.streamDocuments(stream2, {
                    conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
                });

                // Batch size should have grown after successful flushes
                const finalBatchSize = writer.getCurrentBatchSize();
                expect(finalBatchSize).toBeGreaterThan(batchSizeAfterThrottle);
                expect(writer.getCurrentMode()).toBe('ru-limited');
            });

            it('should grow by at least 1 when batch size is very low (rounding edge case)', async () => {
                // This test verifies that when batch size is very low (e.g., 1),
                // the growth algorithm ensures at least +1 increment, not rounding to 0.
                //
                // With 10% growth factor: 1 * 1.1 = 1.1, which would round to 1 (no growth!)
                // The algorithm uses Math.max(percentageIncrease, currentBatchSize + 1)
                // to ensure minimum growth of 1: 1 -> 2 -> 3 -> 4 -> etc.

                // Force batch size to 2 by triggering throttle with low partial progress
                // (can't easily get to exactly 1 because successful retry triggers grow())
                writer.setErrorConfig({
                    errorType: 'throttle',
                    afterDocuments: 2,
                    partialProgress: 2,
                    writeBeforeThrottle: true,
                });

                const documents1 = createDocuments(5);
                const stream1 = createDocumentStream(documents1);

                await writer.streamDocuments(stream1, {
                    conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
                });

                // After throttle with partial progress of 2, then successful retry with grow()
                // Batch size should be low but > 1
                const batchSizeAfterThrottle = writer.getCurrentBatchSize();
                expect(batchSizeAfterThrottle).toBeLessThan(10);
                expect(writer.getCurrentMode()).toBe('ru-limited');

                // Now clear error and write more documents
                writer.clearErrorConfig();
                writer.clearStorage();

                // Write documents to trigger multiple flushes with low batch size
                // Each successful flush should grow batch size
                const documents2 = createDocuments(20);
                const stream2 = createDocumentStream(documents2);

                await writer.streamDocuments(stream2, {
                    conflictResolutionStrategy: ConflictResolutionStrategy.Abort,
                });

                // Batch size should have grown significantly
                // Even with small starting size, linear +1 growth ensures progress
                const finalBatchSize = writer.getCurrentBatchSize();
                expect(finalBatchSize).toBeGreaterThan(batchSizeAfterThrottle);

                // Verify growth was meaningful (at least doubled from low starting point)
                expect(finalBatchSize).toBeGreaterThanOrEqual(batchSizeAfterThrottle * 2);
            });
        });
    });
});
