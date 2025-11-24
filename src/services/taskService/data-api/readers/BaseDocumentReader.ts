/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import Denque from 'denque';
import { l10n } from 'vscode';
import { ext } from '../../../../extensionVariables';
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
            yield* this.streamDocumentsFromDatabase(options?.signal, options?.actionContext);
            return;
        }

        // Keep-alive enabled: buffer-based streaming with periodic refills
        const buffer = new Denque<DocumentDetails>();
        const intervalMs = options.keepAliveIntervalMs ?? 10000;
        const timeoutMs = options.keepAliveTimeoutMs ?? 600000; // 10 minutes default
        const streamStartTime = Date.now();
        let lastDatabaseReadAccess = Date.now();
        let dbIterator: AsyncIterator<DocumentDetails> | null = null;
        let keepAliveTimer: NodeJS.Timeout | null = null;
        let keepAliveReadCount = 0;
        let maxBufferLength = 0;
        let timedOut = false; // Flag to signal timeout from keep-alive callback to main loop

        try {
            // Start database stream
            dbIterator = this.streamDocumentsFromDatabase(options.signal, options.actionContext)[
                Symbol.asyncIterator
            ]();

            // Start keep-alive timer: periodically refill buffer to maintain database connection
            keepAliveTimer = setInterval(() => {
                void (async () => {
                    // Check if keep-alive has been running too long
                    const keepAliveElapsedMs = Date.now() - streamStartTime;
                    if (keepAliveElapsedMs >= timeoutMs) {
                        // Keep-alive timeout exceeded - abort the operation
                        if (dbIterator) {
                            await dbIterator.return?.();
                        }
                        const errorMessage = l10n.t(
                            'Keep-alive timeout exceeded: stream has been running for {0} seconds (limit: {1} seconds)',
                            Math.floor(keepAliveElapsedMs / 1000).toString(),
                            Math.floor(timeoutMs / 1000).toString(),
                        );
                        ext.outputChannel.error(l10n.t('[Reader] {0}', errorMessage));
                        timedOut = true;
                        return;
                    }

                    // Fetch if enough time has passed since last yield (regardless of buffer state)
                    // This ensures we "tickle" the database cursor regularly to prevent timeouts
                    const timeSinceLastYield = Date.now() - lastDatabaseReadAccess;
                    if (timeSinceLastYield >= intervalMs && dbIterator) {
                        try {
                            const result = await dbIterator.next();
                            if (!result.done) {
                                buffer.push(result.value);
                                keepAliveReadCount++;

                                // Track maximum buffer length for telemetry
                                const currentBufferLength = buffer.length;
                                if (currentBufferLength > maxBufferLength) {
                                    maxBufferLength = currentBufferLength;
                                }

                                // Trace keep-alive read activity
                                ext.outputChannel.trace(
                                    l10n.t(
                                        '[Reader] Keep-alive read: count={0}, buffer length={1}',
                                        keepAliveReadCount.toString(),
                                        currentBufferLength.toString(),
                                    ),
                                );
                            }
                        } catch {
                            // Silently ignore background fetch errors
                            // Persistent errors will surface when main loop calls dbIterator.next()
                        }
                    } else if (timeSinceLastYield < intervalMs) {
                        // Trace skipped keep-alive execution
                        ext.outputChannel.trace(
                            l10n.t(
                                '[Reader] Keep-alive skipped: only {0}s since last database read access (interval: {1}s)',
                                Math.floor(timeSinceLastYield / 1000).toString(),
                                Math.floor(intervalMs / 1000).toString(),
                            ),
                        );
                    }
                })();
            }, intervalMs);

            // Unified control loop: queue-first, DB-fallback
            while (!options.signal?.aborted) {
                // Check for timeout from keep-alive callback
                if (timedOut) {
                    throw new Error(l10n.t('Keep-alive timeout exceeded'));
                }

                // 1. Try buffer first (already pre-fetched by keep-alive)
                if (!buffer.isEmpty()) {
                    const doc = buffer.shift();
                    if (doc) {
                        // Trace buffer read with remaining size
                        ext.outputChannel.trace(
                            l10n.t('[Reader] Read from buffer, remaining: {0} documents', buffer.length),
                        );

                        yield doc;
                        continue;
                    }
                }

                // 2. Buffer empty, fetch directly from database
                const result = await dbIterator.next();
                if (result.done) {
                    break;
                }

                yield result.value;
                lastDatabaseReadAccess = Date.now();
            }
        } finally {
            // Record telemetry for keep-alive usage
            if (options.actionContext && keepAliveReadCount > 0) {
                options.actionContext.telemetry.measurements.keepAliveReadCount = keepAliveReadCount;
                options.actionContext.telemetry.measurements.maxBufferLength = maxBufferLength;
            }

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
     * @param signal Optional AbortSignal for canceling the count operation
     * @param actionContext Optional action context for telemetry collection
     * @returns Promise resolving to the number of documents
     *
     * @example
     * // Counting documents in Azure Cosmos DB for MongoDB (vCore)
     * const reader = new DocumentDbDocumentReader(connectionId, dbName, collectionName);
     * const count = await reader.countDocuments();
     * console.log(`Total documents: ${count}`);
     */
    public async countDocuments(signal?: AbortSignal, actionContext?: IActionContext): Promise<number> {
        ext.outputChannel.trace(
            l10n.t('[Reader] Counting documents in {0}.{1}', this.databaseName, this.collectionName),
        );

        const count = await this.countDocumentsInDatabase(signal, actionContext);

        ext.outputChannel.trace(l10n.t('[Reader] Document count result: {0} documents', count.toString()));

        return count;
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
     * - Use actionContext for telemetry if needed (optional)
     *
     * @param signal Optional AbortSignal for canceling the stream
     * @param actionContext Optional action context for telemetry collection
     * @returns AsyncIterable of document details
     *
     * @example
     * // Azure Cosmos DB for MongoDB API implementation
     * protected async *streamDocumentsFromDatabase(signal?: AbortSignal, actionContext?: IActionContext) {
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
    protected abstract streamDocumentsFromDatabase(
        signal?: AbortSignal,
        actionContext?: IActionContext,
    ): AsyncIterable<DocumentDetails>;

    /**
     * Counts documents in the database-specific collection.
     *
     * EXPECTED BEHAVIOR:
     * - Connect to the database using implementation-specific connection mechanism
     * - Query the collection specified in the constructor for total document count
     * - Return the count efficiently (metadata-based if available)
     * - Support cancellation via optional AbortSignal
     *
     * IMPLEMENTATION GUIDELINES:
     * - Use fast count methods when available (e.g., estimatedDocumentCount)
     * - Prefer O(1) metadata-based counts over O(n) collection scans
     * - For filtered queries, use exact count methods as needed
     * - Handle connection errors gracefully
     * - Pass AbortSignal to database client if supported
     * - Use this.databaseName and this.collectionName from constructor
     * - Use actionContext for telemetry if needed (optional)
     *
     * @param signal Optional AbortSignal for canceling the count operation
     * @param actionContext Optional action context for telemetry collection
     * @returns Promise resolving to the document count
     *
     * @example
     * // Azure Cosmos DB for MongoDB API implementation
     * protected async countDocumentsInDatabase(signal?: AbortSignal, actionContext?: IActionContext) {
     *   const client = await ClustersClient.getClient(this.connectionId);
     *   // Use estimated count for O(1) performance
     *   return await client.estimateDocumentCount(this.databaseName, this.collectionName);
     * }
     */
    protected abstract countDocumentsInDatabase(signal?: AbortSignal, actionContext?: IActionContext): Promise<number>;
}
