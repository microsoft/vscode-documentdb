/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Enumeration of conflict resolution strategies for copy-paste operations.
 */
export enum ConflictResolutionStrategy {
    /**
     * Abort the operation if any conflict or error occurs.
     */
    Abort = 'abort',
    // Future options: Overwrite = 'overwrite', Skip = 'skip'
}

/**
 * Configuration object for copy-paste operations.
 */
export interface CopyPasteConfig {
    /**
     * Source collection information.
     */
    source: {
        connectionId: string;
        databaseName: string;
        collectionName: string;
    };

    /**
     * Target collection information.
     */
    target: {
        connectionId: string;
        databaseName: string;
        collectionName: string;
    };

    /**
     * Conflict resolution strategy.
     * For this basic implementation, only ConflictResolutionStrategy.Abort is supported.
     */
    onConflict: ConflictResolutionStrategy;

    /**
     * Optional reference to a connection manager or client object.
     * For now, this is typed as `unknown` to allow flexibility.
     * Specific task implementations (e.g., for MongoDB) will cast this to their
     * required client/connection type. A more generic interface or base class
     * for connection management might be introduced later.
     * This allows the task to potentially reuse existing connections or manage
     * them more effectively if needed, beyond just using connectionId.
     */
    connectionManager?: unknown; // e.g. could be cast to a MongoDB client instance
}

/**
 * Represents a single document in the copy-paste operation.
 */
export interface DocumentDetails {
    /**
     * The document's unique identifier (e.g., _id in MongoDB).
     * This is crucial for conflict resolution and tracking.
     */
    id: unknown;

    /**
     * The document content treated as opaque data by the core task logic.
     * Specific readers/writers will know how to interpret/serialize this.
     * For MongoDB, this would typically be a BSON document.
     */
    documentContent: unknown;
}

/**
 * Interface for reading documents from a source collection.
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
    streamDocuments(
        connectionId: string,
        databaseName: string,
        collectionName: string,
    ): AsyncIterable<DocumentDetails>;

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
 * Options for document writing operations.
 */
export interface DocumentWriterOptions {
    /**
     * Batch size for bulk write operations.
     * Initially simple, conflict handling details will be added in a later task.
     */
    batchSize?: number;
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
    errors: Array<{
        /**
         * Optional document ID that caused the error.
         */
        documentId?: unknown;

        /**
         * Error that occurred.
         */
        error: Error;
    }>;
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
        documents: DocumentDetails[],
        options?: DocumentWriterOptions,
    ): Promise<BulkWriteResult>;

    /**
     * Ensures the target collection exists before writing.
     * May need methods for pre-flight checks or setup.
     *
     * @param connectionId Connection identifier for the target
     * @param databaseName Name of the target database
     * @param collectionName Name of the target collection
     * @returns Promise that resolves when the collection is ready
     */
    ensureCollectionExists(connectionId: string, databaseName: string, collectionName: string): Promise<void>;
}