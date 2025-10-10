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
    type DocumentWriter,
    type StreamWriterConfig,
    type StreamWriteResult,
} from '../types';

/**
 * Error thrown by StreamDocumentWriter when an operation fails.
 *
 * This specialized error class captures partial statistics about documents
 * processed before the failure occurred, which is useful for:
 * - Showing users how much progress was made
 * - Telemetry and analytics
 * - Debugging partial failures
 *
 * Used by Abort and Overwrite strategies which treat errors as fatal.
 * Skip and GenerateNewIds strategies log errors but continue processing.
 */
export class StreamWriterError extends Error {
    /**
     * Partial statistics captured before the error occurred.
     * Useful for telemetry and showing users how much progress was made before failure.
     */
    public readonly partialStats: StreamWriteResult;

    /**
     * The original error that caused the failure.
     */
    public readonly cause?: Error;

    /**
     * Creates a StreamWriterError with a message, partial statistics, and optional cause.
     *
     * @param message Error message describing what went wrong
     * @param partialStats Statistics captured before the error occurred
     * @param cause Original error that caused the failure (optional)
     */
    constructor(message: string, partialStats: StreamWriteResult, cause?: Error) {
        super(message);
        this.name = 'StreamWriterError';
        this.partialStats = partialStats;
        this.cause = cause;

        // Maintain proper stack trace for where our error was thrown (only available on V8)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, StreamWriterError);
        }
    }

    /**
     * Gets the partial statistics as a human-readable string.
     * Useful for error messages and logging.
     *
     * @returns Formatted string like "499 total (499 inserted)" or "350 total (200 matched, 150 upserted)"
     */
    public getStatsString(): string {
        const parts: string[] = [];
        const { totalProcessed, insertedCount, skippedCount, matchedCount, upsertedCount } = this.partialStats;

        // Always show total
        parts.push(`${totalProcessed} total`);

        // Show breakdown in parentheses
        const breakdown: string[] = [];
        if ((insertedCount ?? 0) > 0) {
            breakdown.push(`${insertedCount ?? 0} inserted`);
        }
        if ((skippedCount ?? 0) > 0) {
            breakdown.push(`${skippedCount ?? 0} skipped`);
        }
        if ((matchedCount ?? 0) > 0) {
            breakdown.push(`${matchedCount ?? 0} matched`);
        }
        if ((upsertedCount ?? 0) > 0) {
            breakdown.push(`${upsertedCount ?? 0} upserted`);
        }

        if (breakdown.length > 0) {
            parts.push(`(${breakdown.join(', ')})`);
        }

        return parts.join(' ');
    }
}

/**
 * Utility class for streaming documents from a source to a target using a DocumentWriter.
 *
 * This class provides automatic buffer management for streaming document operations,
 * making it easy to stream large datasets without running out of memory. It's designed
 * to be reusable across different streaming scenarios:
 * - Collection copy/paste operations
 * - JSON file imports
 * - CSV file imports
 * - Test data generation
 *
 * ## Key Responsibilities
 *
 * 1. **Buffer Management**: Maintains an in-memory buffer with dual limits
 *    - Document count limit (from writer.getBufferConstraints().optimalDocumentCount)
 *    - Memory size limit (from writer.getBufferConstraints().maxMemoryMB)
 *
 * 2. **Automatic Flushing**: Triggers buffer flush when either limit is reached
 *
 * 3. **Progress Tracking**: Reports incremental progress with strategy-specific details
 *    - Abort/GenerateNewIds: Shows inserted count
 *    - Skip: Shows inserted + skipped counts
 *    - Overwrite: Shows matched + upserted counts
 *
 * 4. **Error Handling**: Handles errors based on conflict resolution strategy
 *    - Abort: Throws StreamWriterError with partial stats (stops processing)
 *    - Overwrite: Throws StreamWriterError with partial stats (stops processing)
 *    - Skip: Logs errors and continues processing
 *    - GenerateNewIds: Logs errors (shouldn't happen normally)
 *
 * 5. **Statistics Aggregation**: Tracks totals across all flushes for final reporting
 *
 * ## Usage Example
 *
 * ```typescript
 * // Create writer for target database
 * const writer = new DocumentDbDocumentWriter(client, targetDb, targetCollection, config);
 *
 * // Create streamer with the writer
 * const streamer = new StreamDocumentWriter(writer);
 *
 * // Stream documents from source
 * const documentStream = reader.streamDocuments(sourceDb, sourceCollection);
 *
 * // Stream with progress tracking
 * const result = await streamer.streamDocuments(
 *   { conflictResolutionStrategy: ConflictResolutionStrategy.Skip },
 *   documentStream,
 *   {
 *     onProgress: (count, details) => {
 *       console.log(`Processed ${count} documents - ${details}`);
 *     },
 *     abortSignal: abortController.signal
 *   }
 * );
 *
 * console.log(`Total: ${result.totalProcessed}, Flushes: ${result.flushCount}`);
 * ```
 *
 * ## Buffer Flow
 *
 * ```
 * Document Stream → Buffer (in-memory) → Flush (when limits hit) → DocumentWriter → Database
 *                     ↓                        ↓
 *                Memory estimate          getBufferConstraints()
 *                Document count           determines flush timing
 * ```
 */
export class StreamDocumentWriter {
    private buffer: DocumentDetails[] = [];
    private bufferMemoryEstimate: number = 0;
    private totalProcessed: number = 0;
    private totalInserted: number = 0;
    private totalSkipped: number = 0;
    private totalMatched: number = 0;
    private totalUpserted: number = 0;
    private flushCount: number = 0;
    private currentStrategy?: ConflictResolutionStrategy;

    /**
     * Creates a new StreamDocumentWriter.
     *
     * @param writer The DocumentWriter to use for writing documents
     */
    constructor(private readonly writer: DocumentWriter<unknown>) {}

    /**
     * Formats current statistics into a details string for progress reporting.
     * Only shows statistics that are relevant for the current conflict resolution strategy.
     *
     * @param strategy The conflict resolution strategy being used
     * @returns Formatted details string, or undefined if no relevant stats to show
     */
    private formatProgressDetails(strategy: ConflictResolutionStrategy): string | undefined {
        const parts: string[] = [];

        switch (strategy) {
            case ConflictResolutionStrategy.Abort:
            case ConflictResolutionStrategy.GenerateNewIds:
                // Abort/GenerateNewIds: Only show inserted (matched/upserted always 0, uses insertMany)
                if (this.totalInserted > 0) {
                    parts.push(vscode.l10n.t('{0} inserted', this.totalInserted.toLocaleString()));
                }
                break;

            case ConflictResolutionStrategy.Skip:
                // Skip: Show inserted + skipped (matched/upserted always 0, uses insertMany with error handling)
                if (this.totalInserted > 0) {
                    parts.push(vscode.l10n.t('{0} inserted', this.totalInserted.toLocaleString()));
                }
                if (this.totalSkipped > 0) {
                    parts.push(vscode.l10n.t('{0} skipped', this.totalSkipped.toLocaleString()));
                }
                break;

            case ConflictResolutionStrategy.Overwrite:
                // Overwrite: Show matched + upserted (inserted always 0, uses replaceOne)
                if (this.totalMatched > 0) {
                    parts.push(vscode.l10n.t('{0} matched', this.totalMatched.toLocaleString()));
                }
                if (this.totalUpserted > 0) {
                    parts.push(vscode.l10n.t('{0} upserted', this.totalUpserted.toLocaleString()));
                }
                break;
        }

        return parts.length > 0 ? parts.join(', ') : undefined;
    }

    /**
     * Streams documents from an AsyncIterable source to the target using the configured writer.
     *
     * @param config Configuration including conflict resolution strategy
     * @param documentStream Source of documents to stream
     * @param options Optional progress callback, abort signal, and action context
     * @returns Statistics about the streaming operation
     *
     * @throws StreamWriterError if conflict resolution strategy is Abort or Overwrite and a write error occurs (includes partial statistics)
     */
    public async streamDocuments(
        config: StreamWriterConfig,
        documentStream: AsyncIterable<DocumentDetails>,
        options?: {
            /**
             * Called with incremental count of documents processed after each flush.
             * The optional details parameter provides a formatted breakdown of statistics (e.g., "1,234 inserted, 34 skipped").
             */
            onProgress?: (processedCount: number, details?: string) => void;
            /** Signal to abort the streaming operation */
            abortSignal?: AbortSignal;
            /** Optional action context for telemetry collection. Used to record streaming statistics for analytics and monitoring. */
            actionContext?: IActionContext;
        },
    ): Promise<StreamWriteResult> {
        // Reset state for this streaming operation
        this.buffer = [];
        this.bufferMemoryEstimate = 0;
        this.totalProcessed = 0;
        this.totalInserted = 0;
        this.totalSkipped = 0;
        this.totalMatched = 0;
        this.totalUpserted = 0;
        this.flushCount = 0;
        this.currentStrategy = config.conflictResolutionStrategy;

        const abortSignal = options?.abortSignal;

        // Stream documents and buffer them
        for await (const document of documentStream) {
            if (abortSignal?.aborted) {
                break;
            }

            // Add document to buffer
            this.buffer.push(document);
            this.bufferMemoryEstimate += this.estimateDocumentMemory(document);

            // Flush if buffer limits reached
            if (this.shouldFlush()) {
                await this.flushBuffer(config, abortSignal, options?.onProgress, options?.actionContext);
            }
        }

        // Flush remaining documents
        if (this.buffer.length > 0 && !abortSignal?.aborted) {
            await this.flushBuffer(config, abortSignal, options?.onProgress, options?.actionContext);
        }

        // Add optional telemetry if action context provided
        if (options?.actionContext) {
            options.actionContext.telemetry.measurements.streamTotalProcessed = this.totalProcessed;
            options.actionContext.telemetry.measurements.streamTotalInserted = this.totalInserted;
            options.actionContext.telemetry.measurements.streamTotalSkipped = this.totalSkipped;
            options.actionContext.telemetry.measurements.streamTotalMatched = this.totalMatched;
            options.actionContext.telemetry.measurements.streamTotalUpserted = this.totalUpserted;
            options.actionContext.telemetry.measurements.streamFlushCount = this.flushCount;
        }

        return {
            totalProcessed: this.totalProcessed,
            insertedCount: this.totalInserted,
            skippedCount: this.totalSkipped,
            matchedCount: this.totalMatched,
            upsertedCount: this.totalUpserted,
            flushCount: this.flushCount,
        };
    }

    /**
     * Determines if the buffer should be flushed based on constraints from the writer.
     *
     * Checks two conditions (flush if either is true):
     * 1. Document count reached optimalDocumentCount
     * 2. Estimated memory usage reached maxMemoryMB limit
     *
     * @returns true if buffer should be flushed, false otherwise
     */
    private shouldFlush(): boolean {
        const constraints = this.writer.getBufferConstraints();

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
     * Flushes the buffer by writing documents to the target database.
     *
     * FLOW:
     * 1. Calls writer.writeDocuments() with buffered documents
     * 2. Receives incremental progress updates via progressCallback during retries
     * 3. Updates total statistics with final counts from result
     * 4. Handles any errors based on conflict resolution strategy
     * 5. Clears buffer and reports final progress
     *
     * PROGRESS REPORTING:
     * - During flush: Reports incremental progress via onProgress callback
     *   (may include duplicates during retry loops)
     * - After flush: Statistics updated with authoritative counts from result
     *
     * VALIDATION:
     * Logs a warning if incremental progress (processedInFlush) doesn't match
     * final result.processedCount. This is expected for Skip strategy with
     * pre-filtering where the same documents may be reported multiple times
     * during retry loops.
     *
     * @param config Configuration with conflict resolution strategy
     * @param abortSignal Optional signal to cancel the operation
     * @param onProgress Optional callback for progress updates
     * @param actionContext Optional action context for telemetry collection
     * @throws StreamWriterError for Abort/Overwrite strategies if errors occur
     */
    private async flushBuffer(
        config: StreamWriterConfig,
        abortSignal: AbortSignal | undefined,
        onProgress: ((count: number, details?: string) => void) | undefined,
        actionContext: IActionContext | undefined,
    ): Promise<void> {
        if (this.buffer.length === 0) {
            return;
        }

        let processedInFlush = 0;

        const result = await this.writer.writeDocuments(this.buffer, {
            abortSignal,
            progressCallback: (count) => {
                processedInFlush += count;

                // Report progress immediately during internal retry loops (e.g., throttle retries)
                // This ensures users see real-time updates even when the writer is making
                // incremental progress through throttle/retry iterations
                //
                // IMPORTANT: We DON'T update this.totalProcessed here because:
                // 1. The writer's progressCallback may report the same documents multiple times
                //    (e.g., pre-filtered documents in Skip strategy during retries)
                // 2. We get the accurate final counts from result.processedCount below
                // 3. We only use this callback for real-time UI updates, not statistics tracking
                if (onProgress && count > 0) {
                    // Generate details for this incremental update based on current totals
                    const details = this.currentStrategy ? this.formatProgressDetails(this.currentStrategy) : undefined;
                    onProgress(count, details);
                }
            },
        });

        // Update statistics with final counts from the write operation
        // This is the authoritative source for statistics (handles retries, pre-filtering, etc.)
        this.totalProcessed += result.processedCount;
        this.totalInserted += result.insertedCount ?? 0;
        this.totalSkipped += result.skippedCount ?? 0;
        this.totalMatched += result.matchedCount ?? 0;
        this.totalUpserted += result.upsertedCount ?? 0;
        this.flushCount++;

        // Validation: The writer's progressCallback reports incremental progress during internal
        // retry loops (e.g., throttle retries, pre-filtering). However, this may include duplicate
        // reports for the same documents (e.g., Skip strategy pre-filters same batch multiple times).
        // The final result.processedCount is the authoritative count of unique documents processed.
        // This check helps identify issues in progress reporting vs final statistics.
        if (processedInFlush !== result.processedCount) {
            ext.outputChannel.warn(
                vscode.l10n.t(
                    '[StreamWriter] Warning: Incremental progress ({0}) does not match final processed count ({1}). This may indicate duplicate progress reports during retry loops (expected for Skip strategy with pre-filtering).',
                    processedInFlush.toString(),
                    result.processedCount.toString(),
                ),
            );

            // Track this warning occurrence in telemetry
            if (actionContext) {
                actionContext.telemetry.properties.progressMismatchWarning = 'true';
                actionContext.telemetry.measurements.progressMismatchIncrementalCount = processedInFlush;
                actionContext.telemetry.measurements.progressMismatchFinalCount = result.processedCount;
            }
        }

        // Handle errors based on strategy (moved from CopyPasteCollectionTask.handleWriteErrors)
        if (result.errors && result.errors.length > 0) {
            this.handleWriteErrors(result.errors, config.conflictResolutionStrategy);
        }

        // Clear buffer
        this.buffer = [];
        this.bufferMemoryEstimate = 0;

        // Note: Progress has already been reported incrementally during the write operation
        // via the progressCallback above. We don't report again here to avoid double-counting.
    }

    /**
     * Handles write errors based on conflict resolution strategy.
     *
     * This logic was extracted from CopyPasteCollectionTask.handleWriteErrors()
     * to make error handling reusable across streaming operations.
     *
     * STRATEGY-SPECIFIC HANDLING:
     *
     * **Abort**: Treats errors as fatal
     * - Builds StreamWriterError with partial statistics
     * - Logs error details to output channel
     * - Throws error to stop processing
     *
     * **Skip**: Treats errors as expected conflicts
     * - Logs each skipped document with its _id
     * - Continues processing remaining documents
     *
     * **GenerateNewIds**: Treats errors as unexpected
     * - Logs errors (shouldn't happen normally since IDs are generated)
     * - Continues processing
     *
     * **Overwrite**: Treats errors as fatal
     * - Builds StreamWriterError with partial statistics
     * - Logs error details to output channel
     * - Throws error to stop processing
     *
     * @param errors Array of errors from write operation
     * @param strategy Conflict resolution strategy
     * @throws StreamWriterError for Abort and Overwrite strategies
     */
    private handleWriteErrors(
        errors: Array<{ documentId?: unknown; error: Error }>,
        strategy: ConflictResolutionStrategy,
    ): void {
        switch (strategy) {
            case ConflictResolutionStrategy.Abort: {
                // Abort: throw error with partial statistics to stop processing
                const firstError = errors[0];

                // Build partial statistics
                const partialStats: StreamWriteResult = {
                    totalProcessed: this.totalProcessed,
                    insertedCount: this.totalInserted,
                    skippedCount: this.totalSkipped,
                    matchedCount: this.totalMatched,
                    upsertedCount: this.totalUpserted,
                    flushCount: this.flushCount,
                };

                // Log partial progress and error
                ext.outputChannel.error(
                    vscode.l10n.t(
                        '[StreamWriter] Error inserting document (Abort): {0}',
                        firstError.error?.message ?? 'Unknown error',
                    ),
                );

                const statsError = new StreamWriterError(
                    vscode.l10n.t(
                        '[StreamWriter] Task aborted due to an error: {0}',
                        firstError.error?.message ?? 'Unknown error',
                    ),
                    partialStats,
                    firstError.error,
                );

                ext.outputChannel.error(
                    vscode.l10n.t('[StreamWriter] Partial progress before error: {0}', statsError.getStatsString()),
                );
                ext.outputChannel.show();

                throw statsError;
            }

            case ConflictResolutionStrategy.Skip:
                // Skip: log errors and continue
                for (const error of errors) {
                    ext.outputChannel.appendLog(
                        vscode.l10n.t(
                            '[StreamWriter] Skipped document with _id: {0} due to error: {1}',
                            error.documentId !== undefined && error.documentId !== null
                                ? typeof error.documentId === 'string'
                                    ? error.documentId
                                    : JSON.stringify(error.documentId)
                                : 'unknown',
                            error.error?.message ?? 'Unknown error',
                        ),
                    );
                }
                ext.outputChannel.show();
                break;

            case ConflictResolutionStrategy.GenerateNewIds:
                // GenerateNewIds: shouldn't have conflicts, but log if they occur
                for (const error of errors) {
                    ext.outputChannel.error(
                        vscode.l10n.t(
                            '[StreamWriter] Error inserting document (GenerateNewIds): {0}',
                            error.error?.message ?? 'Unknown error',
                        ),
                    );
                }
                ext.outputChannel.show();
                break;

            case ConflictResolutionStrategy.Overwrite:
            default: {
                // Overwrite: treat errors as fatal, throw with partial statistics
                const firstError = errors[0];

                // Build partial statistics
                const partialStats: StreamWriteResult = {
                    totalProcessed: this.totalProcessed,
                    insertedCount: this.totalInserted,
                    skippedCount: this.totalSkipped,
                    matchedCount: this.totalMatched,
                    upsertedCount: this.totalUpserted,
                    flushCount: this.flushCount,
                };

                // Log partial progress and error
                ext.outputChannel.error(
                    vscode.l10n.t(
                        '[StreamWriter] Error inserting document (Overwrite): {0}',
                        firstError.error?.message ?? 'Unknown error',
                    ),
                );

                const statsError = new StreamWriterError(
                    vscode.l10n.t(
                        '[StreamWriter] An error occurred while writing documents. Error Count: {0}, First error: {1}',
                        errors.length.toString(),
                        firstError.error?.message ?? 'Unknown error',
                    ),
                    partialStats,
                    firstError.error,
                );

                ext.outputChannel.error(
                    vscode.l10n.t('[StreamWriter] Partial progress before error: {0}', statsError.getStatsString()),
                );
                ext.outputChannel.show();

                throw statsError;
            }
        }
    }

    /**
     * Estimates document memory usage in bytes for buffer management.
     *
     * ESTIMATION METHOD:
     * - Serializes document to JSON string
     * - Multiplies string length by 2 (UTF-16 encoding uses 2 bytes per character)
     * - Falls back to 1KB if serialization fails
     *
     * NOTE: This is an estimate that includes:
     * - JSON representation size
     * - UTF-16 encoding overhead
     * But does NOT include:
     * - JavaScript object overhead
     * - V8 internal structures
     * - BSON encoding overhead (handled by writer's memory limit)
     *
     * The conservative estimate helps prevent out-of-memory errors during streaming.
     *
     * @param document Document to estimate memory usage for
     * @returns Estimated memory usage in bytes
     */
    private estimateDocumentMemory(document: DocumentDetails): number {
        try {
            const jsonString = JSON.stringify(document.documentContent);
            return jsonString.length * 2; // UTF-16 encoding
        } catch {
            return 1024; // 1KB fallback
        }
    }
}
