/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Document, type InsertManyResult, type WithId, type WriteError } from 'mongodb';
import { ClustersClient, isMongoBulkWriteError } from '../documentdb/ClustersClient';
import {
    ConflictResolutionStrategy,
    type BulkWriteResult,
    type CopyPasteConfig,
    type DocumentDetails,
    type DocumentReader,
    type DocumentWriter,
    type DocumentWriterOptions,
} from '../utils/copyPasteUtils';

/**
 * MongoDB-specific implementation of DocumentReader.
 */
export class MongoDocumentReader implements DocumentReader {
    /**
     * Streams documents from a MongoDB collection.
     *
     * @param connectionId Connection identifier to get the MongoDB client
     * @param databaseName Name of the database
     * @param collectionName Name of the collection
     * @returns AsyncIterable of document details
     */
    async *streamDocuments(
        connectionId: string,
        databaseName: string,
        collectionName: string,
    ): AsyncIterable<DocumentDetails> {
        const client = await ClustersClient.getClient(connectionId);

        const documentStream = client.streamDocuments(databaseName, collectionName, new AbortController().signal);
        for await (const document of documentStream) {
            yield {
                id: (document as WithId<Document>)._id,
                documentContent: document,
            };
        }
    }

    /**
     * Counts the total number of documents in a MongoDB collection.
     *
     * @param connectionId Connection identifier to get the MongoDB client
     * @param databaseName Name of the database
     * @param collectionName Name of the collection,
     * @param filter Optional filter to apply to the count operation (default is '{}')
     * @returns Promise resolving to the document count
     */
    async countDocuments(
        connectionId: string,
        databaseName: string,
        collectionName: string,
        filter: string = '{}',
    ): Promise<number> {
        const client = await ClustersClient.getClient(connectionId);
        return await client.countDocuments(databaseName, collectionName, filter);
    }
}

/**
 * MongoDB-specific implementation of DocumentWriter.
 */
export class MongoDocumentWriter implements DocumentWriter {
    /**
     * Writes documents to a MongoDB collection using bulk operations.
     *
     * @param connectionId Connection identifier to get the MongoDB client
     * @param databaseName Name of the target database
     * @param collectionName Name of the target collection
     * @param documents Array of documents to write
     * @param options Optional write options
     * @returns Promise resolving to the bulk write result
     */
    async writeDocuments(
        connectionId: string,
        databaseName: string,
        collectionName: string,
        config: CopyPasteConfig,
        documents: DocumentDetails[],
        _options?: DocumentWriterOptions,
    ): Promise<BulkWriteResult> {
        if (documents.length === 0) {
            return {
                insertedCount: 0,
                errors: [],
            };
        }

        try {
            const client = await ClustersClient.getClient(connectionId);

            // Convert DocumentDetails to MongoDB documents
            const mongoDocuments = documents.map((doc) => doc.documentContent as WithId<Document>);
            let insertResult: InsertManyResult;

            switch (config.onConflict) {
                case ConflictResolutionStrategy.Skip:
                    insertResult = await client.insertDocuments(databaseName, collectionName, mongoDocuments, false);
                    break;
                case ConflictResolutionStrategy.Abort:
                    insertResult = await client.insertDocuments(databaseName, collectionName, mongoDocuments, false);
                    break;
                default:
                    throw new Error(`Unsupported conflict resolution strategy: ${config.onConflict}`);
            }

            return {
                insertedCount: insertResult.insertedCount,
                errors: null, // MongoDB bulk write errors will be handled in the catch block
            };
        } catch (error: unknown) {
            if (isMongoBulkWriteError(error)) {
                // Handle MongoDB bulk write errors
                const writeErrorsArray = (
                    Array.isArray(error.writeErrors) ? error.writeErrors : [error.writeErrors]
                ) as Array<WriteError>;
                return {
                    insertedCount: error.result.insertedCount,
                    errors: writeErrorsArray.map((writeError) => ({
                        documentId: (writeError.getOperation()._id as string) || undefined,
                        error: new Error(writeError.errmsg || 'Unknown write error'),
                    })),
                };
            } else if (error instanceof Error) {
                return {
                    insertedCount: 0,
                    errors: [{ documentId: undefined, error }],
                };
            } else {
                // Handle unknown error types
                return {
                    insertedCount: 0,
                    errors: [{ documentId: undefined, error: new Error(String(error)) }],
                };
            }
        }
    }

    /**
     * Ensures the target collection exists in MongoDB.
     *
     * @param connectionId Connection identifier to get the MongoDB client
     * @param databaseName Name of the target database
     * @param collectionName Name of the target collection
     * @returns Promise that resolves when the collection is ready
     */
    async ensureCollectionExists(connectionId: string, databaseName: string, collectionName: string): Promise<void> {
        const client = await ClustersClient.getClient(connectionId);

        // Check if collection exists by trying to list collections
        const collections = await client.listCollections(databaseName);
        const collectionExists = collections.some((col) => col.name === collectionName);

        if (!collectionExists) {
            // Create the collection by running createCollection
            await client.createCollection(databaseName, collectionName);
        }
    }
}
