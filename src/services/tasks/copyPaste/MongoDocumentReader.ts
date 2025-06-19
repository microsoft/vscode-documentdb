/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClustersClient } from '../../../documentdb/ClustersClient';
import { type DocumentReader, type DocumentDetails } from './interfaces';

/**
 * MongoDB-specific implementation of DocumentReader.
 * Handles reading documents from MongoDB collections using the ClustersClient.
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
        
        // Use the existing streamDocuments method with empty query to get all documents
        const abortController = new AbortController();
        const documentStream = client.streamDocuments(
            databaseName,
            collectionName,
            abortController.signal,
            '{}', // Empty query to get all documents
            0,    // Skip
            0,    // Limit (0 means no limit)
        );

        try {
            for await (const document of documentStream) {
                // Convert MongoDB document to DocumentDetails interface
                const documentDetails: DocumentDetails = {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    id: document._id,
                    documentContent: document,
                };

                yield documentDetails;
            }
        } catch (error) {
            // Abort the stream if an error occurs
            abortController.abort();
            throw new Error(
                `Failed to stream documents from collection ${collectionName}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }

    /**
     * Counts the total number of documents in a MongoDB collection.
     *
     * @param connectionId Connection identifier to get the MongoDB client
     * @param databaseName Name of the database
     * @param collectionName Name of the collection
     * @returns Promise resolving to the document count
     */
    async countDocuments(connectionId: string, databaseName: string, collectionName: string): Promise<number> {
        try {
            const client = await ClustersClient.getClient(connectionId);
            
            // Use the MongoDB collection's estimatedDocumentCount method
            // This is faster than countDocuments() for large collections
            const collection = client['_mongoClient'].db(databaseName).collection(collectionName);
            return await collection.estimatedDocumentCount();
        } catch (error) {
            throw new Error(
                `Failed to count documents in collection ${collectionName}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }
}