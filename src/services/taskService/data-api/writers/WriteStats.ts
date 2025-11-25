/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n } from 'vscode';
import { ConflictResolutionStrategy } from '../types';
import { type DocumentOperationCounts, type ProcessedDocumentsDetails } from '../writerTypes';

/**
 * Statistics for a streaming write operation.
 */
export interface StreamWriteStats extends DocumentOperationCounts {
    /** Total documents processed (inserted + skipped + matched + upserted) */
    totalProcessed: number;
    /** Number of buffer flushes performed */
    flushCount: number;
}

/**
 * Aggregated statistics tracker for streaming document write operations.
 *
 * This class encapsulates the statistics aggregation logic extracted from StreamDocumentWriter.
 * It handles:
 * - Accumulating counts across multiple batch writes
 * - Strategy-specific count tracking
 * - Progress formatting for user display
 *
 * The stats tracker maintains internal state and should be created per-streaming operation.
 *
 * @example
 * const stats = new WriteStats();
 *
 * // After each batch write
 * stats.addBatch({
 *   processedCount: 100,
 *   insertedCount: 95,
 *   collidedCount: 5
 * });
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
    private totalInserted: number = 0;
    private totalCollided: number = 0;
    private totalMatched: number = 0;
    private totalModified: number = 0;
    private totalUpserted: number = 0;
    private flushCount: number = 0;

    /**
     * Adds batch results to the cumulative statistics.
     *
     * @param details Processing details from a batch write operation
     */
    addBatch(details: ProcessedDocumentsDetails): void {
        this.totalProcessed += details.processedCount;
        this.totalInserted += details.insertedCount ?? 0;
        this.totalCollided += details.collidedCount ?? 0;
        this.totalMatched += details.matchedCount ?? 0;
        this.totalModified += details.modifiedCount ?? 0;
        this.totalUpserted += details.upsertedCount ?? 0;
    }

    /**
     * Records that a buffer flush occurred.
     */
    recordFlush(): void {
        this.flushCount++;
    }

    /**
     * Gets the current cumulative statistics.
     */
    getCurrentStats(): StreamWriteStats {
        return {
            totalProcessed: this.totalProcessed,
            insertedCount: this.totalInserted,
            collidedCount: this.totalCollided,
            matchedCount: this.totalMatched,
            modifiedCount: this.totalModified,
            upsertedCount: this.totalUpserted,
            flushCount: this.flushCount,
        };
    }

    /**
     * Gets the total number of documents processed.
     */
    getTotalProcessed(): number {
        return this.totalProcessed;
    }

    /**
     * Gets the final statistics for the streaming operation.
     * Alias for getCurrentStats() for semantic clarity.
     */
    getFinalStats(): StreamWriteStats {
        return this.getCurrentStats();
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
                // Abort/GenerateNewIds: Only show inserted
                if (this.totalInserted > 0) {
                    parts.push(l10n.t('{0} inserted', this.totalInserted.toLocaleString()));
                }
                break;

            case ConflictResolutionStrategy.Skip:
                // Skip: Show inserted + skipped
                if (this.totalInserted > 0) {
                    parts.push(l10n.t('{0} inserted', this.totalInserted.toLocaleString()));
                }
                if (this.totalCollided > 0) {
                    parts.push(l10n.t('{0} skipped', this.totalCollided.toLocaleString()));
                }
                break;

            case ConflictResolutionStrategy.Overwrite:
                // Overwrite: Show matched + upserted
                if (this.totalMatched > 0) {
                    parts.push(l10n.t('{0} matched', this.totalMatched.toLocaleString()));
                }
                if (this.totalUpserted > 0) {
                    parts.push(l10n.t('{0} upserted', this.totalUpserted.toLocaleString()));
                }
                break;
        }

        return parts.length > 0 ? parts.join(', ') : undefined;
    }

    /**
     * Formats processing details into a human-readable string based on the conflict resolution strategy.
     * Used for logging and progress messages.
     *
     * @param details Processing details to format
     * @param strategy The conflict resolution strategy being used
     * @returns Formatted string describing the operation result
     */
    static formatDetails(details: ProcessedDocumentsDetails, strategy: ConflictResolutionStrategy): string {
        const { insertedCount, matchedCount, modifiedCount, upsertedCount, collidedCount } = details;

        switch (strategy) {
            case ConflictResolutionStrategy.Skip:
                if ((collidedCount ?? 0) > 0) {
                    return l10n.t(
                        '{0} inserted, {1} skipped',
                        (insertedCount ?? 0).toString(),
                        (collidedCount ?? 0).toString(),
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
                if ((collidedCount ?? 0) > 0) {
                    return l10n.t(
                        '{0} inserted, {1} collided',
                        (insertedCount ?? 0).toString(),
                        (collidedCount ?? 0).toString(),
                    );
                }
                return l10n.t('{0} inserted', (insertedCount ?? 0).toString());

            default:
                return l10n.t('{0} processed', details.processedCount.toString());
        }
    }

    /**
     * Normalizes processing details to only include counts relevant for the current strategy.
     *
     * This prevents incorrect count accumulation when throttle errors contain counts
     * that aren't relevant for the operation type.
     *
     * @param details Raw details extracted from error or result
     * @param strategy The conflict resolution strategy being used
     * @returns Normalized details with only strategy-relevant counts
     */
    static normalizeForStrategy(
        details: ProcessedDocumentsDetails,
        strategy: ConflictResolutionStrategy,
    ): ProcessedDocumentsDetails {
        switch (strategy) {
            case ConflictResolutionStrategy.GenerateNewIds:
                return {
                    processedCount: details.insertedCount ?? 0,
                    insertedCount: details.insertedCount,
                };

            case ConflictResolutionStrategy.Skip:
            case ConflictResolutionStrategy.Abort:
                return {
                    processedCount: (details.insertedCount ?? 0) + (details.collidedCount ?? 0),
                    insertedCount: details.insertedCount,
                    collidedCount: details.collidedCount,
                };

            case ConflictResolutionStrategy.Overwrite:
                return {
                    processedCount: (details.matchedCount ?? 0) + (details.upsertedCount ?? 0),
                    matchedCount: details.matchedCount,
                    modifiedCount: details.modifiedCount,
                    upsertedCount: details.upsertedCount,
                };

            default:
                return details;
        }
    }

    /**
     * Resets all statistics to zero.
     * Useful for reusing the stats tracker across multiple operations.
     */
    reset(): void {
        this.totalProcessed = 0;
        this.totalInserted = 0;
        this.totalCollided = 0;
        this.totalMatched = 0;
        this.totalModified = 0;
        this.totalUpserted = 0;
        this.flushCount = 0;
    }
}
