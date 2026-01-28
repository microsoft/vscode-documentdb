/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { l10n } from 'vscode';
import { ext } from '../../../../extensionVariables';
import { type DocumentDetails, type DocumentReader, type DocumentReaderOptions } from '../types';
import { KeepAliveOrchestrator } from './KeepAliveOrchestrator';

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
     * When keep-alive is enabled, uses KeepAliveOrchestrator to maintain
     * cursor activity during slow consumption.
     *
     * Uses the database and collection names provided in the constructor.
     *
     * ## Sequence Diagrams
     *
     * ### Direct Mode (No Keep-Alive)
     *
     * ```
     * Consumer              BaseDocumentReader           Database
     *    │                        │                         │
     *    │ streamDocuments()      │                         │
     *    │───────────────────────>│                         │
     *    │                        │ streamDocumentsFromDatabase()
     *    │                        │────────────────────────>│
     *    │                        │                         │
     *    │                        │<── document stream      │
     *    │<── yield doc           │                         │
     *    │<── yield doc           │                         │
     *    │<── yield doc           │                         │
     *    │<── done                │                         │
     * ```
     *
     * ### Keep-Alive Mode
     *
     * When keep-alive is enabled, the KeepAliveOrchestrator periodically reads
     * from the database to prevent cursor timeouts during slow consumption:
     *
     * ```
     * Consumer              BaseDocumentReader         KeepAliveOrchestrator       Database
     *    │                        │                           │                       │
     *    │ streamDocuments()      │                           │                       │
     *    │───────────────────────>│                           │                       │
     *    │                        │ orchestrator.start()      │                       │
     *    │                        │──────────────────────────>│                       │
     *    │                        │                           │ (start timer)         │
     *    │                        │                           │                       │
     *    │                        │ orchestrator.next()       │                       │
     *    │                        │──────────────────────────>│                       │
     *    │                        │                           │ iterator.next()       │
     *    │                        │                           │──────────────────────>│
     *    │                        │                           │<── document           │
     *    │<── yield doc           │<── document               │                       │
     *    │                        │                           │                       │
     *    │ (slow processing...)   │                           │                       │
     *    │                        │                           │ [timer fires]         │
     *    │                        │                           │ iterator.next()       │
     *    │                        │                           │──────────────────────>│
     *    │                        │                           │<── document           │
     *    │                        │                           │ (buffer document)     │
     *    │                        │                           │                       │
     *    │                        │ orchestrator.next()       │                       │
     *    │                        │──────────────────────────>│                       │
     *    │                        │                           │ (return from buffer)  │
     *    │<── yield doc           │<── document               │                       │
     *    │                        │                           │                       │
     *    │                        │ orchestrator.stop()       │                       │
     *    │                        │──────────────────────────>│                       │
     *    │                        │                           │ (cleanup timer)       │
     *    │<── done                │<── stats                  │                       │
     * ```
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

        // Keep-alive enabled: use orchestrator for buffer management
        const orchestrator = new KeepAliveOrchestrator({
            intervalMs: options.keepAliveIntervalMs,
            timeoutMs: options.keepAliveTimeoutMs,
        });

        try {
            // Start database stream with orchestrator
            const dbIterator = this.streamDocumentsFromDatabase(options.signal, options.actionContext)[
                Symbol.asyncIterator
            ]();
            orchestrator.start(dbIterator);

            // Stream documents through orchestrator
            while (!options.signal?.aborted) {
                const result = await orchestrator.next(options.signal);
                if (result.done) {
                    break;
                }
                yield result.value;
            }
        } finally {
            // Stop orchestrator and record telemetry
            const stats = await orchestrator.stop();

            if (options.actionContext && stats.keepAliveReadCount > 0) {
                options.actionContext.telemetry.measurements.keepAliveReadCount = stats.keepAliveReadCount;
                options.actionContext.telemetry.measurements.maxBufferLength = stats.maxBufferLength;
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
