/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Public API types and interfaces for the data-api module.
 * These interfaces define the contract for consumers of DocumentReader,
 * DocumentWriter, and StreamDocumentWriter.
 */

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type DocumentOperationCounts } from './writerTypes';

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
     * @returns AsyncIterable of documents
     */
    streamDocuments(): AsyncIterable<DocumentDetails>;

    /**
     * Counts documents in the source collection configured in the constructor.
     *
     * @returns Promise resolving to the number of documents
     */
    countDocuments(): Promise<number>;
}

/**
 * Options for writing documents.
 */
export interface DocumentWriterOptions {
    /**
     * Optional progress callback for reporting processed documents.
     * Called after each batch is successfully processed (written, overwritten, or skipped).
     * @param processedInBatch - Number of documents processed in the current batch
     *                           (includes inserted, overwritten, and skipped documents)
     */
    progressCallback?: (processedInBatch: number) => void;

    /**
     * Optional abort signal to cancel the write operation.
     * The writer will check this signal during retry loops and throw
     * an appropriate error if cancellation is requested.
     */
    abortSignal?: AbortSignal;

    /**
     * Optional action context for telemetry collection.
     * Used to record write operation statistics for analytics and monitoring.
     */
    actionContext?: IActionContext;
}

/**
 * Result of a bulk write operation.
 */
export interface BulkWriteResult<TDocumentId = unknown> extends DocumentOperationCounts {
    /**
     * Total number of documents processed (attempted).
     * Equals the sum of insertedCount + collidedCount + matchedCount + upsertedCount.
     * For strategies that track conflicts (Skip), collidedCount includes conflicting documents.
     * The errors array provides detailed information about failures but is not added separately to this count.
     */
    processedCount: number;

    /**
     * Array of errors that occurred during the write operation.
     */
    errors: Array<{ documentId?: TDocumentId; error: Error }> | null;
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
 * Buffer constraints for optimal document streaming and batching.
 * Provides both document count and memory limits to help tasks manage their read buffers efficiently.
 */
export interface BufferConstraints {
    /**
     * Optimal number of documents per batch (adaptive, based on database performance).
     * This value changes dynamically based on throttling, network conditions, and write success.
     */
    optimalDocumentCount: number;

    /**
     * Maximum memory per batch in megabytes (database-specific safe limit).
     * This is a conservative value that accounts for:
     * - BSON encoding overhead (~10-20%)
     * - Network protocol headers
     */
    maxMemoryMB: number;
}

/**
 * Configuration for streaming document writes.
 * Minimal interface containing only what the streamer needs.
 */
export interface StreamWriterConfig {
    /** Strategy for handling document conflicts (duplicate _id) */
    conflictResolutionStrategy: ConflictResolutionStrategy;
}

/**
 * Result of a streaming write operation.
 * Provides statistics for task telemetry.
 */
export interface StreamWriteResult extends DocumentOperationCounts {
    /** Total documents processed (inserted + skipped + matched + upserted) */
    totalProcessed: number;

    /** Number of buffer flushes performed */
    flushCount: number;
}

/**
 * Interface for writing documents to a target collection.
 */
export interface DocumentWriter<TDocumentId = unknown> {
    /**
     * Writes documents in bulk to the target collection.
     *
     * @param documents Array of documents to write
     * @param options Optional write options
     * @returns Promise resolving to the write result
     */
    writeDocuments(
        documents: DocumentDetails[],
        options?: DocumentWriterOptions,
    ): Promise<BulkWriteResult<TDocumentId>>;

    /**
     * Gets buffer constraints for optimal document streaming.
     * Provides both optimal document count (adaptive batch size) and memory limits
     * to help tasks manage their read buffers efficiently.
     *
     * @returns Buffer constraints with document count and memory limits
     */
    getBufferConstraints(): BufferConstraints;

    /**
     * Ensures the target exists before writing.
     * May need methods for pre-flight checks or setup.
     *
     * @returns Promise resolving to information about whether the target was created
     */
    ensureTargetExists(): Promise<EnsureTargetExistsResult>;
}

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
