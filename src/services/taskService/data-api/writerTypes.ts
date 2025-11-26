/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Types and interfaces for StreamingDocumentWriter implementations.
 * These are used internally by StreamingDocumentWriter and its subclasses for
 * adaptive batching, retry logic, error classification, and strategy methods.
 */

// =================================
// RAW BATCH WRITE RESULT (INTERNAL)
// =================================

/**
 * Raw batch write result returned by implementing classes.
 *
 * This is the format that database implementations return directly from their
 * batch operations. It contains database-specific fields that are then normalized
 * by the base class into strategy-specific results.
 *
 * @internal This type is for the writeBatch method implementation. The base class
 * converts this to StrategyBatchResult for statistics and progress tracking.
 */
export interface BatchWriteResult<TDocumentId = unknown> {
    /** Total number of documents processed in this batch */
    processedCount: number;

    /** Number of new documents successfully inserted */
    insertedCount?: number;

    /** Number of documents that collided with existing documents */
    collidedCount?: number;

    /** Number of existing documents that matched (for upsert operations) */
    matchedCount?: number;

    /** Number of existing documents that were modified (for upsert operations) */
    modifiedCount?: number;

    /** Number of new documents created via upsert (didn't exist before) */
    upsertedCount?: number;

    /** Array of errors that occurred during the operation */
    errors?: Array<{ documentId?: TDocumentId; error: Error }>;
}

// =================================
// STRATEGY-SPECIFIC BATCH RESULTS
// =================================

/**
 * Base interface for all strategy batch results.
 * Each strategy extends this with its own semantic counts.
 */
interface BaseBatchResult<TDocumentId = unknown> {
    /** Total number of documents processed in this batch */
    processedCount: number;
    /** Array of errors that occurred during the operation */
    errors?: Array<{ documentId?: TDocumentId; error: Error }>;
}

/**
 * Result of Skip strategy batch write.
 *
 * Skip strategy inserts new documents and skips documents that conflict
 * with existing documents (same _id).
 */
export interface SkipBatchResult<TDocumentId = unknown> extends BaseBatchResult<TDocumentId> {
    /** Number of new documents successfully inserted */
    insertedCount: number;
    /** Number of documents skipped due to _id conflicts */
    skippedCount: number;
}

/**
 * Result of Abort strategy batch write.
 *
 * Abort strategy inserts documents until a conflict occurs, then stops.
 * If a conflict occurs, the conflicting document is reported in errors.
 */
export interface AbortBatchResult<TDocumentId = unknown> extends BaseBatchResult<TDocumentId> {
    /** Number of documents successfully inserted before any conflict */
    insertedCount: number;
    /** Whether the operation was aborted due to a conflict (1 if aborted, 0 otherwise) */
    abortedCount: number;
}

/**
 * Result of Overwrite strategy batch write.
 *
 * Overwrite strategy replaces existing documents and creates new ones.
 * No conflicts occur since existing documents are replaced via upsert.
 */
export interface OverwriteBatchResult<TDocumentId = unknown> extends BaseBatchResult<TDocumentId> {
    /** Number of existing documents that were replaced (matched and updated) */
    replacedCount: number;
    /** Number of new documents that were created (didn't exist before) */
    createdCount: number;
}

/**
 * Result of GenerateNewIds strategy batch write.
 *
 * GenerateNewIds strategy generates new _id for all documents and inserts them.
 * No conflicts can occur since all IDs are unique.
 */
export interface GenerateNewIdsBatchResult<TDocumentId = unknown> extends BaseBatchResult<TDocumentId> {
    /** Number of documents successfully inserted with new IDs */
    insertedCount: number;
}

/**
 * Union type of all strategy-specific batch results.
 * Used by writeBatch implementations to return the appropriate result type.
 */
export type StrategyBatchResult<TDocumentId = unknown> =
    | SkipBatchResult<TDocumentId>
    | AbortBatchResult<TDocumentId>
    | OverwriteBatchResult<TDocumentId>
    | GenerateNewIdsBatchResult<TDocumentId>;

/**
 * Type guard to check if result is from Skip strategy.
 */
export function isSkipResult<T>(result: StrategyBatchResult<T>): result is SkipBatchResult<T> {
    return 'skippedCount' in result;
}

/**
 * Type guard to check if result is from Abort strategy.
 */
export function isAbortResult<T>(result: StrategyBatchResult<T>): result is AbortBatchResult<T> {
    return 'abortedCount' in result;
}

/**
 * Type guard to check if result is from Overwrite strategy.
 */
export function isOverwriteResult<T>(result: StrategyBatchResult<T>): result is OverwriteBatchResult<T> {
    return 'replacedCount' in result && 'createdCount' in result;
}

/**
 * Type guard to check if result is from GenerateNewIds strategy.
 */
export function isGenerateNewIdsResult<T>(result: StrategyBatchResult<T>): result is GenerateNewIdsBatchResult<T> {
    return 'insertedCount' in result && !('skippedCount' in result) && !('abortedCount' in result);
}

// =================================
// RESULT CONVERSION
// =================================

/** Strategy type for conversion - matches ConflictResolutionStrategy enum values */
export type ConflictStrategy = 'skip' | 'abort' | 'overwrite' | 'generateNewIds';

/**
 * Converts a raw BatchWriteResult from the implementing class to a strategy-specific
 * StrategyBatchResult with proper semantic naming.
 *
 * This function maps database-specific fields to strategy-appropriate semantic names:
 * - Skip: insertedCount + collidedCount → insertedCount + skippedCount
 * - Abort: insertedCount + collidedCount → insertedCount + abortedCount
 * - Overwrite: matchedCount + upsertedCount → replacedCount + createdCount
 * - GenerateNewIds: insertedCount → insertedCount
 *
 * @param result Raw batch write result from database implementation
 * @param strategy The conflict resolution strategy being used
 * @returns Strategy-specific batch result with semantic field names
 */
export function toStrategyResult<T>(result: BatchWriteResult<T>, strategy: ConflictStrategy): StrategyBatchResult<T> {
    switch (strategy) {
        case 'skip':
            return {
                processedCount: result.processedCount,
                insertedCount: result.insertedCount ?? 0,
                skippedCount: result.collidedCount ?? 0,
                errors: result.errors,
            } as SkipBatchResult<T>;

        case 'abort':
            return {
                processedCount: result.processedCount,
                insertedCount: result.insertedCount ?? 0,
                abortedCount: result.collidedCount ?? 0,
                errors: result.errors,
            } as AbortBatchResult<T>;

        case 'overwrite':
            return {
                processedCount: result.processedCount,
                replacedCount: result.matchedCount ?? 0,
                createdCount: result.upsertedCount ?? 0,
                errors: result.errors,
            } as OverwriteBatchResult<T>;

        case 'generateNewIds':
            return {
                processedCount: result.processedCount,
                insertedCount: result.insertedCount ?? 0,
                errors: result.errors,
            } as GenerateNewIdsBatchResult<T>;
    }
}

// =================================
// PARTIAL PROGRESS FOR THROTTLE RECOVERY
// =================================

/**
 * Partial progress extracted from an error during throttle/network recovery.
 *
 * This is a simplified version that only tracks what we can reliably extract
 * from a database error: how many documents were successfully processed.
 * The implementing class should provide strategy-appropriate counts.
 */
export interface PartialProgress {
    /** Number of documents successfully processed before the error */
    processedCount: number;
    /** Strategy-specific: number inserted (for Skip/Abort/GenerateNewIds) */
    insertedCount?: number;
    /** Strategy-specific: number skipped (for Skip) */
    skippedCount?: number;
    /** Strategy-specific: number replaced (for Overwrite) */
    replacedCount?: number;
    /** Strategy-specific: number created (for Overwrite) */
    createdCount?: number;
}

/**
 * Optimization mode configuration for dual-mode adaptive writer.
 */
export interface OptimizationModeConfig {
    mode: 'fast' | 'ru-limited';
    initialBatchSize: number;
    maxBatchSize: number;
    growthFactor: number;
}

/**
 * Fast mode: Optimized for unlimited-capacity environments.
 * - vCore clusters
 * - Local DocumentDB installations
 * - Self-hosted DocumentDB instances
 */
export const FAST_MODE: OptimizationModeConfig = {
    mode: 'fast',
    initialBatchSize: 500,
    maxBatchSize: 2000,
    growthFactor: 1.2, // 20% growth
};

/**
 * RU-limited mode: Optimized for rate-limited environments.
 * - Azure Cosmos DB for MongoDB RU-based (uses MongoDB API)
 * - Azure Cosmos DB for NoSQL (RU-based)
 */
export const RU_LIMITED_MODE: OptimizationModeConfig = {
    mode: 'ru-limited',
    initialBatchSize: 100,
    maxBatchSize: 1000,
    growthFactor: 1.1, // 10% growth
};

/**
 * Error classification for retry logic.
 * Database-specific error codes map to these categories.
 */
export type ErrorType =
    | 'throttle' // Rate limiting (retry with backoff, switch to RU mode)
    | 'network' // Network/connection issues (retry with backoff)
    | 'conflict' // Document conflicts (handled by strategy)
    | 'validator' // Schema validation errors (handled by strategy)
    | 'other'; // Unknown errors (bubble up)
