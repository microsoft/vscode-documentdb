/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CopyPasteConfig } from './copyPasteConfig';

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
 * Interface for reading documents from a source collection
 */
export interface DocumentReader {
    /**
     * Streams documents from the source collection.
     *
     * @param connectionId Connection identifier for the source
     * @param databaseName Name of the source database
     * @param collectionName Name of the source collection
     * @returns AsyncIterable of documents
     */
    streamDocuments(connectionId: string, databaseName: string, collectionName: string): AsyncIterable<DocumentDetails>;

    /**
     * Counts documents in the source collection for progress calculation.
     *
     * @param connectionId Connection identifier for the source
     * @param databaseName Name of the source database
     * @param collectionName Name of the source collection
     * @returns Promise resolving to the number of documents
     */
    countDocuments(connectionId: string, databaseName: string, collectionName: string): Promise<number>;
}

/**
 * Options for writing documents.
 */
export interface DocumentWriterOptions {
    /**
     * Optional batch size override for this operation.
     * If not specified, the writer will use its default adaptive batching.
     */
    batchSize?: number;

    /**
     * Optional progress callback for reporting written documents.
     * Called after each batch is successfully written.
     * @param writtenInBatch - Number of documents written in the current batch
     */
    progressCallback?: (writtenInBatch: number) => void;

    /**
     * Optional abort signal to cancel the write operation.
     * The writer will check this signal during retry loops and throw
     * an appropriate error if cancellation is requested.
     */
    abortSignal?: AbortSignal;
}

/**
 * Result of a bulk write operation.
 */
export interface BulkWriteResult {
    /**
     * Number of documents successfully inserted.
     */
    insertedCount: number;

    /**
     * Array of errors that occurred during the write operation.
     */
    errors: Array<{ documentId?: string; error: Error }> | null; // Should be typed more specifically based on the implementation
}

/**
 * Result of ensuring a collection exists.
 */
export interface EnsureCollectionExistsResult {
    /**
     * Whether the collection had to be created (true) or already existed (false).
     */
    collectionWasCreated: boolean;
}

/**
 * Interface for writing documents to a target collection.
 */
export interface DocumentWriter {
    /**
     * Writes documents in bulk to the target collection.
     *
     * @param connectionId Connection identifier for the target
     * @param databaseName Name of the target database
     * @param collectionName Name of the target collection
     * @param documents Array of documents to write
     * @param options Optional write options
     * @returns Promise resolving to the write result
     */
    writeDocuments(
        connectionId: string,
        databaseName: string,
        collectionName: string,
        config: CopyPasteConfig,
        documents: DocumentDetails[],
        options?: DocumentWriterOptions,
    ): Promise<BulkWriteResult>;

    /**
     * Gets the optimal buffer size for reading documents.
     * The task can use this to optimize its read buffer size to match the writer's current capacity.
     *
     * @returns Optimal buffer size (matches current write batch capacity)
     */
    getOptimalBufferSize(): number;

    /**
     * Ensures the target collection exists before writing.
     * May need methods for pre-flight checks or setup.
     *
     * @param connectionId Connection identifier for the target
     * @param databaseName Name of the target database
     * @param collectionName Name of the target collection
     * @returns Promise resolving to information about whether the collection was created
     */
    ensureCollectionExists(
        connectionId: string,
        databaseName: string,
        collectionName: string,
    ): Promise<EnsureCollectionExistsResult>;
}
