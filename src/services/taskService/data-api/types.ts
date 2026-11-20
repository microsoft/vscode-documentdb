/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Public API types and interfaces for the data-api module.
 * These interfaces define the contract for consumers of DocumentReader
 * and StreamingDocumentWriter.
 */

import { type TaskTelemetryContext } from '../taskHost';
import { type DataTransferOptions } from './dataTransferHost';

// =================================
// PUBLIC INTERFACES
// =================================

/**
 * Represents a single document in the copy-paste operation.
 */
export interface DocumentDetails {
    /**
     * The document's unique identifier (e.g., _id in DocumentDB)
     */
    id: unknown;

    /**
     * The document content treated as opaque data by the core task logic.
     * Specific readers/writers will know how to interpret/serialize this.
     * For DocumentDB, this would typically be a BSON document.
     */
    documentContent: unknown;
}

/**
 * Batch sizes and growth for one streaming writer mode.
 */
export interface ModeConfig {
    initialBatchSize: number;
    maxBatchSize: number;
    growthFactor: number;
}

/**
 * Optional overrides for streaming writer batching, retry and memory estimation.
 */
export interface StreamingWriterSettings {
    batching?: {
        startMode?: 'fast' | 'ru-limited';
        fast?: Partial<ModeConfig>;
        ruLimited?: Partial<ModeConfig>;
        minBatchSize?: number;
        bufferMemoryLimitMB?: number;
    };
    retry?: {
        maxAttemptsWithoutProgress?: number;
        baseDelayMs?: number;
        multiplier?: number;
        maxDelayMs?: number;
        jitterFraction?: number;
    };
    estimateDocumentSize?: (doc: DocumentDetails) => number;
}

/**
 * Adapter defaults are applied before caller settings.
 */
export interface StreamingWriterOptions extends DataTransferOptions {
    adapterDefaults?: StreamingWriterSettings;
    settings?: StreamingWriterSettings;
}

/**
 * Interface for reading documents from a source collection.
 *
 * DocumentReader instances are created for a specific data source (connection, database, and collection).
 * The source details are provided during construction and used for all subsequent operations.
 *
 * Implementations should store the connection details internally and use them when streaming
 * or counting documents.
 *
 * @example
 * // Create a reader for a specific source
 * const reader = new DocumentDbDocumentReader(connectionId, databaseName, collectionName);
 *
 * // Stream documents from the configured source
 * for await (const doc of reader.streamDocuments()) {
 *   console.log(doc);
 * }
 *
 * // Count documents in the configured source
 * const count = await reader.countDocuments();
 */
export interface DocumentReader {
    /**
     * Streams documents from the source collection configured in the constructor.
     *
     * @param options Optional streaming options (signal, keep-alive, telemetry)
     * @returns AsyncIterable of documents
     */
    streamDocuments(options?: DocumentReaderOptions): AsyncIterable<DocumentDetails>;

    /**
     * Counts documents in the source collection configured in the constructor.
     *
     * @param signal Optional AbortSignal for canceling the count operation
     * @param actionContext Optional action context for telemetry collection
     * @returns Promise resolving to the number of documents
     */
    countDocuments(signal?: AbortSignal, actionContext?: TaskTelemetryContext): Promise<number>;
}

/**
 * Options for reading documents with keep-alive support.
 */
export interface DocumentReaderOptions {
    /**
     * Optional AbortSignal for canceling the stream operation.
     */
    signal?: AbortSignal;

    /**
     * Enable keep-alive buffering to maintain steady read rate from the database.
     * When enabled, periodically reads one document into a buffer to prevent
     * connection/cursor timeouts during slow consumption.
     *
     * @default false
     */
    keepAlive?: boolean;

    /**
     * Interval in milliseconds for keep-alive buffer refills.
     * Only used when keepAlive is true.
     *
     * @default 10000 (10 seconds)
     */
    keepAliveIntervalMs?: number;

    /**
     * Maximum duration in milliseconds for keep-alive operation.
     * If keep-alive runs longer than this timeout, the stream will be aborted.
     * Only used when keepAlive is true.
     *
     * @default 600000 (10 minutes)
     */
    keepAliveTimeoutMs?: number;

    /**
     * Optional action context for telemetry collection.
     * Used to record read operation statistics for analytics and monitoring.
     */
    actionContext?: TaskTelemetryContext;
}

/**
 * Result of ensuring a target exists.
 */
export interface EnsureTargetExistsResult {
    /**
     * Whether the target had to be created (true) or already existed (false).
     */
    targetWasCreated: boolean;
}

/**
 * Result of a streaming write operation.
 * Provides statistics for task telemetry using semantic names.
 *
 * The counts are strategy-specific:
 * - Skip: insertedCount + skippedCount
 * - Abort: insertedCount + abortedCount
 * - Overwrite: replacedCount + createdCount
 * - GenerateNewIds: insertedCount only
 */
export interface StreamWriteResult {
    /** Total documents processed across all strategies */
    totalProcessed: number;

    /** Number of buffer flushes performed */
    flushCount: number;

    // Strategy-specific counts (only relevant ones will be set)

    /** Number of new documents inserted (Skip, Abort, GenerateNewIds strategies) */
    insertedCount?: number;

    /** Number of documents skipped due to conflicts (Skip strategy) */
    skippedCount?: number;

    /** Number of documents that caused abort (Abort strategy) */
    abortedCount?: number;

    /** Number of existing documents replaced/updated (Overwrite strategy) */
    replacedCount?: number;

    /** Number of new documents created via upsert (Overwrite strategy) */
    createdCount?: number;
}

/**
 * Types and interfaces for StreamingDocumentWriter implementations.
 * These are used internally by StreamingDocumentWriter and its subclasses for
 * adaptive batching, retry logic, error classification, and strategy methods.
 *
 * DESIGN PRINCIPLE: All types use semantic/strategy-specific names (insertedCount, skippedCount,
 * replacedCount, createdCount). Database-specific implementations convert from raw DB field names
 * (collidedCount, matchedCount, upsertedCount) to semantic names at the boundary.
 */

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

// =================================
// PRE-FILTER SUPPORT FOR SKIP STRATEGY
// =================================

/**
 * Result of pre-filtering documents for Skip strategy.
 *
 * This is called once per batch BEFORE the retry loop to:
 * 1. Query the target for existing document IDs
 * 2. Remove conflicts from the batch upfront
 * 3. Return the result so skipped docs can be reported immediately
 *
 * This prevents duplicate skip logging during throttle retries and
 * ensures accurate batch slicing.
 */
export interface PreFilterResult<TDocumentId = unknown> {
    /** Documents that should be inserted (don't exist in target) */
    documentsToInsert: DocumentDetails[];
    /** Result containing skipped count and errors for pre-filtered conflicts */
    skippedResult: SkipBatchResult<TDocumentId>;
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
 * Result and retry information for one batch write attempt.
 */
export interface BatchAttemptOutcome<TDocumentId = unknown> {
    result: StrategyBatchResult<TDocumentId>;
    /**
     * Documents still to write; when omitted, the batch minus its first `result.processedCount` documents.
     * Adapters with unordered or scattered successes must supply it explicitly.
     */
    remaining?: DocumentDetails[];
    errorType?: 'throttle' | 'network';
    retryAfterMs?: number;
}

/**
 * Type guard to distinguish an attempt outcome from a plain batch result.
 */
export function isBatchAttemptOutcome<T>(
    value: StrategyBatchResult<T> | BatchAttemptOutcome<T>,
): value is BatchAttemptOutcome<T> {
    return 'result' in value;
}

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
// PARTIAL PROGRESS FOR THROTTLE RECOVERY
// =================================

/**
 * Partial progress extracted from an error during throttle/network recovery.
 *
 * Uses semantic names that match the conflict resolution strategy:
 * - Skip: insertedCount, skippedCount
 * - Abort: insertedCount
 * - Overwrite: replacedCount, createdCount
 * - GenerateNewIds: insertedCount
 *
 * The database-specific implementation converts raw DB field names to these semantic names.
 */
export interface PartialProgress {
    /** Number of documents successfully processed before the error */
    processedCount: number;
    /** Documents still to write; when omitted, the batch minus its first `processedCount` documents. */
    remaining?: DocumentDetails[];
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
 * Error classification for retry logic.
 * Database-specific error codes map to these categories.
 */
export type ErrorType =
    | 'throttle' // Rate limiting (retry with backoff, switch to RU mode)
    | 'network' // Network/connection issues (retry with backoff)
    | 'conflict' // Document conflicts (handled by strategy)
    | 'validator' // Schema validation errors (handled by strategy)
    | 'other'; // Unknown errors (bubble up)

// =================================
// SHARED ENUMS AND STRATEGIES
// =================================

/**
 * Enumeration of conflict resolution strategies for document writing operations
 */
export enum ConflictResolutionStrategy {
    /**
     * Abort the operation if any conflict or error occurs
     */
    Abort = 'abort',

    /**
     * Skip the conflicting document and continue with the operation
     */
    Skip = 'skip',

    /**
     * Overwrite the existing document in the target collection with the source document
     */
    Overwrite = 'overwrite',

    /**
     * Generate new _id values for all documents to avoid conflicts.
     * Original _id values are preserved in a separate field.
     */
    GenerateNewIds = 'generateNewIds',
}
