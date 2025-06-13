/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a single document for copy-paste operations
 */
export interface DocumentDetails {
    /**
     * The document's unique identifier (e.g., _id in MongoDB)
     */
    id: unknown;

    /**
     * The document content, treated as opaque data by the core task logic.
     * Specific readers/writers will know how to interpret/serialize this.
     * For MongoDB, this would typically be a BSON document.
     */
    documentContent: unknown;
}

/**
 * Interface for reading documents from a source collection
 */
export interface DocumentReader {
    /**
     * Streams documents from the source collection
     * @param connectionId Connection identifier
     * @param databaseName Database name
     * @param collectionName Collection name
     * @returns AsyncIterable of documents
     */
    streamDocuments(
        connectionId: string,
        databaseName: string,
        collectionName: string,
    ): AsyncIterable<DocumentDetails>;

    /**
     * Counts documents in the source collection for progress calculation
     * @param connectionId Connection identifier
     * @param databaseName Database name
     * @param collectionName Collection name
     * @returns Promise resolving to the number of documents
     */
    countDocuments(connectionId: string, databaseName: string, collectionName: string): Promise<number>;
}

/**
 * Options for document writer operations
 */
export interface DocumentWriterOptions {
    /**
     * Batch size for bulk operations
     */
    batchSize?: number;

    /**
     * Additional options for future expansion
     */
    [key: string]: unknown;
}

/**
 * Result of a bulk write operation
 */
export interface BulkWriteResult {
    /**
     * Number of documents successfully inserted
     */
    insertedCount: number;

    /**
     * Array of errors that occurred during the write operation
     */
    errors: Array<{
        /**
         * Document ID that caused the error (if available)
         */
        documentId?: unknown;

        /**
         * The error that occurred
         */
        error: Error;
    }>;
}

/**
 * Interface for writing documents to a target collection
 */
export interface DocumentWriter {
    /**
     * Writes documents in bulk to the target collection
     * @param connectionId Connection identifier
     * @param databaseName Database name
     * @param collectionName Collection name
     * @param documents Array of documents to write
     * @param options Optional write options
     * @returns Promise resolving to the write result
     */
    writeDocuments(
        connectionId: string,
        databaseName: string,
        collectionName: string,
        documents: DocumentDetails[],
        options?: DocumentWriterOptions,
    ): Promise<BulkWriteResult>;

    /**
     * Ensures the target collection exists, creating it if necessary
     * @param connectionId Connection identifier
     * @param databaseName Database name
     * @param collectionName Collection name
     * @returns Promise that resolves when the collection is ensured to exist
     */
    ensureCollectionExists(connectionId: string, databaseName: string, collectionName: string): Promise<void>;
}