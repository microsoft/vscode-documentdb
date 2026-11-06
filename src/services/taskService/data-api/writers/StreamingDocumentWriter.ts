/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TaskLogger, type TaskTelemetryContext } from '../../taskHost';
import {
    type DataTransferStrings,
    defaultDataTransferStrings,
    noopDataTransferLogger,
} from '../dataTransferHost';
import {
    type AbortBatchResult,
    type BatchAttemptOutcome,
    ConflictResolutionStrategy,
    type DocumentDetails,
    type EnsureTargetExistsResult,
    type ErrorType,
    type GenerateNewIdsBatchResult,
    isBatchAttemptOutcome,
    isSkipResult,
    type OverwriteBatchResult,
    type PartialProgress,
    type PreFilterResult,
    type SkipBatchResult,
    type StrategyBatchResult,
    type StreamingWriterOptions,
    type StreamWriteResult,
} from '../types';
import { BatchSizeAdapter } from './BatchSizeAdapter';
import {
    computeRetryDelay,
    type ResolvedStreamingWriterSettings,
    resolveStreamingWriterSettings,
} from './streamingWriterSettings';
import { WriteStats } from './WriteStats';

/**
 * Configuration for streaming write operations.
 */
export interface StreamWriteConfig {
    /** Strategy for handling document conflicts (duplicate _id) */
    conflictResolutionStrategy: ConflictResolutionStrategy;
}

/**
 * Options for streaming write operations.
 */
export interface StreamWriteOptions {
    /**
     * Called with incremental count of documents processed after each flush.
     * The optional details parameter provides a formatted breakdown of statistics.
     */
    onProgress?: (processedCount: number, details?: string) => void;
    /** Signal to abort the streaming operation */
    abortSignal?: AbortSignal;
    /** Optional action context for telemetry collection */
    actionContext?: TaskTelemetryContext;
}

/**
 * Error thrown by StreamingDocumentWriter when an operation fails.
 *
 * Captures partial statistics about documents processed before the failure occurred.
 */
export class StreamingWriterError extends Error {
    /** Partial statistics captured before the error occurred */
    public readonly partialStats: StreamWriteResult;
    /** The original error that caused the failure */
    public readonly cause?: Error;

    constructor(message: string, partialStats: StreamWriteResult, cause?: Error) {
        super(message);
        this.name = 'StreamingWriterError';
        this.partialStats = partialStats;
        this.cause = cause;

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, StreamingWriterError);
        }
    }

    /**
     * Gets the partial statistics as a human-readable string.
     */
    getStatsString(): string {
        const parts: string[] = [];
        const { totalProcessed, insertedCount, skippedCount, replacedCount, createdCount, abortedCount } =
            this.partialStats;

        parts.push(`${totalProcessed} total`);

        const breakdown: string[] = [];
        if ((insertedCount ?? 0) > 0) breakdown.push(`${insertedCount ?? 0} inserted`);
        if ((skippedCount ?? 0) > 0) breakdown.push(`${skippedCount ?? 0} skipped`);
        if ((replacedCount ?? 0) > 0) breakdown.push(`${replacedCount ?? 0} replaced`);
        if ((createdCount ?? 0) > 0) breakdown.push(`${createdCount ?? 0} created`);
        if ((abortedCount ?? 0) > 0) breakdown.push(`${abortedCount ?? 0} aborted`);

        if (breakdown.length > 0) {
            parts.push(`(${breakdown.join(', ')})`);
        }

        return parts.join(' ');
    }
}

/**
 * Abstract base class for streaming document write operations.
 *
 * Provides integrated buffering, adaptive batching, retry logic, and progress reporting
 * for high-volume document write operations.
 *
 * Batching, memory estimation and retry backoff are configurable through StreamingWriterSettings.
 * Defaults start at 500 documents in fast mode, buffer up to 24 MB, and retry up to 10 times
 * without progress using 100 ms exponential backoff (×2, capped at 5 s, ±30% jitter).
 * Sequence diagrams and trace output below illustrate these defaults.
 *
 * ## Key Features
 *
 * 1. **Buffer Management**: Single-level buffering with adaptive flush triggers
 * 2. **Integrated Retry Logic**: Uses an inline retry loop in `writeBatchWithRetry` for transient failures
 * 3. **Adaptive Batching**: Uses BatchSizeAdapter for dual-mode (fast/RU-limited) operation
 * 4. **Statistics Aggregation**: Uses WriteStats for progress tracking
 * 5. **Immediate Progress Reporting**: Partial progress reported during throttle recovery
 *
 * ## Subclass Contract (3 Abstract Methods)
 *
 * Subclasses implement 3 methods:
 *
 * 1. `writeBatch(documents, strategy)`: Return a strategy result or a `BatchAttemptOutcome` with remaining documents
 * 2. `classifyError(error)`: Classify errors for retry decisions
 * 3. `extractPartialProgress(error)`: Extract progress and optional remaining documents from thrown throttle errors
 *
 * Plus `ensureTargetExists()` for collection setup.
 * Optionally override `getRetryAfterMs(error)` for server-suggested waits on thrown retryable errors.
 *
 * ## Sequence Diagrams
 *
 * ### Normal Flow (No Errors)
 *
 * ```
 * CopyPasteTask          StreamingWriter           flushBuffer          writeBatchWithRetry      writeBatch (subclass)
 *      │                       │                       │                       │                       │
 *      │ streamDocuments()     │                       │                       │                       │
 *      │──────────────────────>│                       │                       │                       │
 *      │                       │                       │                       │                       │
 *      │                       │ (buffer 500 docs)     │                       │                       │
 *      │                       │──────────────────────>│                       │                       │
 *      │                       │                       │ writeBatchWithRetry() │                       │
 *      │                       │                       │──────────────────────>│                       │
 *      │                       │                       │                       │ writeBatch()          │
 *      │                       │                       │                       │──────────────────────>│
 *      │                       │                       │                       │                       │
 *      │                       │                       │                       │<── StrategyBatchResult│
 *      │                       │                       │<── result             │                       │
 *      │                       │                       │                       │                       │
 *      │                       │                       │ stats.addBatch()      │                       │
 *      │                       │                       │ onProgress()          │                       │
 *      │<── onProgress(500)    │                       │                       │                       │
 *      │                       │                       │                       │                       │
 *      │                       │<── flush complete     │                       │                       │
 *      │<── StreamWriteResult  │                       │                       │                       │
 * ```
 *
 * ### Throttle Recovery with Partial Progress
 *
 * When the database throttles a request but has already written some documents,
 * partial progress is reported immediately, whether thrown or returned in a `BatchAttemptOutcome`.
 * Retry uses explicit `remaining` documents, or drops the written prefix when only a count is reported:
 *
 * ```
 * flushBuffer              writeBatchWithRetry              writeBatch           BatchSizeAdapter
 *      │                          │                             │                       │
 *      │ batch=[doc1..doc500]     │                             │                       │
 *      │─────────────────────────>│                             │                       │
 *      │                          │ writeBatch()                │                       │
 *      │                          │────────────────────────────>│                       │
 *      │                          │                             │                       │
 *      │                          │<── THROTTLE (9 written)     │                       │
 *      │                          │                             │                       │
 *      │                          │ handleThrottle(9)           │                       │
 *      │                          │────────────────────────────────────────────────────>│
 *      │                          │                             │   (switch to RU mode) │
 *      │                          │                             │                       │
 *      │<── onPartialProgress(9)  │                             │                       │
 *      │    (reports immediately) │                             │                       │
 *      │                          │                             │                       │
 *      │                          │ slice batch → [doc10..doc500]                       │
 *      │                          │                             │                       │
 *      │                          │ retryDelay()                │                       │
 *      │                          │ writeBatch([doc10..doc500]) │                       │
 *      │                          │────────────────────────────>│                       │
 *      │                          │                             │                       │
 *      │                          │<── THROTTLE (7 written)     │                       │
 *      │                          │                             │                       │
 *      │<── onPartialProgress(7)  │                             │                       │
 *      │                          │                             │                       │
 *      │                          │ (continues until all done)  │                       │
 *      │                          │                             │                       │
 *      │<── result (remaining)    │                             │                       │
 *      │                          │                             │                       │
 *      │ totalProcessed = 9+7+... │ (partial + final)           │                       │
 * ```
 *
 * ### Network Error with Retry
 *
 * Network errors trigger exponential backoff retries without slicing:
 *
 * ```
 * writeBatchWithRetry              writeBatch
 *      │                             │
 *      │ writeBatch()                │
 *      │────────────────────────────>│
 *      │                             │
 *      │<── NETWORK ERROR            │
 *      │                             │
 *      │ classifyError() → 'network' │
 *      │                             │
 *      │ attempt++                   │
 *      │ retryDelay(attempt)         │
 *      │ (backoff + jitter)          │
 *      │                             │
 *      │ writeBatch() (same batch)   │
 *      │────────────────────────────>│
 *      │                             │
 *      │<── SUCCESS                  │
 *      │                             │
 * ```
 *
 * ## Trace Output Example
 *
 * ```
 * [StreamingWriter] Starting document streaming with skip strategy
 * [StreamingWriter] Reading documents from source...
 * [StreamingWriter] Writing 500 documents to target (may take a moment)...
 * [BatchSizeAdapter] Switched from fast mode to ru-limited mode after throttle. Batch size: 500 → 9
 * [BatchSizeAdapter] Throttle: Adjusting batch size 9 → 9 (proven capacity: 9)
 * [StreamingWriter] Throttle: wrote 9 docs, 491 remaining in batch
 * [CopyPasteTask] onProgress: 0% (9/5546 docs) - Processed 9 of 5546 documents (0%) - 9 inserted
 * [BatchSizeAdapter] Throttle: Adjusting batch size 9 → 7 (proven capacity: 7)
 * [StreamingWriter] Throttle: wrote 7 docs, 484 remaining in batch
 * ...
 * [StreamingWriter] Buffer flush complete (500 total processed so far)
 * ```
 *
 * ## Usage Example
 *
 * ```typescript
 * class DocumentDbStreamingWriter extends StreamingDocumentWriter<string> {
 *   protected async writeBatch(documents, strategy) { ... }
 *   protected classifyError(error) { ... }
 *   protected extractPartialProgress(error) { ... }
 *   public async ensureTargetExists() { ... }
 * }
 *
 * const writer = new DocumentDbStreamingWriter(client, db, collection);
 * const result = await writer.streamDocuments(
 *   documentStream,
 *   { conflictResolutionStrategy: ConflictResolutionStrategy.Skip },
 *   { onProgress: (count, details) => console.log(`${count}: ${details}`) }
 * );
 * ```
 *
 * @template TDocumentId Type of document identifiers used by the database implementation
 */
export abstract class StreamingDocumentWriter<TDocumentId = unknown> {
    /**
     * Conflict strategies supported by this writer. Subclasses that cannot implement every
     * strategy override this property; consumers use it to offer only supported strategies.
     */
    public readonly supportedConflictStrategies: readonly ConflictResolutionStrategy[] = [
        ConflictResolutionStrategy.Abort,
        ConflictResolutionStrategy.Skip,
        ConflictResolutionStrategy.Overwrite,
        ConflictResolutionStrategy.GenerateNewIds,
    ];

    /** Batch size adapter for adaptive batching */
    protected readonly batchSizeAdapter: BatchSizeAdapter;

    /** Target database name */
    protected readonly databaseName: string;

    /** Target collection name */
    protected readonly collectionName: string;

    /** Buffer for accumulating documents before flush */
    private buffer: DocumentDetails[] = [];

    /** Estimated memory usage of buffer in bytes */
    private bufferMemoryEstimate: number = 0;

    private readonly logger: TaskLogger;
    private readonly strings: DataTransferStrings;
    private readonly settings: ResolvedStreamingWriterSettings;

    protected constructor(databaseName: string, collectionName: string, options?: StreamingWriterOptions) {
        this.databaseName = databaseName;
        this.collectionName = collectionName;
        this.logger = options?.logger ?? noopDataTransferLogger;
        this.strings = { ...defaultDataTransferStrings, ...options?.strings };
        this.settings = resolveStreamingWriterSettings(options?.adapterDefaults, options?.settings);
        this.batchSizeAdapter = new BatchSizeAdapter(this.settings.batching, {
            logger: this.logger,
            strings: this.strings,
        });
    }

    // =================================
    // PUBLIC API
    // =================================

    /**
     * Streams documents from an AsyncIterable source to the target database.
     *
     * @param documentStream Source of documents to stream
     * @param config Configuration including conflict resolution strategy
     * @param options Optional progress callback, abort signal, and telemetry context
     * @returns Statistics about the streaming operation
     * @throws StreamingWriterError if conflict resolution strategy is Abort or Overwrite and a write error occurs
     */
    public async streamDocuments(
        documentStream: AsyncIterable<DocumentDetails>,
        config: StreamWriteConfig,
        options?: StreamWriteOptions,
    ): Promise<StreamWriteResult> {
        // Reset state for this operation
        this.buffer = [];
        this.bufferMemoryEstimate = 0;
        const stats = new WriteStats({ logger: this.logger, strings: this.strings });
        const abortSignal = options?.abortSignal;

        this.logger.trace(
            `[StreamingWriter] Starting document streaming with ${config.conflictResolutionStrategy} strategy`,
        );

        this.logger.trace('[StreamingWriter] Reading documents from source...');

        // Stream documents and buffer them
        for await (const document of documentStream) {
            if (abortSignal?.aborted) {
                this.logger.trace('[StreamingWriter] Abort signal received during streaming');
                break;
            }

            this.buffer.push(document);
            this.bufferMemoryEstimate += this.estimateDocumentMemory(document);

            // Flush if buffer limits reached
            if (this.shouldFlush()) {
                await this.flushBuffer(config, stats, options);
            }
        }

        // Flush remaining documents
        if (this.buffer.length > 0 && !abortSignal?.aborted) {
            await this.flushBuffer(config, stats, options);
        }

        // Record telemetry
        if (options?.actionContext) {
            const finalStats = stats.getFinalStats();
            options.actionContext.telemetry.measurements.streamTotalProcessed = finalStats.totalProcessed;
            options.actionContext.telemetry.measurements.streamTotalInserted = finalStats.insertedCount ?? 0;
            options.actionContext.telemetry.measurements.streamTotalSkipped = finalStats.skippedCount ?? 0;
            options.actionContext.telemetry.measurements.streamTotalReplaced = finalStats.replacedCount ?? 0;
            options.actionContext.telemetry.measurements.streamTotalCreated = finalStats.createdCount ?? 0;
            options.actionContext.telemetry.measurements.streamFlushCount = finalStats.flushCount;
        }

        return stats.getFinalStats();
    }

    /**
     * Ensures the target collection exists, creating it if necessary.
     *
     * @returns Information about whether the target was created
     */
    public abstract ensureTargetExists(): Promise<EnsureTargetExistsResult>;

    // =================================
    // ABSTRACT METHODS (Subclass Contract)
    // =================================

    /**
     * Writes a batch of documents using the specified conflict resolution strategy.
     *
     * This is the primary abstract method that subclasses must implement. It handles
     * the supported conflict resolution strategies internally and returns strategy-specific
     * results using semantic names.
     *
     * EXPECTED RETURN TYPES BY STRATEGY:
     *
     * **Skip**: SkipBatchResult { insertedCount, skippedCount }
     * - Pre-filter conflicts for performance (optional optimization)
     * - Return combined results (pre-filtered + insert phase)
     *
     * **Overwrite**: OverwriteBatchResult { replacedCount, createdCount }
     * - Use replaceOne with upsert:true
     * - replacedCount = matched documents, createdCount = upserted documents
     *
     * **Abort**: AbortBatchResult { insertedCount, abortedCount }
     * - Return conflict details in errors array
     * - abortedCount = 1 if conflict occurred, 0 otherwise
     *
     * **GenerateNewIds**: GenerateNewIdsBatchResult { insertedCount }
     * - Store original _id in backup field
     *
     * For retry handling, throw throttle/network errors or return a BatchAttemptOutcome
     * containing the result, remaining documents and error type.
     * Return conflicts in errors array (don't throw them).
     *
     * @param documents Batch of documents to write
     * @param strategy Conflict resolution strategy to use
     * @param actionContext Optional context for telemetry
     * @returns Strategy-specific batch result, or an outcome with retry information
     * @throws For throttle/network errors that should be retried
     */
    protected abstract writeBatch(
        documents: DocumentDetails[],
        strategy: ConflictResolutionStrategy,
        actionContext?: TaskTelemetryContext,
    ): Promise<StrategyBatchResult<TDocumentId> | BatchAttemptOutcome<TDocumentId>>;

    /**
     * Classifies an error into a specific type for retry handling.
     *
     * CLASSIFICATION GUIDELINES:
     * - 'throttle': Rate limiting (HTTP 429, provider-specific codes)
     * - 'network': Connection issues (timeout, reset, unreachable)
     * - 'conflict': Duplicate key errors (code 11000 for MongoDB)
     * - 'validator': Schema validation errors
     * - 'other': All other errors (no retry)
     *
     * @param error Error object to classify
     * @param actionContext Optional context for telemetry
     * @returns Error type classification
     */
    protected abstract classifyError(error: unknown, actionContext?: TaskTelemetryContext): ErrorType;

    /**
     * Extracts partial progress from an error (for throttle recovery).
     *
     * When a throttle error is thrown, this method extracts how many
     * documents were successfully processed before the error. This allows
     * the retry logic to:
     * - Report accurate progress
     * - Adjust batch size based on proven capacity
     * - Continue from where it left off
     *
     * Return undefined if the error doesn't contain progress information.
     *
     * @param error Error object from database operation
     * @param actionContext Optional context for telemetry
     * @returns Partial progress if available, undefined otherwise
     */
    protected abstract extractPartialProgress(
        error: unknown,
        actionContext?: TaskTelemetryContext,
    ): PartialProgress | undefined;

    /**
     * Gets the server-suggested retry wait in milliseconds from a thrown throttle or network error.
     * Defaults to undefined, preserving the computed backoff when no suggestion is available.
     */
    protected getRetryAfterMs(_error: unknown): number | undefined {
        return undefined;
    }

    /**
     * Pre-filters documents for Skip strategy by querying the target for existing IDs.
     *
     * This is called ONCE per batch BEFORE the retry loop to:
     * 1. Query the target collection for existing document IDs
     * 2. Identify conflicts upfront (documents that already exist)
     * 3. Return filtered batch and skipped result
     *
     * Benefits:
     * - Skipped documents are reported only once (no duplicate logging on retries)
     * - Batch slicing during throttle recovery is accurate
     * - Reduced payload size for insert operations
     *
     * Default implementation returns undefined (no pre-filtering).
     * Subclasses should override for Skip strategy optimization.
     *
     * @param documents Batch of documents to pre-filter
     * @param actionContext Optional context for telemetry
     * @returns Pre-filter result with filtered batch and skipped info, or undefined to skip pre-filtering
     */
    protected preFilterForSkipStrategy(
        _documents: DocumentDetails[],
        _actionContext?: TaskTelemetryContext,
    ): Promise<PreFilterResult<TDocumentId> | undefined> {
        return Promise.resolve(undefined);
    }

    // =================================
    // BUFFER MANAGEMENT
    // =================================

    /**
     * Determines if the buffer should be flushed.
     */
    private shouldFlush(): boolean {
        const constraints = this.batchSizeAdapter.getBufferConstraints();

        // Flush if document count limit reached
        if (this.buffer.length >= constraints.optimalDocumentCount) {
            return true;
        }

        // Flush if memory limit reached
        const memoryLimitBytes = constraints.maxMemoryMB * 1024 * 1024;
        if (this.bufferMemoryEstimate >= memoryLimitBytes) {
            return true;
        }

        return false;
    }

    /**
     * Estimates document memory usage in bytes.
     */
    private estimateDocumentMemory(document: DocumentDetails): number {
        return this.settings.estimateDocumentSize(document);
    }

    // =================================
    // FLUSH AND WRITE LOGIC
    // =================================

    /**
     * Flushes the buffer by writing documents with retry logic.
     */
    private async flushBuffer(
        config: StreamWriteConfig,
        stats: WriteStats,
        options?: StreamWriteOptions,
    ): Promise<void> {
        if (this.buffer.length === 0) {
            return;
        }

        this.logger.trace(
            `[StreamingWriter] Writing ${this.buffer.length} documents to target (may take a moment)...`,
        );

        let pendingDocs = [...this.buffer];
        const allErrors: Array<{ documentId?: TDocumentId; error: Error }> = [];

        // Process buffer in batches with retry
        while (pendingDocs.length > 0) {
            if (options?.abortSignal?.aborted) {
                break;
            }

            const batchSize = Math.min(pendingDocs.length, this.batchSizeAdapter.getCurrentBatchSize());
            const batch = pendingDocs.slice(0, batchSize);

            // Track partial progress count for this batch (used for slicing pendingDocs)
            let partialProgressCount = 0;

            // Create callback for reporting partial progress during retries
            const onPartialProgress = (partialResult: StrategyBatchResult<TDocumentId>): void => {
                partialProgressCount += partialResult.processedCount;

                // Add partial progress to stats immediately
                stats.addBatch(partialResult);

                // Report progress to caller
                if (options?.onProgress && partialResult.processedCount > 0) {
                    const details = stats.formatProgress(config.conflictResolutionStrategy);
                    options.onProgress(partialResult.processedCount, details);
                }
            };

            try {
                const result = await this.writeBatchWithRetry(
                    batch,
                    config.conflictResolutionStrategy,
                    options?.abortSignal,
                    options?.actionContext,
                    onPartialProgress,
                );

                // Null means cancelled - break out of loop
                if (result === null) {
                    break;
                }

                // Result already uses semantic names - add directly to stats
                stats.addBatch(result);

                // Report progress
                if (options?.onProgress && result.processedCount > 0) {
                    const details = stats.formatProgress(config.conflictResolutionStrategy);
                    options.onProgress(result.processedCount, details);
                }

                // Collect errors
                if (result.errors?.length) {
                    allErrors.push(...result.errors);

                    // For Abort strategy, stop on first error
                    if (config.conflictResolutionStrategy === ConflictResolutionStrategy.Abort) {
                        this.handleFatalError(allErrors, config.conflictResolutionStrategy, stats);
                        return;
                    }
                }

                // Grow batch size on success (only if no skipped/aborted docs)
                const hasConflicts = isSkipResult(result)
                    ? result.skippedCount > 0
                    : result.errors && result.errors.length > 0;
                if (!hasConflicts) {
                    this.batchSizeAdapter.grow();
                }

                // Move to next batch - account for both partial progress and final result
                const totalProcessedInBatch = partialProgressCount + result.processedCount;
                pendingDocs = pendingDocs.slice(totalProcessedInBatch);
            } catch (error) {
                // Handle fatal errors
                this.handleWriteError(error, allErrors, config.conflictResolutionStrategy, stats);
            }
        }

        // Record flush
        stats.recordFlush();

        this.logger.trace(
            `[StreamingWriter] Buffer flush complete (${stats.getTotalProcessed()} total processed so far)`,
        );

        // Clear buffer
        this.buffer = [];
        this.bufferMemoryEstimate = 0;
    }

    /**
     * Writes a batch with retry logic for transient failures.
     *
     * For Skip strategy, pre-filters conflicts ONCE before the retry loop to:
     * - Report skipped documents immediately (no duplicate logging on retries)
     * - Ensure accurate batch slicing during throttle recovery
     * - Reduce payload size for insert operations
     *
     * When a throttle error occurs with partial progress (some documents were
     * successfully inserted before the rate limit was hit), we accumulate the
     * partial progress and retry the remaining documents. Progress may be thrown
     * or returned; explicit remaining documents override the default prefix slicing.
     *
     * The onPartialProgress callback is called immediately when partial progress
     * is detected during throttle recovery, allowing real-time progress reporting.
     *
     * Returns a strategy-specific result with remaining counts (excluding already-reported partial progress),
     * or null if the operation was cancelled.
     */
    private async writeBatchWithRetry(
        batch: DocumentDetails[],
        strategy: ConflictResolutionStrategy,
        abortSignal: AbortSignal | undefined,
        actionContext: TaskTelemetryContext | undefined,
        onPartialProgress: (partialResult: StrategyBatchResult<TDocumentId>) => void,
    ): Promise<StrategyBatchResult<TDocumentId> | null> {
        let currentBatch = batch;
        let attempt = 0;
        const maxAttempts = this.settings.retry.maxAttemptsWithoutProgress;

        // For Skip strategy: pre-filter conflicts ONCE before retry loop
        if (strategy === ConflictResolutionStrategy.Skip) {
            const preFilterResult = await this.preFilterForSkipStrategy(batch, actionContext);
            if (preFilterResult) {
                // Report skipped documents immediately
                if (preFilterResult.skippedResult.skippedCount > 0) {
                    onPartialProgress(preFilterResult.skippedResult);
                }

                // Continue with only the documents that need to be inserted
                currentBatch = preFilterResult.documentsToInsert;

                // If all documents were skipped, return empty result
                if (currentBatch.length === 0) {
                    return this.progressToResult({ processedCount: 0 }, strategy);
                }
            }
        }

        while (attempt < maxAttempts && currentBatch.length > 0) {
            if (abortSignal?.aborted) {
                // Return null on cancellation - caller will handle gracefully
                return null;
            }

            let outcome: BatchAttemptOutcome<TDocumentId>;
            try {
                const result = await this.writeBatch(currentBatch, strategy, actionContext);
                outcome = isBatchAttemptOutcome(result) ? result : { result };
            } catch (error) {
                const errorType = this.classifyError(error, actionContext);
                if (errorType !== 'throttle' && errorType !== 'network') {
                    throw error;
                }

                const progress =
                    errorType === 'throttle' ? this.extractPartialProgress(error, actionContext) : undefined;
                outcome = {
                    result: this.progressToResult(progress ?? { processedCount: 0 }, strategy),
                    remaining: progress?.remaining ?? currentBatch.slice(progress?.processedCount ?? 0),
                    errorType,
                    retryAfterMs: this.getRetryAfterMs(error),
                };
            }

            if (strategy === ConflictResolutionStrategy.Abort && outcome.result.errors?.length) {
                return outcome.result;
            }

            if (!outcome.errorType && !outcome.remaining?.length) {
                // Success - partial progress already reported via callback
                return outcome.result;
            }

            const written = outcome.result.processedCount;
            if (outcome.errorType === 'throttle') {
                this.batchSizeAdapter.handleThrottle(written);
            }

            if (written > 0) {
                const remainingCount = outcome.remaining?.length ?? 0;
                this.logger.debug(
                    `[StreamingWriter] Throttle: wrote ${written} docs, ${remainingCount} remaining in batch`,
                );

                onPartialProgress(outcome.result);
                attempt = 0;
            } else {
                attempt++;
            }

            currentBatch = outcome.remaining ?? currentBatch.slice(outcome.result.processedCount);
            if (currentBatch.length === 0) {
                break;
            }

            await this.retryDelay(attempt, abortSignal, outcome.retryAfterMs);
        }

        if (currentBatch.length > 0) {
            throw new Error(this.strings.failedAfterAttempts(maxAttempts.toString()));
        }

        // All documents processed via partial progress - return empty result
        // (all progress was already reported via callback)
        return this.progressToResult({ processedCount: 0 }, strategy);
    }

    /**
     * Converts partial progress to a strategy-specific result.
     * Used for reporting partial progress during throttle recovery.
     */
    private progressToResult(
        progress: PartialProgress,
        strategy: ConflictResolutionStrategy,
    ): StrategyBatchResult<TDocumentId> {
        switch (strategy) {
            case ConflictResolutionStrategy.Skip:
                return {
                    processedCount: progress.processedCount,
                    insertedCount: progress.insertedCount ?? 0,
                    skippedCount: progress.skippedCount ?? 0,
                } satisfies SkipBatchResult<TDocumentId>;

            case ConflictResolutionStrategy.Abort:
                return {
                    processedCount: progress.processedCount,
                    insertedCount: progress.insertedCount ?? 0,
                    abortedCount: 0, // No abort if we got here via partial progress
                } satisfies AbortBatchResult<TDocumentId>;

            case ConflictResolutionStrategy.Overwrite:
                return {
                    processedCount: progress.processedCount,
                    replacedCount: progress.replacedCount ?? 0,
                    createdCount: progress.createdCount ?? 0,
                } satisfies OverwriteBatchResult<TDocumentId>;

            case ConflictResolutionStrategy.GenerateNewIds:
                return {
                    processedCount: progress.processedCount,
                    insertedCount: progress.insertedCount ?? 0,
                } satisfies GenerateNewIdsBatchResult<TDocumentId>;
        }
    }

    /**
     * Delays before retry with exponential backoff and jitter.
     *
     * Uses configurable jitter (±30% by default) to prevent thundering herd when multiple clients
     * are retrying simultaneously against the same server. A valid server suggestion is an
     * uncapped floor on this delay; cancellation interrupts the wait.
     */
    private async retryDelay(attempt: number, abortSignal?: AbortSignal, retryAfterMs?: number): Promise<void> {
        const backoff = computeRetryDelay(attempt, this.settings.retry);
        const serverDelay =
            retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs >= 0 ? retryAfterMs : 0;
        const delay = Math.max(backoff, serverDelay);
        if (serverDelay > backoff) {
            this.logger.trace(
                `[StreamingWriter] Waiting ${serverDelay} ms as suggested by the server (computed backoff ${backoff} ms)`,
            );
        }

        if (abortSignal?.aborted) {
            // The abort event has already fired; do not wait (a server-suggested wait has no cap).
            return;
        }

        await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, delay);
            if (abortSignal) {
                abortSignal.addEventListener(
                    'abort',
                    () => {
                        clearTimeout(timeout);
                        // Resolve gracefully instead of rejecting - caller handles abort
                        resolve();
                    },
                    { once: true },
                );
            }
        });
    }

    // =================================
    // ERROR HANDLING
    // =================================

    /**
     * Handles fatal write errors (Abort, Overwrite strategies).
     */
    private handleFatalError(
        errors: Array<{ documentId?: TDocumentId; error: Error }>,
        strategy: ConflictResolutionStrategy,
        stats: WriteStats,
    ): never {
        const firstError = errors[0];
        const currentStats = stats.getFinalStats();

        this.logger.error(
            `[StreamingWriter] Fatal error (${strategy}): ${firstError?.error?.message ?? 'Unknown error'}`,
        );

        const statsError = new StreamingWriterError(
            this.strings.writeOperationFailed(firstError?.error?.message ?? this.strings.unknownError),
            currentStats,
            firstError?.error,
        );

        this.logger.error(`[StreamingWriter] Partial progress: ${statsError.getStatsString()}`);

        throw statsError;
    }

    /**
     * Handles write errors based on strategy.
     */
    private handleWriteError(
        error: unknown,
        allErrors: Array<{ documentId?: TDocumentId; error: Error }>,
        strategy: ConflictResolutionStrategy,
        stats: WriteStats,
    ): void {
        const errorType = this.classifyError(error);

        // For conflict errors in Abort/Overwrite, throw fatal error
        if (errorType === 'conflict' || errorType === 'other') {
            if (strategy === ConflictResolutionStrategy.Abort || strategy === ConflictResolutionStrategy.Overwrite) {
                const errorObj = error instanceof Error ? error : new Error(String(error));
                allErrors.push({ error: errorObj });
                this.handleFatalError(allErrors, strategy, stats);
            }
        }

        // Re-throw unexpected errors
        throw error;
    }
}
