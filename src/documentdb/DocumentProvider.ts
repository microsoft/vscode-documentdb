/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Document, type WithId } from 'mongodb';
import { ClustersClient } from '../documentdb/ClustersClient';
import {
    type BulkWriteResult,
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
            const result = await client.insertDocuments(databaseName, collectionName, mongoDocuments);

            return {
                insertedCount: result.insertedCount,
                errors: [], // ClustersClient.insertDocuments doesn't return detailed errors in the current implementation
            };
        } catch (error: unknown) {
            // Handle MongoDB bulk write errors
            const errors: Array<{ documentId?: unknown; error: Error }> = [];

            if (error && typeof error === 'object' && 'writeErrors' in error) {
                const writeErrors = (error as { writeErrors: unknown[] }).writeErrors;
                for (const writeError of writeErrors) {
                    if (writeError && typeof writeError === 'object' && 'index' in writeError) {
                        const docIndex = writeError.index as number;
                        const documentId = docIndex < documents.length ? documents[docIndex].id : undefined;
                        const errorMessage =
                            'errmsg' in writeError ? (writeError.errmsg as string) : 'Unknown write error';
                        errors.push({
                            documentId,
                            error: new Error(errorMessage),
                        });
                    }
                }
            } else {
                errors.push({
                    error: error instanceof Error ? error : new Error(String(error)),
                });
            }

            const insertedCount =
                error && typeof error === 'object' && 'result' in error
                    ? ((error as { result?: { insertedCount?: number } }).result?.insertedCount ?? 0)
                    : 0;

            return {
                insertedCount,
                errors,
            };
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
