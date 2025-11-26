/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../../../extensionVariables';
import {
    ConflictResolutionStrategy,
    type DocumentDetails,
    type EnsureTargetExistsResult,
    type StreamWriteResult,
} from '../types';
import { type BatchWriteResult, type ErrorType, type PartialProgress, toStrategyResult } from '../writerTypes';
import { BatchSizeAdapter } from './BatchSizeAdapter';
import { RetryOrchestrator } from './RetryOrchestrator';
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
    actionContext?: IActionContext;
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
 * Unified abstract base class for streaming document write operations.
 *
 * This class combines the responsibilities previously split between StreamDocumentWriter
 * and BaseDocumentWriter into a single, cohesive component. It provides:
 *
 * ## Key Features
 *
 * 1. **Unified Buffer Management**: Single-level buffering with adaptive flush triggers
 * 2. **Integrated Retry Logic**: Uses RetryOrchestrator for transient failure handling
 * 3. **Adaptive Batching**: Uses BatchSizeAdapter for dual-mode (fast/RU-limited) operation
 * 4. **Statistics Aggregation**: Uses WriteStats for progress tracking
 * 5. **Two-Layer Progress Flow**: Simplified from the previous four-layer approach
 *
 * ## Subclass Contract (3 Abstract Methods)
 *
 * Subclasses only need to implement 3 methods (reduced from 7):
 *
 * 1. `writeBatch(documents, strategy)`: Write a batch with the specified strategy
 * 2. `classifyError(error)`: Classify errors for retry decisions
 * 3. `extractPartialProgress(error)`: Extract progress from throttle/network errors
 *
 * Plus `ensureTargetExists()` for collection setup.
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
    /** Batch size adapter for adaptive batching */
    protected readonly batchSizeAdapter: BatchSizeAdapter;

    /** Retry orchestrator for transient failure handling */
    protected readonly retryOrchestrator: RetryOrchestrator;

    /** Target database name */
    protected readonly databaseName: string;

    /** Target collection name */
    protected readonly collectionName: string;

    /** Buffer for accumulating documents before flush */
    private buffer: DocumentDetails[] = [];

    /** Estimated memory usage of buffer in bytes */
    private bufferMemoryEstimate: number = 0;

    protected constructor(databaseName: string, collectionName: string) {
        this.databaseName = databaseName;
        this.collectionName = collectionName;
        this.batchSizeAdapter = new BatchSizeAdapter();
        this.retryOrchestrator = new RetryOrchestrator();
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
        const stats = new WriteStats();
        const abortSignal = options?.abortSignal;

        ext.outputChannel.trace(
            vscode.l10n.t(
                '[StreamingWriter] Starting document streaming with {0} strategy',
                config.conflictResolutionStrategy,
            ),
        );

        // Stream documents and buffer them
        for await (const document of documentStream) {
            if (abortSignal?.aborted) {
                ext.outputChannel.trace(vscode.l10n.t('[StreamingWriter] Abort signal received during streaming'));
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
     * all four conflict resolution strategies internally.
     *
     * EXPECTED BEHAVIOR BY STRATEGY:
     *
     * **Skip**: Insert documents, skip conflicts (return in errors array)
     * - Pre-filter conflicts for performance (optional optimization)
     * - Return skipped documents in errors array with descriptive messages
     *
     * **Overwrite**: Replace existing documents, insert new ones (upsert)
     * - Use replaceOne with upsert:true
     * - Return matchedCount, modifiedCount, upsertedCount
     *
     * **Abort**: Insert documents, stop on first conflict
     * - Return conflict details in errors array
     * - Set processedCount to include documents processed before error
     *
     * **GenerateNewIds**: Remove _id, insert with database-generated IDs
     * - Store original _id in backup field
     * - Return insertedCount
     *
     * IMPORTANT: Throw throttle/network errors for retry handling.
     * Return conflicts in errors array (don't throw them).
     *
     * @param documents Batch of documents to write
     * @param strategy Conflict resolution strategy to use
     * @param actionContext Optional context for telemetry
     * @returns Batch write result with counts and any errors
     * @throws For throttle/network errors that should be retried
     */
    protected abstract writeBatch(
        documents: DocumentDetails[],
        strategy: ConflictResolutionStrategy,
        actionContext?: IActionContext,
    ): Promise<BatchWriteResult<TDocumentId>>;

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
    protected abstract classifyError(error: unknown, actionContext?: IActionContext): ErrorType;

    /**
     * Extracts partial progress from an error (for throttle recovery).
     *
     * When a throttle or network error occurs, this method extracts how many
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
        actionContext?: IActionContext,
    ): PartialProgress | undefined;

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
            ext.outputChannel.trace(
                vscode.l10n.t(
                    '[StreamingWriter] Flushing buffer: Document count limit ({0}/{1} documents)',
                    this.buffer.length.toString(),
                    constraints.optimalDocumentCount.toString(),
                ),
            );
            return true;
        }

        // Flush if memory limit reached
        const memoryLimitBytes = constraints.maxMemoryMB * 1024 * 1024;
        if (this.bufferMemoryEstimate >= memoryLimitBytes) {
            ext.outputChannel.trace(
                vscode.l10n.t(
                    '[StreamingWriter] Flushing buffer: Memory limit ({0} MB/{1} MB)',
                    (this.bufferMemoryEstimate / (1024 * 1024)).toFixed(2),
                    constraints.maxMemoryMB.toString(),
                ),
            );
            return true;
        }

        return false;
    }

    /**
     * Estimates document memory usage in bytes.
     */
    private estimateDocumentMemory(document: DocumentDetails): number {
        try {
            const jsonString = JSON.stringify(document.documentContent);
            return jsonString.length * 2; // UTF-16 encoding
        } catch {
            return 1024; // 1KB fallback
        }
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

        ext.outputChannel.trace(
            vscode.l10n.t('[StreamingWriter] Flushing {0} documents', this.buffer.length.toString()),
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

            try {
                const result = await this.writeBatchWithRetry(
                    batch,
                    config.conflictResolutionStrategy,
                    options?.abortSignal,
                    options?.actionContext,
                );

                // Convert raw result to strategy-specific format for stats
                const strategyResult = toStrategyResult(result, config.conflictResolutionStrategy);

                // Update statistics
                stats.addBatch(strategyResult);

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

                // Grow batch size on success (only if no conflicts)
                if ((result.collidedCount ?? 0) === 0 && (result.errors?.length ?? 0) === 0) {
                    this.batchSizeAdapter.grow();
                }

                // Move to next batch
                pendingDocs = pendingDocs.slice(result.processedCount);
            } catch (error) {
                // Handle fatal errors
                this.handleWriteError(error, allErrors, config.conflictResolutionStrategy, stats);
            }
        }

        // Record flush
        stats.recordFlush();

        // Clear buffer
        this.buffer = [];
        this.bufferMemoryEstimate = 0;

        // Handle non-fatal errors (Skip strategy logs them)
        if (allErrors.length > 0 && config.conflictResolutionStrategy === ConflictResolutionStrategy.Skip) {
            this.logSkippedDocuments(allErrors);
        }
    }

    /**
     * Writes a batch with retry logic for transient failures.
     *
     * When a throttle error occurs with partial progress (some documents were
     * successfully inserted before the rate limit was hit), we slice the batch
     * to skip the already-processed documents before retrying.
     */
    private async writeBatchWithRetry(
        batch: DocumentDetails[],
        strategy: ConflictResolutionStrategy,
        abortSignal?: AbortSignal,
        actionContext?: IActionContext,
    ): Promise<BatchWriteResult<TDocumentId>> {
        let currentBatch = batch;
        let totalResult: BatchWriteResult<TDocumentId> = {
            processedCount: 0,
            insertedCount: 0,
        };
        let attempt = 0;
        const maxAttempts = 10; // Same as RetryOrchestrator default

        while (attempt < maxAttempts && currentBatch.length > 0) {
            if (abortSignal?.aborted) {
                throw new Error(vscode.l10n.t('Operation was cancelled'));
            }

            try {
                const result = await this.writeBatch(currentBatch, strategy, actionContext);
                // Success - merge results and return
                return this.mergeResults(totalResult, result);
            } catch (error) {
                const errorType = this.classifyError(error, actionContext);

                if (errorType === 'throttle') {
                    const progress = this.extractPartialProgress(error, actionContext);
                    const successfulCount = progress?.processedCount ?? 0;

                    this.batchSizeAdapter.handleThrottle(successfulCount);

                    if (successfulCount > 0) {
                        // Slice the batch to skip already-processed documents
                        ext.outputChannel.debug(
                            vscode.l10n.t(
                                '[StreamingWriter] Throttle with partial progress: {0}/{1} processed, slicing batch',
                                successfulCount.toString(),
                                currentBatch.length.toString(),
                            ),
                        );
                        // Accumulate partial results - convert from semantic names back to raw format
                        // for internal merging (will be converted back when passed to stats)
                        totalResult = this.mergeResults(totalResult, {
                            processedCount: successfulCount,
                            insertedCount: progress?.insertedCount,
                            collidedCount: progress?.skippedCount,
                            matchedCount: progress?.replacedCount,
                            upsertedCount: progress?.createdCount,
                        });
                        // Slice the batch to only contain remaining documents
                        currentBatch = currentBatch.slice(successfulCount);
                        attempt = 0; // Reset attempts when progress is made
                    } else {
                        attempt++;
                    }

                    // Delay before retry
                    await this.retryDelay(attempt, abortSignal);
                    continue;
                }

                if (errorType === 'network') {
                    // Network errors don't have partial progress - retry full batch
                    attempt++;
                    await this.retryDelay(attempt, abortSignal);
                    continue;
                }

                // For 'conflict', 'validator', and 'other' - don't retry
                throw error;
            }
        }

        if (currentBatch.length > 0) {
            throw new Error(vscode.l10n.t('Failed to complete operation after {0} attempts', maxAttempts.toString()));
        }

        return totalResult;
    }

    /**
     * Merges partial results into the total result.
     */
    private mergeResults(
        total: BatchWriteResult<TDocumentId>,
        partial: BatchWriteResult<TDocumentId>,
    ): BatchWriteResult<TDocumentId> {
        return {
            processedCount: (total.processedCount ?? 0) + (partial.processedCount ?? 0),
            insertedCount: (total.insertedCount ?? 0) + (partial.insertedCount ?? 0),
            matchedCount:
                total.matchedCount !== undefined || partial.matchedCount !== undefined
                    ? (total.matchedCount ?? 0) + (partial.matchedCount ?? 0)
                    : undefined,
            modifiedCount:
                total.modifiedCount !== undefined || partial.modifiedCount !== undefined
                    ? (total.modifiedCount ?? 0) + (partial.modifiedCount ?? 0)
                    : undefined,
            upsertedCount:
                total.upsertedCount !== undefined || partial.upsertedCount !== undefined
                    ? (total.upsertedCount ?? 0) + (partial.upsertedCount ?? 0)
                    : undefined,
            collidedCount:
                total.collidedCount !== undefined || partial.collidedCount !== undefined
                    ? (total.collidedCount ?? 0) + (partial.collidedCount ?? 0)
                    : undefined,
            errors: total.errors || partial.errors ? [...(total.errors ?? []), ...(partial.errors ?? [])] : undefined,
        };
    }

    /**
     * Delays before retry with exponential backoff and jitter.
     *
     * Uses ±30% jitter to prevent thundering herd when multiple clients
     * are retrying simultaneously against the same server.
     */
    private async retryDelay(attempt: number, abortSignal?: AbortSignal): Promise<void> {
        const baseDelay = 100; // ms
        const maxDelay = 5000; // ms
        const jitterRange = 0.3; // ±30% jitter

        // Calculate base exponential delay
        const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

        // Apply jitter: multiply by random factor in range [1-jitter, 1+jitter]
        const jitterFactor = 1 + (Math.random() * 2 - 1) * jitterRange;
        const delay = Math.round(exponentialDelay * jitterFactor);

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

        ext.outputChannel.error(
            vscode.l10n.t(
                '[StreamingWriter] Fatal error ({0}): {1}',
                strategy,
                firstError?.error?.message ?? 'Unknown error',
            ),
        );

        const statsError = new StreamingWriterError(
            vscode.l10n.t('Write operation failed: {0}', firstError?.error?.message ?? 'Unknown error'),
            currentStats,
            firstError?.error,
        );

        ext.outputChannel.error(vscode.l10n.t('[StreamingWriter] Partial progress: {0}', statsError.getStatsString()));
        ext.outputChannel.show();

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

    /**
     * Logs skipped documents (Skip strategy).
     */
    private logSkippedDocuments(errors: Array<{ documentId?: TDocumentId; error: Error }>): void {
        for (const error of errors) {
            ext.outputChannel.appendLog(
                vscode.l10n.t(
                    '[StreamingWriter] Skipped document with _id: {0} - {1}',
                    error.documentId !== undefined && error.documentId !== null
                        ? typeof error.documentId === 'string'
                            ? error.documentId
                            : JSON.stringify(error.documentId)
                        : 'unknown',
                    error.error?.message ?? 'Unknown error',
                ),
            );
        }
    }
}
