/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a single document with its ID and content
 */
export interface DocumentDetails {
    /** The document's unique identifier (e.g., _id in MongoDB) */
    id: unknown;
    /** The document content as opaque data */
    documentContent: unknown;
}

/**
 * Options for document writing operations
 */
export interface DocumentWriterOptions {
    /** Batch size for bulk operations */
    batchSize?: number;
}

/**
 * Result of a bulk write operation
 */
export interface BulkWriteResult {
    /** Number of documents successfully inserted */
    insertedCount: number;
    /** Array of errors that occurred during the operation */
    errors: Array<{ documentId?: unknown; error: Error }>;
}

/**
 * Interface for reading documents from a data source
 */
export interface DocumentReader {
    /**
     * Streams documents from the source
     * @param connectionId Connection identifier
     * @param databaseName Database name
     * @param collectionName Collection name
     * @returns Async iterable of documents
     */
    streamDocuments(
        connectionId: string,
        databaseName: string,
        collectionName: string,
    ): AsyncIterable<DocumentDetails>;

    /**
     * Counts documents in the source for progress calculation
     * @param connectionId Connection identifier
     * @param databaseName Database name
     * @param collectionName Collection name
     * @returns Total number of documents
     */
    countDocuments(connectionId: string, databaseName: string, collectionName: string): Promise<number>;
}

/**
 * Interface for writing documents to a data target
 */
export interface DocumentWriter {
    /**
     * Writes documents in bulk to the target
     * @param connectionId Connection identifier
     * @param databaseName Database name
     * @param collectionName Collection name
     * @param documents Array of documents to write
     * @param options Optional writer options
     * @returns Result of the bulk write operation
     */
    writeDocuments(
        connectionId: string,
        databaseName: string,
        collectionName: string,
        documents: DocumentDetails[],
        options?: DocumentWriterOptions,
    ): Promise<BulkWriteResult>;
}