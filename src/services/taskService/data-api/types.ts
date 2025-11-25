/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Public API types and interfaces for the data-api module.
 * These interfaces define the contract for consumers of DocumentReader
 * and StreamingDocumentWriter.
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
    countDocuments(signal?: AbortSignal, actionContext?: IActionContext): Promise<number>;
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
    actionContext?: IActionContext;
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
 * Provides statistics for task telemetry.
 */
export interface StreamWriteResult extends DocumentOperationCounts {
    /** Total documents processed (inserted + skipped + matched + upserted) */
    totalProcessed: number;

    /** Number of buffer flushes performed */
    flushCount: number;
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
