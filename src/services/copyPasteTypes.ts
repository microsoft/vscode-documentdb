/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Conflict resolution strategies for copy-paste operations
 */
export enum ConflictResolutionStrategy {
    /**
     * Abort the operation if any conflict is encountered
     */
    Abort = 'abort',
    // Future options:
    // Overwrite = 'overwrite',
    // Skip = 'skip'
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
     * Conflict resolution strategy
     */
    onConflict: ConflictResolutionStrategy;

    /**
     * Optional reference to a connection manager or client object.
     * For now, this is typed as `unknown` to allow flexibility.
     * Specific task implementations (e.g., for MongoDB) will cast this to their
     * required client/connection type.
     */
    connectionManager?: unknown;
}

/**
 * Represents a single document for copy-paste operations
 */
export interface DocumentDetails {
    /**
     * The document's unique identifier (e.g., _id in MongoDB)
     */
    id: unknown;

    /**
     * The document content as opaque data
     * For MongoDB, this would typically be a BSON document
     */
    documentContent: unknown;
}

/**
 * Interface for reading documents from a source
 */
export interface DocumentReader {
    /**
     * Streams documents from the source collection
     */
    streamDocuments(
        connectionId: string,
        databaseName: string,
        collectionName: string,
    ): AsyncIterable<DocumentDetails>;

    /**
     * Counts documents in the source collection for progress calculation
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
}

/**
 * Result of bulk write operations
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
        documentId?: unknown;
        error: Error;
    }>;
}

/**
 * Interface for writing documents to a target
 */
export interface DocumentWriter {
    /**
     * Writes documents in bulk to the target collection
     */
    writeDocuments(
        connectionId: string,
        databaseName: string,
        collectionName: string,
        documents: DocumentDetails[],
        options?: DocumentWriterOptions,
    ): Promise<BulkWriteResult>;

    /**
     * Ensures the target collection exists
     */
    ensureCollectionExists(connectionId: string, databaseName: string, collectionName: string): Promise<void>;
}