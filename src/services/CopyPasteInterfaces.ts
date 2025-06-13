/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a single document with its unique identifier and content
 */
export interface DocumentDetails {
    /**
     * The document's unique identifier (e.g., _id in MongoDB)
     */
    id: unknown;

    /**
     * The document content as opaque data
     * Specific readers/writers will know how to interpret/serialize this
     */
    documentContent: unknown;
}

/**
 * Interface for streaming documents from a source
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
 * Options for document writing operations
 */
export interface DocumentWriterOptions {
    /**
     * Batch size for bulk operations
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
     * Errors that occurred during the write operation
     */
    errors: Array<{
        documentId?: unknown;
        error: Error;
    }>;
}

/**
 * Interface for writing documents to a target collection
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

/**
 * Conflict resolution strategy for copy-paste operations
 */
export enum ConflictResolutionStrategy {
    /**
     * Abort the operation on any error or conflict
     */
    Abort = 'abort',
    // Future options could include:
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
     * Optional connection manager or client object
     * Typed as any for flexibility - specific implementations can cast to their required type
     */
    connectionManager?: unknown;
}