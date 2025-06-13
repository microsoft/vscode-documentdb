/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Conflict resolution strategies for copy-paste operations
 */
export enum ConflictResolutionStrategy {
    /**
     * Abort the operation on any error or conflict
     */
    Abort = 'abort',
    // Future options: Overwrite = 'overwrite', Skip = 'skip'
}

/**
 * Configuration for copy-paste operations
 */
export interface CopyPasteConfig {
    /**
     * Source collection information
     */
    source: {
        connectionId: string;
        databaseName: string;
        collectionName: string;
    };

    /**
     * Target collection information
     */
    target: {
        connectionId: string;
        databaseName: string;
        collectionName: string;
    };

    /**
     * Conflict resolution strategy - initially only Abort is supported
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
 * Represents a single document with its unique identifier and content
 */
export interface DocumentDetails {
    /**
     * The document's unique identifier (e.g., _id in MongoDB)
     */
    id: unknown;

    /**
     * The document content is treated as opaque data by the core task logic.
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
     *
     * @param connectionId - Connection identifier
     * @param databaseName - Name of the database
     * @param collectionName - Name of the collection
     * @returns An async iterable of documents
     */
    streamDocuments(
        connectionId: string,
        databaseName: string,
        collectionName: string,
    ): AsyncIterable<DocumentDetails>;

    /**
     * Counts documents in the source collection for progress calculation
     *
     * @param connectionId - Connection identifier
     * @param databaseName - Name of the database
     * @param collectionName - Name of the collection
     * @returns Promise resolving to the total number of documents
     */
    countDocuments(connectionId: string, databaseName: string, collectionName: string): Promise<number>;
}

/**
 * Options for document writing operations
 */
export interface DocumentWriterOptions {
    /**
     * Batch size for bulk operations - initially simple configuration
     * Future enhancements may add conflict handling details
     */
    batchSize?: number;
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
     * Array of errors that occurred during the operation
     */
    errors: Array<{
        /**
         * Document ID that caused the error (if available)
         */
        documentId?: unknown;

        /**
         * The error that occurred
         */
        error: unknown;
    }>;
}

/**
 * Interface for writing documents to a target collection
 */
export interface DocumentWriter {
    /**
     * Writes documents in bulk to the target collection
     *
     * @param connectionId - Connection identifier
     * @param databaseName - Name of the database
     * @param collectionName - Name of the collection
     * @param documents - Array of documents to write
     * @param options - Optional configuration for the write operation
     * @returns Promise resolving to the bulk write result
     */
    writeDocuments(
        connectionId: string,
        databaseName: string,
        collectionName: string,
        documents: DocumentDetails[],
        options?: DocumentWriterOptions,
    ): Promise<BulkWriteResult>;

    /**
     * Ensures the target collection exists before writing
     * May be used for pre-flight checks or setup
     *
     * @param connectionId - Connection identifier
     * @param databaseName - Name of the database
     * @param collectionName - Name of the collection
     * @returns Promise that resolves when the collection is ready
     */
    ensureCollectionExists(connectionId: string, databaseName: string, collectionName: string): Promise<void>;
}