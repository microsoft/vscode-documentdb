/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n } from 'vscode';
import { ConflictResolutionStrategy, type StreamWriteResult } from '../types';
import {
    isAbortResult,
    isOverwriteResult,
    isSkipResult,
    type PartialProgress,
    type StrategyBatchResult,
} from './writerTypes.internal';

/**
 * Aggregated statistics tracker for streaming document write operations.
 *
 * This class tracks statistics using semantic names that match the conflict resolution strategy:
 * - Skip: insertedCount, skippedCount
 * - Abort: insertedCount, abortedCount
 * - Overwrite: replacedCount, createdCount
 * - GenerateNewIds: insertedCount
 *
 * The stats tracker maintains internal state and should be created per-streaming operation.
 *
 * @example
 * const stats = new WriteStats();
 *
 * // After each batch write
 * stats.addBatch(result); // Pass the strategy-specific result
 *
 * // Get current progress
 * const details = stats.formatProgress(ConflictResolutionStrategy.Skip);
 * // => "1,234 inserted, 34 skipped"
 *
 * // Record flush
 * stats.recordFlush();
 *
 * // Get final stats
 * const result = stats.getFinalStats();
 */
export class WriteStats {
    private totalProcessed: number = 0;

    // Strategy-specific counts (semantic names)
    private totalInserted: number = 0; // Skip, Abort, GenerateNewIds
    private totalSkipped: number = 0; // Skip
    private totalAborted: number = 0; // Abort
    private totalReplaced: number = 0; // Overwrite
    private totalCreated: number = 0; // Overwrite

    private flushCount: number = 0;

    /**
     * Adds batch results to the cumulative statistics.
     * Automatically extracts the correct counts based on the result type.
     *
     * @param result Strategy-specific batch result
     */
    addBatch<T>(result: StrategyBatchResult<T>): void {
        this.totalProcessed += result.processedCount;

        if (isSkipResult(result)) {
            this.totalInserted += result.insertedCount;
            this.totalSkipped += result.skippedCount;
        } else if (isAbortResult(result)) {
            this.totalInserted += result.insertedCount;
            this.totalAborted += result.abortedCount;
        } else if (isOverwriteResult(result)) {
            this.totalReplaced += result.replacedCount;
            this.totalCreated += result.createdCount;
        } else {
            // GenerateNewIds
            this.totalInserted += result.insertedCount;
        }
    }

    /**
     * Adds partial progress from throttle recovery.
     *
     * @param progress Partial progress extracted from error
     * @param strategy The strategy being used (to know which counts to update)
     */
    addPartialProgress(progress: PartialProgress, strategy: ConflictResolutionStrategy): void {
        this.totalProcessed += progress.processedCount;

        switch (strategy) {
            case ConflictResolutionStrategy.Skip:
                this.totalInserted += progress.insertedCount ?? 0;
                this.totalSkipped += progress.skippedCount ?? 0;
                break;
            case ConflictResolutionStrategy.Abort:
                this.totalInserted += progress.insertedCount ?? 0;
                break;
            case ConflictResolutionStrategy.Overwrite:
                this.totalReplaced += progress.replacedCount ?? 0;
                this.totalCreated += progress.createdCount ?? 0;
                break;
            case ConflictResolutionStrategy.GenerateNewIds:
                this.totalInserted += progress.insertedCount ?? 0;
                break;
        }
    }

    /**
     * Records that a buffer flush occurred.
     */
    recordFlush(): void {
        this.flushCount++;
    }

    /**
     * Gets the total number of documents processed.
     */
    getTotalProcessed(): number {
        return this.totalProcessed;
    }

    /**
     * Gets the final statistics for the streaming operation.
     * Returns a StreamWriteResult with all counts (strategy-specific ones will be set appropriately).
     */
    getFinalStats(): StreamWriteResult {
        return {
            totalProcessed: this.totalProcessed,
            flushCount: this.flushCount,
            insertedCount: this.totalInserted > 0 ? this.totalInserted : undefined,
            skippedCount: this.totalSkipped > 0 ? this.totalSkipped : undefined,
            abortedCount: this.totalAborted > 0 ? this.totalAborted : undefined,
            replacedCount: this.totalReplaced > 0 ? this.totalReplaced : undefined,
            createdCount: this.totalCreated > 0 ? this.totalCreated : undefined,
        };
    }

    /**
     * Formats current statistics into a details string for progress reporting.
     * Only shows statistics that are relevant for the current conflict resolution strategy.
     *
     * @param strategy The conflict resolution strategy being used
     * @returns Formatted details string, or undefined if no relevant stats to show
     */
    formatProgress(strategy: ConflictResolutionStrategy): string | undefined {
        const parts: string[] = [];

        switch (strategy) {
            case ConflictResolutionStrategy.Abort:
            case ConflictResolutionStrategy.GenerateNewIds:
                if (this.totalInserted > 0) {
                    parts.push(l10n.t('{0} inserted', this.totalInserted.toLocaleString()));
                }
                break;

            case ConflictResolutionStrategy.Skip:
                if (this.totalInserted > 0) {
                    parts.push(l10n.t('{0} inserted', this.totalInserted.toLocaleString()));
                }
                if (this.totalSkipped > 0) {
                    parts.push(l10n.t('{0} skipped', this.totalSkipped.toLocaleString()));
                }
                break;

            case ConflictResolutionStrategy.Overwrite:
                if (this.totalReplaced > 0) {
                    parts.push(l10n.t('{0} replaced', this.totalReplaced.toLocaleString()));
                }
                if (this.totalCreated > 0) {
                    parts.push(l10n.t('{0} created', this.totalCreated.toLocaleString()));
                }
                break;
        }

        return parts.length > 0 ? parts.join(', ') : undefined;
    }

    /**
     * Resets all statistics to zero.
     * Useful for reusing the stats tracker across multiple operations.
     */
    reset(): void {
        this.totalProcessed = 0;
        this.totalInserted = 0;
        this.totalSkipped = 0;
        this.totalAborted = 0;
        this.totalReplaced = 0;
        this.totalCreated = 0;
        this.flushCount = 0;
    }
}
