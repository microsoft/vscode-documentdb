/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DocumentDetails, type DocumentReader } from '../types';

/**
 * Abstract base class for DocumentReader implementations.
 *
 * Provides a template for database-specific readers with:
 * - Standardized database and collection parameters
 * - Clear separation between streaming and counting operations
 * - Database-agnostic interface for higher-level components
 *
 * Subclasses implement database-specific operations via abstract hooks:
 * - streamDocumentsFromDatabase(): Connect to database and stream documents
 * - countDocumentsInDatabase(): Query database for document count
 *
 * Connection management is left to subclasses since different databases
 * have different connection models (e.g., connection strings, clients, pools).
 */
export abstract class BaseDocumentReader implements DocumentReader {
    /** Source database name */
    protected readonly databaseName: string;

    /** Source collection name */
    protected readonly collectionName: string;

    protected constructor(databaseName: string, collectionName: string) {
        this.databaseName = databaseName;
        this.collectionName = collectionName;
    }

    /**
     * Streams documents from the source collection.
     *
     * This is the main entry point for reading documents. It delegates to the
     * database-specific implementation to handle connection and streaming.
     *
     * Uses the database and collection names provided in the constructor.
     *
     * @returns AsyncIterable of documents
     *
     * @example
     * // Reading documents from Azure Cosmos DB for MongoDB (vCore)
     * const reader = new DocumentDbDocumentReader(connectionId, dbName, collectionName);
     * for await (const doc of reader.streamDocuments()) {
     *   console.log(`Read document: ${doc.id}`);
     * }
     */
    public async *streamDocuments(): AsyncIterable<DocumentDetails> {
        yield* this.streamDocumentsFromDatabase();
    }

    /**
     * Counts documents in the source collection for progress calculation.
     *
     * This method delegates to the database-specific implementation to query
     * the collection and return the total document count.
     *
     * Uses the database and collection names provided in the constructor.
     *
     * @returns Promise resolving to the number of documents
     *
     * @example
     * // Counting documents in Azure Cosmos DB for MongoDB (vCore)
     * const reader = new DocumentDbDocumentReader(connectionId, dbName, collectionName);
     * const count = await reader.countDocuments();
     * console.log(`Total documents: ${count}`);
     */
    public async countDocuments(): Promise<number> {
        return await this.countDocumentsInDatabase();
    }

    // ==================== ABSTRACT HOOKS ====================

    /**
     * Streams documents from the database-specific collection.
     *
     * EXPECTED BEHAVIOR:
     * - Connect to the database using implementation-specific connection mechanism
     * - Stream all documents from the collection specified in the constructor
     * - Convert each document to DocumentDetails format
     * - Yield documents one at a time for memory-efficient processing
     *
     * IMPLEMENTATION GUIDELINES:
     * - Use database-specific streaming APIs (e.g., MongoDB cursor)
     * - Extract document ID and full document content
     * - Handle connection errors gracefully
     * - Support cancellation if needed (via AbortSignal)
     * - Use this.databaseName and this.collectionName from constructor
     *
     * @returns AsyncIterable of document details
     *
     * @example
     * // Azure Cosmos DB for MongoDB API implementation
     * protected async *streamDocumentsFromDatabase() {
     *   const client = await ClustersClient.getClient(this.connectionId);
     *   const documentStream = client.streamDocuments(
     *     this.databaseName,
     *     this.collectionName,
     *     abortSignal
     *   );
     *
     *   for await (const document of documentStream) {
     *     yield {
     *       id: document._id,
     *       documentContent: document
     *     };
     *   }
     * }
     */
    protected abstract streamDocumentsFromDatabase(): AsyncIterable<DocumentDetails>;

    /**
     * Counts documents in the database-specific collection.
     *
     * EXPECTED BEHAVIOR:
     * - Connect to the database using implementation-specific connection mechanism
     * - Query the collection specified in the constructor for total document count
     * - Return the count efficiently (metadata-based if available)
     *
     * IMPLEMENTATION GUIDELINES:
     * - Use fast count methods when available (e.g., estimatedDocumentCount)
     * - Prefer O(1) metadata-based counts over O(n) collection scans
     * - For filtered queries, use exact count methods as needed
     * - Handle connection errors gracefully
     * - Use this.databaseName and this.collectionName from constructor
     *
     * @returns Promise resolving to the document count
     *
     * @example
     * // Azure Cosmos DB for MongoDB API implementation
     * protected async countDocumentsInDatabase() {
     *   const client = await ClustersClient.getClient(this.connectionId);
     *   // Use estimated count for O(1) performance
     *   return await client.estimateDocumentCount(this.databaseName, this.collectionName);
     * }
     */
    protected abstract countDocumentsInDatabase(): Promise<number>;
}
