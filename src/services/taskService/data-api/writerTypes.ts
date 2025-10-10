/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Types and interfaces for DocumentWriter implementations.
 * These are used internally by BaseDocumentWriter and its subclasses for
 * adaptive batching, retry logic, error classification, and strategy methods.
 */

/**
 * Standard set of document operation counts.
 * Used across various result types to track what happened to documents during operations.
 */
export interface DocumentOperationCounts {
    /** Number of documents successfully inserted (new documents) */
    insertedCount?: number;

    /** Number of documents skipped (conflicts, validation errors, pre-filtered) */
    skippedCount?: number;

    /** Number of documents matched (existing documents found during update operations) */
    matchedCount?: number;

    /** Number of documents modified (existing documents that were actually changed) */
    modifiedCount?: number;

    /** Number of documents upserted (new documents created via upsert operations) */
    upsertedCount?: number;
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

/**
 * Result of a strategy write operation.
 * Returned by strategy methods, aggregated by base class.
 */
export interface StrategyWriteResult<TDocumentId = unknown> extends DocumentOperationCounts {
    processedCount: number;
    errors?: Array<{ documentId?: TDocumentId; error: Error }>;
}

export interface ProcessedDocumentsDetails extends DocumentOperationCounts {
    processedCount: number;
}

export interface BatchWriteOutcome<TDocumentId = unknown> extends DocumentOperationCounts {
    processedCount: number;
    wasThrottled: boolean;
    errors?: Array<{ documentId?: TDocumentId; error: Error }>;
}
