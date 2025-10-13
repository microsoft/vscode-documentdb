/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Denque from 'denque';
import { type DocumentDetails, type DocumentReader, type DocumentReaderOptions } from '../types';

/**
 * Abstract base class for DocumentReader implementations.
 *
 * Provides a template for database-specific readers with:
 * - Standardized database and collection parameters
 * - Clear separation between streaming and counting operations
 * - Database-agnostic interface for higher-level components
 * - Optional keep-alive buffering for maintaining steady read rate
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
     * When keep-alive is enabled, maintains a buffer with periodic refills to
     * prevent connection/cursor timeouts during slow consumption.
     *
     * Uses the database and collection names provided in the constructor.
     *
     * @param options Optional streaming options (signal, keep-alive)
     * @returns AsyncIterable of documents
     *
     * @example
     * // Reading documents without keep-alive
     * const reader = new DocumentDbDocumentReader(connectionId, dbName, collectionName);
     * for await (const doc of reader.streamDocuments()) {
     *   console.log(`Read document: ${doc.id}`);
     * }
     *
     * @example
     * // Reading documents with keep-alive to prevent timeouts
     * const signal = new AbortController().signal;
     * for await (const doc of reader.streamDocuments({ signal, keepAlive: true })) {
     *   // Slow processing - keep-alive maintains connection
     *   await processDocument(doc);
     * }
     */
    public async *streamDocuments(options?: DocumentReaderOptions): AsyncIterable<DocumentDetails> {
        // No keep-alive requested: direct passthrough to database
        if (!options?.keepAlive) {
            yield* this.streamDocumentsFromDatabase(options?.signal);
            return;
        }

        // Keep-alive enabled: buffer-based streaming with periodic refills
        const buffer = new Denque<DocumentDetails>();
        const intervalMs = options.keepAliveIntervalMs ?? 10000;
        let lastYieldTimestamp = Date.now();
        let dbIterator: AsyncIterator<DocumentDetails> | null = null;
        let keepAliveTimer: NodeJS.Timeout | null = null;

        try {
            // Start database stream
            dbIterator = this.streamDocumentsFromDatabase(options.signal)[Symbol.asyncIterator]();

            // Start keep-alive timer: periodically refill buffer to maintain database connection
            keepAliveTimer = setInterval(() => {
                void (async () => {
                    // Fetch if enough time has passed since last yield (regardless of buffer state)
                    // This ensures we "tickle" the database cursor regularly to prevent timeouts
                    const timeSinceLastYield = Date.now() - lastYieldTimestamp;
                    if (timeSinceLastYield >= intervalMs && dbIterator) {
                        try {
                            const result = await dbIterator.next();
                            if (!result.done) {
                                buffer.push(result.value);
                            }
                        } catch {
                            // Silently ignore background fetch errors
                            // Persistent errors will surface when main loop calls dbIterator.next()
                        }
                    }
                })();
            }, intervalMs);

            // Unified control loop: queue-first, DB-fallback
            while (!options.signal?.aborted) {
                // 1. Try buffer first (already pre-fetched by keep-alive)
                if (!buffer.isEmpty()) {
                    const doc = buffer.shift();
                    if (doc) {
                        yield doc;
                        lastYieldTimestamp = Date.now();
                        continue;
                    }
                }

                // 2. Buffer empty, fetch directly from database
                const result = await dbIterator.next();
                if (result.done) {
                    break;
                }

                yield result.value;
                lastYieldTimestamp = Date.now();
            }
        } finally {
            // Cleanup resources
            if (keepAliveTimer) {
                clearInterval(keepAliveTimer);
            }
            if (dbIterator) {
                await dbIterator.return?.();
            }
        }
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
     * - Support cancellation via optional AbortSignal
     *
     * IMPLEMENTATION GUIDELINES:
     * - Use database-specific streaming APIs (e.g., MongoDB cursor)
     * - Extract document ID and full document content
     * - Handle connection errors gracefully
     * - Pass AbortSignal to database client if supported
     * - Use this.databaseName and this.collectionName from constructor
     *
     * @param signal Optional AbortSignal for canceling the stream
     * @returns AsyncIterable of document details
     *
     * @example
     * // Azure Cosmos DB for MongoDB API implementation
     * protected async *streamDocumentsFromDatabase(signal?: AbortSignal) {
     *   const client = await ClustersClient.getClient(this.connectionId);
     *   const documentStream = client.streamDocuments(
     *     this.databaseName,
     *     this.collectionName,
     *     signal
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
    protected abstract streamDocumentsFromDatabase(signal?: AbortSignal): AsyncIterable<DocumentDetails>;

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
