/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { l10n } from 'vscode';
import { ext } from '../../../../extensionVariables';
import {
    type BufferConstraints,
    type BulkWriteResult,
    ConflictResolutionStrategy,
    type DocumentDetails,
    type DocumentWriter,
    type DocumentWriterOptions,
    type EnsureTargetExistsResult,
} from '../types';
import {
    type BatchWriteOutcome,
    type ErrorType,
    FAST_MODE,
    type OptimizationModeConfig,
    type ProcessedDocumentsDetails,
    RU_LIMITED_MODE,
    type StrategyWriteResult,
} from '../writerTypes';

/**
 * Abstract base class for DocumentWriter implementations.
 *
 * Provides shared logic for:
 * - Adaptive batch sizing (dual-mode: fast/RU-limited)
 * - Retry logic with exponential backoff
 * - Progress tracking and reporting
 * - Abort signal handling
 * - Buffer constraints calculation
 * - Dual-path conflict handling (primary + fallback)
 *
 * ## Conflict Handling Architecture
 *
 * This implementation uses a defense-in-depth approach with dual-path conflict handling:
 *
 * **PRIMARY PATH (Expected Conflicts):**
 * - Strategy methods should catch expected duplicate key errors
 * - Extract details and return conflicts in StrategyWriteResult.errors array
 * - Provides clean error messages and better control over conflict formatting
 * - Example: Abort strategy catches BulkWriteError, extracts document IDs, returns detailed errors
 *
 * **FALLBACK PATH (Unexpected Conflicts):**
 * - Any conflicts thrown from strategy methods are caught by retry loop
 * - Handles race conditions, unknown unique indexes, driver behavior changes, bugs
 * - Uses classifyError() -> extractConflictDetails() -> graceful handling
 * - Logs warnings when fallback path is triggered for debugging
 *
 * **Benefits:**
 * - Robustness: System handles unexpected scenarios gracefully
 * - Clean API: Expected conflicts use structured return values
 * - Debugging: Fallback path logging helps identify race conditions
 * - Future-proof: Works even if database behavior changes
 *
 * **For Future Database Implementers:**
 * Handle expected conflicts in your strategy methods by returning StrategyWriteResult
 * with populated errors array. Throw any unexpected errors (network, throttle, unknown
 * conflicts) for the retry logic to handle appropriately.
 *
 * Subclasses implement database-specific operations via abstract hooks.
 *
 * @template TDocumentId Type of document identifiers used by the database implementation
 */
export abstract class BaseDocumentWriter<TDocumentId> implements DocumentWriter<TDocumentId> {
    /** Current batch size (adaptive, changes based on success/throttle) */
    protected currentBatchSize: number;

    /** Minimum batch size (always 1 document) */
    protected readonly minBatchSize: number = 1;

    /** Current optimization mode configuration */
    protected currentMode: OptimizationModeConfig;

    /** Current progress callback for the ongoing write operation */
    private currentProgressCallback?: (processedCount: number) => void;

    /**
     * Buffer memory limit in MB. This is a conservative limit that accounts for
     * measurement errors due to encoding differences, object overhead, and other
     * memory allocation variations. If the goal were to push closer to actual
     * memory limits, exact size measurements would need to be performed.
     */
    protected readonly BUFFER_MEMORY_LIMIT_MB: number = 24;

    /** Target database name */
    protected readonly databaseName: string;

    /** Target collection name */
    protected readonly collectionName: string;

    /** Conflict resolution strategy */
    protected readonly conflictResolutionStrategy: ConflictResolutionStrategy;

    protected constructor(
        databaseName: string,
        collectionName: string,
        conflictResolutionStrategy: ConflictResolutionStrategy,
    ) {
        this.currentMode = FAST_MODE;
        this.currentBatchSize = FAST_MODE.initialBatchSize;
        this.databaseName = databaseName;
        this.collectionName = collectionName;
        this.conflictResolutionStrategy = conflictResolutionStrategy;
    }

    /**
     * Writes documents in bulk using adaptive batching and retry logic.
     *
     * This is the main entry point for writing documents. It orchestrates the entire write
     * operation by:
     * 1. Splitting the input into batches based on currentBatchSize
     * 2. Delegating each batch to writeBatchWithRetry() for resilient processing
     * 3. Aggregating statistics across all batches
     * 4. Reporting progress incrementally via optional callback
     * 5. Handling Abort strategy termination on first conflict
     *
     * @param documents Array of documents to write
     * @param options Optional configuration for progress tracking, cancellation, and telemetry
     * @returns BulkWriteResult containing statistics and any errors encountered
     *
     * @example
     * // Writing documents to Azure Cosmos DB for MongoDB (vCore)
     * const result = await writer.writeDocuments(documents, {
     *   progressCallback: (count) => console.log(`Processed ${count} documents`),
     *   abortSignal: abortController.signal,
     * });
     * console.log(`Inserted: ${result.insertedCount}, Skipped: ${result.skippedCount}`);
     */
    public async writeDocuments(
        documents: DocumentDetails[],
        options?: DocumentWriterOptions,
    ): Promise<BulkWriteResult<TDocumentId>> {
        if (documents.length === 0) {
            return {
                processedCount: 0,
                errors: null,
            };
        }

        // Capture progress callback for use throughout the operation
        this.currentProgressCallback = options?.progressCallback;

        let pendingDocs = [...documents];
        let totalInserted = 0;
        let totalSkipped = 0;
        let totalMatched = 0;
        let totalUpserted = 0;
        const allErrors: Array<{ documentId?: TDocumentId; error: Error }> = [];

        while (pendingDocs.length > 0) {
            if (options?.abortSignal?.aborted) {
                break;
            }

            const batch = pendingDocs.slice(0, this.currentBatchSize);
            const writeBatchResult = await this.writeBatchWithRetry(
                batch,
                options?.abortSignal,
                options?.actionContext,
            );

            totalInserted += writeBatchResult.insertedCount ?? 0;
            totalSkipped += writeBatchResult.skippedCount ?? 0;
            totalMatched += writeBatchResult.matchedCount ?? 0;
            totalUpserted += writeBatchResult.upsertedCount ?? 0;
            pendingDocs = pendingDocs.slice(writeBatchResult.processedCount);

            if (writeBatchResult.errors?.length) {
                allErrors.push(...writeBatchResult.errors);

                // For Abort strategy, stop immediately on first error
                if (this.conflictResolutionStrategy === ConflictResolutionStrategy.Abort) {
                    break;
                }
            }
        }

        return {
            insertedCount: totalInserted,
            skippedCount: totalSkipped,
            matchedCount: totalMatched,
            upsertedCount: totalUpserted,
            processedCount: totalInserted + totalSkipped + totalMatched + totalUpserted,
            errors: allErrors.length > 0 ? allErrors : null,
        };
    }

    /**
     * Ensures the target collection exists, creating it if necessary.
     *
     * This method is called before starting bulk write operations to verify
     * that the target collection exists. Database-specific implementations
     * should check if the collection exists and create it if needed.
     *
     * @returns EnsureTargetExistsResult indicating whether the collection was created
     *
     * @example
     * // Azure Cosmos DB for MongoDB API implementation
     * const result = await writer.ensureTargetExists();
     * if (result.targetWasCreated) {
     *   console.log('Created new collection');
     * }
     */
    public abstract ensureTargetExists(): Promise<EnsureTargetExistsResult>;

    /**
     * Returns buffer constraints for optimal streaming and batching.
     *
     * These constraints help higher-level components (like StreamDocumentWriter)
     * manage their read buffers efficiently by providing:
     * - optimalDocumentCount: Adaptive batch size based on database performance
     * - maxMemoryMB: Safe memory limit accounting for encoding overhead
     *
     * The batch size is adaptive and changes based on:
     * - Success: Grows by growthFactor (20% in Fast mode, 10% in RU-limited mode)
     * - Throttling: Switches to RU-limited mode and shrinks to proven capacity
     * - Network errors: Retries with exponential backoff
     *
     * @returns BufferConstraints with current optimal batch size and memory limit
     *
     * @example
     * // StreamDocumentWriter uses these constraints to decide when to flush
     * const constraints = writer.getBufferConstraints();
     * if (buffer.length >= constraints.optimalDocumentCount) {
     *   await flushBuffer();
     * }
     */
    public getBufferConstraints(): BufferConstraints {
        return {
            optimalDocumentCount: this.currentBatchSize,
            maxMemoryMB: this.BUFFER_MEMORY_LIMIT_MB,
        };
    }

    // ==================== CORE RETRY LOGIC ====================

    /**
     * Writes a batch of documents with automatic retry logic for transient failures.
     *
     * This method implements the core resilience and adaptive behavior of the writer:
     * 1. Selects appropriate strategy method based on conflictResolutionStrategy
     * 2. Handles throttling with exponential backoff and adaptive batch sizing
     * 3. Retries network errors with exponential backoff
     * 4. Handles conflicts via dual-path approach (primary + fallback)
     * 5. Reports incremental progress via callback
     * 6. Switches from Fast mode to RU-limited mode on first throttle
     *
     * The method will retry up to maxAttempts times for recoverable errors,
     * but will reset the attempt counter when making progress.
     *
     * @param initialBatch Batch of documents to write
     * @param abortSignal Optional signal to cancel the operation
     * @param actionContext Optional context for telemetry
     * @returns BatchWriteOutcome with statistics and any errors
     * @throws Error if maxAttempts reached without progress or if unrecoverable error occurs
     */
    protected async writeBatchWithRetry(
        initialBatch: DocumentDetails[],
        abortSignal?: AbortSignal,
        actionContext?: IActionContext,
    ): Promise<BatchWriteOutcome<TDocumentId>> {
        let currentBatch = initialBatch;
        const maxAttempts = this.getMaxAttempts();
        let attempt = 0;
        let wasThrottled = false;

        let insertedCount = 0;
        let skippedCount = 0;
        let matchedCount = 0;
        let upsertedCount = 0;
        const batchErrors: Array<{ documentId?: TDocumentId; error: Error }> = [];

        while (currentBatch.length > 0) {
            if (attempt >= maxAttempts) {
                throw new Error(
                    l10n.t(
                        'Failed to write batch after {0} attempts without progress. Documents remaining: {1}',
                        maxAttempts.toString(),
                        currentBatch.length.toString(),
                    ),
                );
            }

            if (abortSignal?.aborted) {
                break;
            }

            const batchToWrite = currentBatch.slice(0, Math.max(1, this.currentBatchSize));
            this.traceWriteAttempt(
                attempt,
                batchToWrite.length,
                initialBatch.length - currentBatch.length,
                initialBatch.length,
            );

            try {
                ext.outputChannel.debug(
                    l10n.t(
                        '[DocumentWriter] Writing batch of {0} documents with the "{1}" strategy.',
                        batchToWrite.length.toString(),
                        this.conflictResolutionStrategy,
                    ),
                );

                let result: StrategyWriteResult<TDocumentId>;
                switch (this.conflictResolutionStrategy) {
                    case ConflictResolutionStrategy.Skip:
                        result = await this.writeWithSkipStrategy(batchToWrite, actionContext);
                        break;
                    case ConflictResolutionStrategy.Overwrite:
                        result = await this.writeWithOverwriteStrategy(batchToWrite, actionContext);
                        break;
                    case ConflictResolutionStrategy.Abort:
                        result = await this.writeWithAbortStrategy(batchToWrite, actionContext);
                        break;
                    case ConflictResolutionStrategy.GenerateNewIds:
                        result = await this.writeWithGenerateNewIdsStrategy(batchToWrite, actionContext);
                        break;
                    default:
                        throw new Error(`Unknown conflict resolution strategy: ${this.conflictResolutionStrategy}`);
                }

                // Primary path: check for conflicts returned in the result
                if (result.errors?.length) {
                    batchErrors.push(...result.errors);

                    // For Abort strategy, stop processing immediately on conflicts
                    if (this.conflictResolutionStrategy === ConflictResolutionStrategy.Abort) {
                        ext.outputChannel.trace(
                            l10n.t(
                                '[Writer] Abort strategy encountered conflicts: {0}',
                                this.formatProcessedDocumentsDetails(this.extractProgress(result)),
                            ),
                        );
                        this.reportProgress(this.extractProgress(result));

                        insertedCount += result.insertedCount ?? 0;
                        skippedCount += result.skippedCount ?? 0;
                        matchedCount += result.matchedCount ?? 0;
                        upsertedCount += result.upsertedCount ?? 0;
                        currentBatch = currentBatch.slice(result.processedCount);

                        // Stop processing and return
                        return {
                            insertedCount,
                            skippedCount,
                            matchedCount,
                            upsertedCount,
                            processedCount: result.processedCount,
                            wasThrottled,
                            errors: batchErrors.length > 0 ? batchErrors : undefined,
                        };
                    }
                }

                const progress = this.extractProgress(result);
                ext.outputChannel.trace(
                    l10n.t('[Writer] Success: {0}', this.formatProcessedDocumentsDetails(progress)),
                );
                this.reportProgress(progress);

                insertedCount += progress.insertedCount ?? 0;
                skippedCount += progress.skippedCount ?? 0;
                matchedCount += progress.matchedCount ?? 0;
                upsertedCount += progress.upsertedCount ?? 0;

                currentBatch = currentBatch.slice(result.processedCount);

                // Grow batch size only if no conflicts were skipped
                // (if we're here, the operation succeeded without throttle/network errors)
                if ((result.skippedCount ?? 0) === 0 && (result.errors?.length ?? 0) === 0) {
                    this.growBatchSize();
                }

                attempt = 0;
            } catch (error) {
                const errorType = this.classifyError(error, actionContext);

                if (errorType === 'throttle') {
                    wasThrottled = true;

                    const details = this.extractDetailsFromError(error, actionContext) ?? this.createFallbackDetails(0);
                    const successfulCount = details.processedCount;

                    if (this.currentMode.mode === 'fast') {
                        this.switchToRuLimitedMode(successfulCount);
                    }

                    if (successfulCount > 0) {
                        ext.outputChannel.trace(
                            l10n.t('[Writer] Throttled: {0}', this.formatProcessedDocumentsDetails(details)),
                        );
                        this.reportProgress(details);
                        insertedCount += details.insertedCount ?? 0;
                        skippedCount += details.skippedCount ?? 0;
                        matchedCount += details.matchedCount ?? 0;
                        upsertedCount += details.upsertedCount ?? 0;
                        currentBatch = currentBatch.slice(successfulCount);
                        this.shrinkBatchSize(successfulCount);
                        attempt = 0;
                    } else {
                        this.currentBatchSize = Math.max(this.minBatchSize, Math.floor(this.currentBatchSize / 2) || 1);
                        attempt++;
                    }

                    const delay = this.calculateRetryDelay(attempt);
                    await this.abortableDelay(delay, abortSignal);
                    continue;
                }

                if (errorType === 'network') {
                    attempt++;
                    const delay = this.calculateRetryDelay(attempt);
                    await this.abortableDelay(delay, abortSignal);
                    continue;
                }

                if (errorType === 'conflict') {
                    // Fallback path: conflict was thrown unexpectedly (race condition, unknown index, etc.)
                    ext.outputChannel.warn(
                        l10n.t(
                            '[Writer] Unexpected conflict error caught in retry loop (possible race condition or unknown unique index)',
                        ),
                    );

                    const conflictErrors = this.extractConflictDetails(error, actionContext);
                    const details =
                        this.extractDetailsFromError(error, actionContext) ??
                        this.createFallbackDetails(conflictErrors.length);

                    if (this.conflictResolutionStrategy === ConflictResolutionStrategy.Skip) {
                        ext.outputChannel.trace(
                            l10n.t(
                                '[Writer] Conflicts handled via fallback path: {0}',
                                this.formatProcessedDocumentsDetails(details),
                            ),
                        );
                    } else {
                        ext.outputChannel.warn(
                            l10n.t(
                                '[Writer] Write aborted due to unexpected conflicts after processing {0} documents (fallback path)',
                                details.processedCount.toString(),
                            ),
                        );
                    }
                    this.reportProgress(details);

                    insertedCount += details.insertedCount ?? 0;
                    skippedCount += details.skippedCount ?? 0;
                    matchedCount += details.matchedCount ?? 0;
                    upsertedCount += details.upsertedCount ?? 0;

                    if (conflictErrors.length > 0) {
                        batchErrors.push(...conflictErrors);
                    }

                    currentBatch = currentBatch.slice(details.processedCount);

                    if (this.conflictResolutionStrategy === ConflictResolutionStrategy.Skip) {
                        attempt = 0;
                        continue;
                    }

                    // For Abort strategy, stop processing immediately
                    return {
                        insertedCount,
                        skippedCount,
                        matchedCount,
                        upsertedCount,
                        processedCount: details.processedCount,
                        wasThrottled,
                        errors: batchErrors.length > 0 ? batchErrors : undefined,
                    };
                }

                throw error;
            }
        }

        return {
            insertedCount,
            skippedCount,
            matchedCount,
            upsertedCount,
            processedCount: insertedCount + skippedCount + matchedCount + upsertedCount,
            wasThrottled,
            errors: batchErrors.length > 0 ? batchErrors : undefined,
        };
    }

    /**
     * Extracts processing details from a successful strategy result.
     *
     * Converts StrategyWriteResult into ProcessedDocumentsDetails for
     * consistent progress reporting and logging.
     *
     * @param result Result from strategy method
     * @returns ProcessedDocumentsDetails with all available counts
     */
    protected extractProgress(result: StrategyWriteResult): ProcessedDocumentsDetails {
        return {
            processedCount: result.processedCount,
            insertedCount: result.insertedCount,
            matchedCount: result.matchedCount,
            modifiedCount: result.modifiedCount,
            upsertedCount: result.upsertedCount,
            skippedCount: result.skippedCount,
        };
    }

    /**
     * Creates fallback processing details when error doesn't contain statistics.
     *
     * Used when extractDetailsFromError() returns undefined, providing a minimal
     * ProcessedDocumentsDetails with just the processed count.
     *
     * @param processedCount Number of documents known to be processed
     * @returns ProcessedDocumentsDetails with only processedCount populated
     */
    protected createFallbackDetails(processedCount: number): ProcessedDocumentsDetails {
        return {
            processedCount,
        };
    }

    /**
     * Formats processed document details into a human-readable string based on the conflict resolution strategy.
     */
    protected formatProcessedDocumentsDetails(details: ProcessedDocumentsDetails): string {
        const { insertedCount, matchedCount, modifiedCount, upsertedCount, skippedCount } = details;

        switch (this.conflictResolutionStrategy) {
            case ConflictResolutionStrategy.Skip:
                if ((skippedCount ?? 0) > 0) {
                    return l10n.t(
                        '{0} inserted, {1} skipped',
                        (insertedCount ?? 0).toString(),
                        (skippedCount ?? 0).toString(),
                    );
                }
                return l10n.t('{0} inserted', (insertedCount ?? 0).toString());

            case ConflictResolutionStrategy.Overwrite:
                return l10n.t(
                    '{0} matched, {1} modified, {2} upserted',
                    (matchedCount ?? 0).toString(),
                    (modifiedCount ?? 0).toString(),
                    (upsertedCount ?? 0).toString(),
                );

            case ConflictResolutionStrategy.GenerateNewIds:
                return l10n.t('{0} inserted with new IDs', (insertedCount ?? 0).toString());

            case ConflictResolutionStrategy.Abort:
                return l10n.t('{0} inserted', (insertedCount ?? 0).toString());

            default:
                return l10n.t('{0} processed', details.processedCount.toString());
        }
    }

    /**
     * Invokes the progress callback with the processed document count.
     *
     * Called after each successful write operation to report incremental progress
     * to higher-level components (e.g., StreamDocumentWriter, tasks).
     *
     * @param details Processing details containing counts to report
     */
    protected reportProgress(details: ProcessedDocumentsDetails): void {
        if (details.processedCount > 0) {
            this.currentProgressCallback?.(details.processedCount);
        }
    }

    /**
     * Returns the maximum number of retry attempts for failed write operations.
     *
     * The writer will retry up to this many times for recoverable errors
     * (throttling, network issues) before giving up. The attempt counter
     * resets to 0 when progress is made.
     *
     * @returns Maximum number of retry attempts (default: 10)
     */
    protected getMaxAttempts(): number {
        return 10;
    }

    /**
     * Logs a detailed trace message for the current write attempt.
     *
     * Provides visibility into retry progress and batch processing state,
     * useful for debugging and monitoring operations.
     *
     * @param attempt Current attempt number (0-based)
     * @param batchSize Number of documents in this batch
     * @param processedSoFar Number of documents already processed from the initial batch
     * @param totalInBatch Total documents in the initial batch
     */
    protected traceWriteAttempt(
        attempt: number,
        batchSize: number,
        processedSoFar: number,
        totalInBatch: number,
    ): void {
        const attemptLabel = l10n.t('Attempt {0}/{1}', attempt.toString(), this.getMaxAttempts());
        const suffix =
            processedSoFar > 0
                ? l10n.t(' ({0}/{1} processed)', processedSoFar.toString(), totalInBatch.toString())
                : '';
        ext.outputChannel.trace(
            l10n.t('[Writer] {0}: writing {1} documents{2}', attemptLabel, batchSize.toString(), suffix),
        );
    }

    // ==================== ADAPTIVE BATCH SIZING ====================

    /**
     * Increases the batch size after a successful write operation.
     *
     * Growth behavior depends on current optimization mode:
     * - Fast mode: 20% growth per success, max 2000 documents
     * - RU-limited mode: 10% growth per success, max 1000 documents
     *
     * This allows the writer to adapt to available throughput by gradually
     * increasing batch size when writes succeed without throttling.
     *
     * @see switchToRuLimitedMode for mode transition logic
     */
    protected growBatchSize(): void {
        if (this.currentBatchSize >= this.currentMode.maxBatchSize) {
            return;
        }

        const growthFactor = this.currentMode.growthFactor;
        const percentageIncrease = Math.floor(this.currentBatchSize * growthFactor);
        const minimalIncrease = this.currentBatchSize + 1;

        this.currentBatchSize = Math.min(this.currentMode.maxBatchSize, Math.max(percentageIncrease, minimalIncrease));
    }

    /**
     * Reduces the batch size after encountering throttling.
     *
     * Sets the batch size to the proven capacity (number of documents that
     * were successfully written before throttling occurred). This ensures
     * the next batch respects the database's current throughput limits.
     *
     * @param successfulCount Number of documents successfully written before throttling
     */
    protected shrinkBatchSize(successfulCount: number): void {
        this.currentBatchSize = Math.max(this.minBatchSize, successfulCount);
    }

    /**
     * Switches from Fast mode to RU-limited mode after detecting throttling.
     *
     * This one-way transition occurs when the first throttle error is detected,
     * indicating the target database has throughput limits (e.g., Azure Cosmos DB
     * for MongoDB RU-based). The writer adjusts its parameters to optimize for
     * a throttled environment:
     *
     * Mode changes:
     * - Initial batch size: 500 → 100
     * - Max batch size: 2000 → 1000
     * - Growth factor: 20% → 10%
     *
     * Batch size adjustment after switch:
     * - If successfulCount ≤ 100: Use proven capacity to avoid re-throttling
     * - If successfulCount > 100: Start conservatively at 100, can grow later
     *
     * @param successfulCount Number of documents successfully written before throttling
     */
    protected switchToRuLimitedMode(successfulCount: number): void {
        if (this.currentMode.mode === 'fast') {
            const previousMode = this.currentMode.mode;
            const previousBatchSize = this.currentBatchSize;
            const previousMaxBatchSize = this.currentMode.maxBatchSize;

            // Switch to RU-limited mode
            this.currentMode = RU_LIMITED_MODE;

            // Reset batch size based on proven capacity vs RU mode initial
            // If proven capacity is low (≤ RU initial), use it to avoid re-throttling
            // If proven capacity is high (> RU initial), start conservatively and grow
            if (successfulCount <= RU_LIMITED_MODE.initialBatchSize) {
                // Low proven capacity: respect what actually worked
                this.currentBatchSize = Math.max(this.minBatchSize, successfulCount);
            } else {
                // High proven capacity: start conservatively with RU initial, can grow later
                this.currentBatchSize = Math.min(successfulCount, RU_LIMITED_MODE.maxBatchSize);
            }

            // Log mode transition
            ext.outputChannel.info(
                l10n.t(
                    '[Writer] Switched from {0} mode to {1} mode after throttle detection. ' +
                        'Batch size: {2} → {3}, Max: {4} → {5}',
                    previousMode,
                    this.currentMode.mode,
                    previousBatchSize.toString(),
                    this.currentBatchSize.toString(),
                    previousMaxBatchSize.toString(),
                    this.currentMode.maxBatchSize.toString(),
                ),
            );
        }
    }

    /**
     * Calculates the delay before the next retry attempt using exponential backoff.
     *
     * Formula: base * (multiplier ^ attempt) + jitter
     * - Base: 1000ms
     * - Multiplier: 1.5
     * - Max: 5000ms
     * - Jitter: ±30% of calculated delay
     *
     * Jitter prevents thundering herd when multiple clients retry simultaneously.
     *
     * @param attempt Current retry attempt number (0-based)
     * @returns Delay in milliseconds before next retry
     *
     * @example
     * // Typical delays:
     * // Attempt 0: ~1000ms ± 300ms
     * // Attempt 1: ~1500ms ± 450ms
     * // Attempt 2: ~2250ms ± 675ms
     * // Attempt 3+: ~5000ms ± 1500ms (capped)
     */
    protected calculateRetryDelay(attempt: number): number {
        const base = 1000;
        const multiplier = 1.5;
        const maxDelay = 5000;
        const exponentialDelay = base * Math.pow(multiplier, attempt);
        const cappedDelay = Math.min(exponentialDelay, maxDelay);
        const jitterRange = cappedDelay * 0.3;
        const jitter = Math.random() * jitterRange * 2 - jitterRange;
        return Math.floor(cappedDelay + jitter);
    }

    /**
     * Creates an abortable delay that can be interrupted by an abort signal.
     * If no abort signal is provided, behaves like a regular setTimeout.
     * Returns immediately if the abort signal is already triggered.
     */
    private async abortableDelay(ms: number, abortSignal?: AbortSignal): Promise<void> {
        if (abortSignal?.aborted) {
            return; // Graceful early return for already aborted operations
        }

        return new Promise((resolve) => {
            const timeoutId = setTimeout(() => {
                cleanup();
                resolve();
            }, ms);

            let cleanup: () => void;

            if (abortSignal) {
                const abortHandler = () => {
                    clearTimeout(timeoutId);
                    cleanup();
                    resolve(); // Graceful resolution when aborted
                };

                abortSignal.addEventListener('abort', abortHandler, { once: true });

                cleanup = () => {
                    abortSignal.removeEventListener('abort', abortHandler);
                };
            } else {
                cleanup = () => {
                    // No-op when no abort signal is provided
                };
            }
        });
    }

    // ==================== ABSTRACT HOOKS ====================

    /**
     * Writes documents using the Skip conflict resolution strategy.
     *
     * EXPECTED BEHAVIOR:
     * - Insert documents that don't conflict with existing documents
     * - Skip (don't insert) documents with duplicate _id values
     * - Return skipped documents in the errors array with descriptive messages
     * - Continue processing all documents despite conflicts
     *
     * CONFLICT HANDLING (Primary Path - Recommended):
     * For optimal performance, implementations should:
     * 1. Pre-filter conflicting documents by querying for existing _id values
     * 2. Insert only non-conflicting documents
     * 3. Return skipped documents in StrategyWriteResult.errors array
     *
     * Note: Pre-filtering is a performance optimization. Even with pre-filtering,
     * conflicts can still occur due to concurrent writes from other clients.
     * The dual-path conflict handling in writeBatchWithRetry() will catch any
     * unexpected conflicts via the fallback path.
     *
     * IMPORTANT: Do NOT throw on conflicts. Return them in the result.errors array.
     * Thrown errors should only be used for unexpected failures (network, throttle, etc.)
     * that require retry logic.
     *
     * @param documents Batch of documents to insert
     * @param actionContext Optional context for telemetry
     * @returns StrategyWriteResult with insertedCount, skippedCount, and errors array
     *
     * @example
     * // Azure Cosmos DB for MongoDB API implementation
     * async writeWithSkipStrategy(documents) {
     *   // Pre-filter conflicts (performance optimization)
     *   const { docsToInsert, conflictIds } = await this.preFilterConflicts(documents);
     *
     *   // Insert non-conflicting documents
     *   const result = await collection.insertMany(docsToInsert);
     *
     *   // Return skipped documents in errors array
     *   return {
     *     insertedCount: result.insertedCount,
     *     skippedCount: conflictIds.length,
     *     processedCount: result.insertedCount + conflictIds.length,
     *     errors: conflictIds.map(id => ({
     *       documentId: id,
     *       error: new Error('Document already exists (skipped)')
     *     }))
     *   };
     * }
     */
    protected abstract writeWithSkipStrategy(
        documents: DocumentDetails[],
        actionContext?: IActionContext,
    ): Promise<StrategyWriteResult<TDocumentId>>;

    /**
     * Writes documents using the Overwrite conflict resolution strategy.
     *
     * EXPECTED BEHAVIOR:
     * - Replace existing documents with matching _id values
     * - Insert new documents if _id doesn't exist (upsert)
     * - Return matchedCount, modifiedCount, and upsertedCount
     *
     * CONFLICT HANDLING:
     * This strategy doesn't produce conflicts since it intentionally overwrites
     * existing documents. Use replaceOne/updateOne with upsert:true for each document.
     *
     * IMPORTANT: Unexpected errors (network, throttle) should be thrown for retry logic.
     *
     * @param documents Batch of documents to upsert
     * @param actionContext Optional context for telemetry
     * @returns StrategyWriteResult with matchedCount, modifiedCount, and upsertedCount
     *
     * @example
     * // Azure Cosmos DB for MongoDB API implementation
     * async writeWithOverwriteStrategy(documents) {
     *   const bulkOps = documents.map(doc => ({
     *     replaceOne: {
     *       filter: { _id: doc._id },
     *       replacement: doc,
     *       upsert: true
     *     }
     *   }));
     *
     *   const result = await collection.bulkWrite(bulkOps);
     *
     *   return {
     *     matchedCount: result.matchedCount,
     *     modifiedCount: result.modifiedCount,
     *     upsertedCount: result.upsertedCount,
     *     processedCount: result.matchedCount + result.upsertedCount
     *   };
     * }
     */
    protected abstract writeWithOverwriteStrategy(
        documents: DocumentDetails[],
        actionContext?: IActionContext,
    ): Promise<StrategyWriteResult<TDocumentId>>;

    /**
     * Writes documents using the Abort conflict resolution strategy.
     *
     * EXPECTED BEHAVIOR:
     * - Insert documents using insertMany
     * - Stop immediately on first conflict
     * - Return conflict details in the errors array for clean error messages
     *
     * CONFLICT HANDLING (Primary Path - Recommended):
     * For best user experience, catch expected duplicate key errors and return
     * them in StrategyWriteResult.errors:
     * 1. Catch database-specific duplicate key errors (e.g., BulkWriteError code 11000)
     * 2. Extract document IDs and error messages
     * 3. Return in errors array with descriptive messages
     * 4. Include processedCount showing documents inserted before conflict
     *
     * FALLBACK PATH:
     * If conflicts are thrown instead of returned, the retry loop will catch them
     * and handle them gracefully. However, returning conflicts provides better
     * error messages and control.
     *
     * IMPORTANT: Network and throttle errors should still be thrown for retry logic.
     * Only conflicts should be returned in the errors array.
     *
     * @param documents Batch of documents to insert
     * @param actionContext Optional context for telemetry
     * @returns StrategyWriteResult with insertedCount and optional errors array
     *
     * @example
     * // Azure Cosmos DB for MongoDB API implementation
     * async writeWithAbortStrategy(documents) {
     *   try {
     *     const result = await collection.insertMany(documents);
     *     return {
     *       insertedCount: result.insertedCount,
     *       processedCount: result.insertedCount
     *     };
     *   } catch (error) {
     *     // Primary path: handle expected conflicts
     *     if (isBulkWriteError(error) && hasDuplicateKeyError(error)) {
     *       return {
     *         insertedCount: error.insertedCount ?? 0,
     *         processedCount: error.insertedCount ?? 0,
     *         errors: extractConflictErrors(error)  // Detailed conflict info
     *       };
     *     }
     *     // Fallback: throw unexpected errors for retry logic
     *     throw error;
     *   }
     * }
     */
    protected abstract writeWithAbortStrategy(
        documents: DocumentDetails[],
        actionContext?: IActionContext,
    ): Promise<StrategyWriteResult<TDocumentId>>;

    /**
     * Writes documents using the GenerateNewIds conflict resolution strategy.
     *
     * EXPECTED BEHAVIOR:
     * - Remove _id from each document
     * - Store original _id in a backup field (e.g., _original_id)
     * - Insert documents, allowing database to generate new _id values
     * - Return insertedCount
     *
     * CONFLICT HANDLING:
     * This strategy shouldn't produce conflicts since each document gets a new _id.
     * If conflicts somehow occur (e.g., backup field collision), throw for retry.
     *
     * @param documents Batch of documents to insert with new IDs
     * @param actionContext Optional context for telemetry
     * @returns StrategyWriteResult with insertedCount
     *
     * @example
     * // Azure Cosmos DB for MongoDB API implementation
     * async writeWithGenerateNewIdsStrategy(documents) {
     *   const transformed = documents.map(doc => {
     *     const { _id, ...docWithoutId } = doc;
     *     return { ...docWithoutId, _original_id: _id };
     *   });
     *
     *   const result = await collection.insertMany(transformed);
     *
     *   return {
     *     insertedCount: result.insertedCount,
     *     processedCount: result.insertedCount
     *   };
     * }
     */
    protected abstract writeWithGenerateNewIdsStrategy(
        documents: DocumentDetails[],
        actionContext?: IActionContext,
    ): Promise<StrategyWriteResult<TDocumentId>>;

    /**
     * Extracts complete processing details from a database-specific error.
     *
     * EXPECTED BEHAVIOR:
     * Parse the error object and extract all available operation statistics:
     * - insertedCount: Documents successfully inserted before error
     * - matchedCount: Documents matched for update operations
     * - modifiedCount: Documents actually modified
     * - upsertedCount: Documents inserted via upsert
     * - skippedCount: Documents skipped due to conflicts (for Skip strategy)
     * - processedCount: Total documents processed before error
     *
     * Return undefined if the error doesn't contain any statistics.
     *
     * This method provides clean separation of concerns: the base class handles
     * retry orchestration while the implementation handles database-specific
     * error parsing.
     *
     * @param error Error object from database operation
     * @param actionContext Optional context for telemetry
     * @returns ProcessedDocumentsDetails if statistics available, undefined otherwise
     *
     * @example
     * // Azure Cosmos DB for MongoDB API - parsing BulkWriteError
     * protected extractDetailsFromError(error: unknown) {
     *   if (!isBulkWriteError(error)) return undefined;
     *
     *   return {
     *     processedCount: (error.insertedCount ?? 0) + (error.matchedCount ?? 0),
     *     insertedCount: error.insertedCount,
     *     matchedCount: error.matchedCount,
     *     modifiedCount: error.modifiedCount,
     *     upsertedCount: error.upsertedCount,
     *     skippedCount: error.writeErrors?.filter(e => e.code === 11000).length
     *   };
     * }
     */
    protected abstract extractDetailsFromError(
        error: unknown,
        actionContext?: IActionContext,
    ): ProcessedDocumentsDetails | undefined;

    /**
     * Extracts conflict details from a database-specific error.
     *
     * EXPECTED BEHAVIOR:
     * Parse the error object and extract information about documents that
     * caused conflicts (duplicate _id errors):
     * - Document IDs that conflicted
     * - Error messages describing the conflict
     *
     * This is used by the fallback conflict handling path when conflicts
     * are thrown instead of returned in StrategyWriteResult.errors.
     *
     * Return empty array if the error doesn't contain conflict information.
     *
     * @param error Error object from database operation
     * @param actionContext Optional context for telemetry
     * @returns Array of conflict details (documentId + error message)
     *
     * @example
     * // Azure Cosmos DB for MongoDB API - extracting from BulkWriteError
     * protected extractConflictDetails(error: unknown) {
     *   if (!isBulkWriteError(error)) return [];
     *
     *   return error.writeErrors
     *     .filter(e => e.code === 11000)  // Duplicate key error
     *     .map(e => ({
     *       documentId: e.op?._id,
     *       error: new Error(`Duplicate key: ${e.errmsg}`)
     *     }));
     * }
     *
     * @example
     * // Azure Cosmos DB NoSQL (Core) API - extracting from CosmosException
     * protected extractConflictDetails(error: unknown) {
     *   if (error.code === 409) {  // Conflict status code
     *     return [{
     *       documentId: error.resourceId,
     *       error: new Error('Document already exists')
     *     }];
     *   }
     *   return [];
     * }
     */
    protected abstract extractConflictDetails(
        error: unknown,
        actionContext?: IActionContext,
    ): Array<{ documentId?: TDocumentId; error: Error }>;

    /**
     * Classifies an error into a specific error type for appropriate handling.
     *
     * EXPECTED BEHAVIOR:
     * Analyze the error and classify it as:
     * - 'throttle': Rate limiting/throughput exceeded (will trigger retry + mode switch)
     * - 'network': Network connectivity issues (will trigger retry)
     * - 'conflict': Duplicate key/document already exists (handled by conflict strategy)
     * - 'other': All other errors (will be thrown to caller)
     *
     * This classification determines how the retry loop handles the error:
     * - Throttle: Exponential backoff, switch to RU-limited mode, shrink batch size
     * - Network: Exponential backoff retry
     * - Conflict: Fallback conflict handling based on strategy
     * - Other: Thrown immediately (no retry)
     *
     * @param error Error object to classify
     * @param actionContext Optional context for telemetry
     * @returns ErrorType classification
     *
     * @example
     * // Azure Cosmos DB for MongoDB API classification
     * protected classifyError(error: unknown): ErrorType {
     *   // Throttle detection
     *   if (error.code === 16500 || error.code === 429) return 'throttle';
     *   if (error.message?.includes('rate limit')) return 'throttle';
     *
     *   // Network detection
     *   if (error.code === 'ETIMEDOUT') return 'network';
     *   if (error.message?.includes('connection')) return 'network';
     *
     *   // Conflict detection
     *   if (isBulkWriteError(error) && error.writeErrors?.some(e => e.code === 11000)) {
     *     return 'conflict';
     *   }
     *
     *   return 'other';
     * }
     *
     * @example
     * // Azure Cosmos DB NoSQL (Core) API classification
     * protected classifyError(error: unknown): ErrorType {
     *   if (error.statusCode === 429) return 'throttle';
     *   if (error.statusCode === 408 || error.statusCode === 503) return 'network';
     *   if (error.statusCode === 409) return 'conflict';
     *   return 'other';
     * }
     */
    protected abstract classifyError(error: unknown, actionContext?: IActionContext): ErrorType;
}
