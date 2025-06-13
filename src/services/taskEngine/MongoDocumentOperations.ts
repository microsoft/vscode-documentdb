/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Document } from 'mongodb';
import { ClustersClient } from '../../documentdb/ClustersClient';
import {
    type BulkWriteResult,
    type DocumentDetails,
    type DocumentReader,
    type DocumentWriter,
    type DocumentWriterOptions,
} from './DocumentInterfaces';

/**
 * MongoDB-specific implementation of DocumentReader
 */
export class MongoDocumentReader implements DocumentReader {
    async *streamDocuments(
        connectionId: string,
        databaseName: string,
        collectionName: string,
    ): AsyncIterable<DocumentDetails> {
        const client = await ClustersClient.getClient(connectionId);
        const abortController = new AbortController();

        try {
            const documentStream = client.streamDocuments(
                databaseName,
                collectionName,
                abortController.signal,
                '{}', // Query all documents
                0, // Skip
                0, // No limit
            );

            for await (const doc of documentStream) {
                yield {
                    id: doc._id,
                    documentContent: doc,
                };
            }
        } catch (error) {
            abortController.abort();
            throw error;
        }
    }

    async countDocuments(connectionId: string, databaseName: string, collectionName: string): Promise<number> {
        const client = await ClustersClient.getClient(connectionId);
        
        // For now, use runQuery with limit to estimate document count
        // This is a workaround since we don't have direct access to the MongoDB client
        const documents = await client.runQuery(databaseName, collectionName, '{}', 0, 0);
        
        // This is not optimal for large collections, but provides basic functionality
        // In a production implementation, we'd need to add a countDocuments method to ClustersClient
        return documents.length;
    }
}

/**
 * MongoDB-specific implementation of DocumentWriter
 */
export class MongoDocumentWriter implements DocumentWriter {
    async writeDocuments(
        connectionId: string,
        databaseName: string,
        collectionName: string,
        documents: DocumentDetails[],
        _options?: DocumentWriterOptions,
    ): Promise<BulkWriteResult> {
        if (documents.length === 0) {
            return { insertedCount: 0, errors: [] };
        }

        const client = await ClustersClient.getClient(connectionId);
        
        // Convert DocumentDetails to MongoDB documents
        const mongoDocuments = documents.map((doc) => doc.documentContent as Document);

        try {
            const result = await client.insertDocuments(databaseName, collectionName, mongoDocuments);
            
            return {
                insertedCount: result.insertedCount,
                errors: [], // The ClustersClient.insertDocuments method handles errors internally
            };
        } catch (error) {
            // If the entire operation fails, mark all documents as failed
            return {
                insertedCount: 0,
                errors: documents.map((doc) => ({
                    documentId: doc.id,
                    error: error instanceof Error ? error : new Error(String(error)),
                })),
            };
        }
    }

    async ensureCollectionExists(connectionId: string, databaseName: string, collectionName: string): Promise<void> {
        const client = await ClustersClient.getClient(connectionId);
        
        try {
            // Check if collection exists by trying to list collections
            const collections = await client.listCollections(databaseName);
            const collectionExists = collections.some((col) => col.name === collectionName);
            
            if (!collectionExists) {
                // Create the collection using the ClustersClient method
                await client.createCollection(databaseName, collectionName);
            }
        } catch {
            // If listing collections fails, try creating the collection anyway
            // This handles cases where we might not have permissions to list collections
            try {
                await client.createCollection(databaseName, collectionName);
            } catch (createError) {
                // If creation also fails and it's not because the collection already exists, rethrow
                if (!String(createError).includes('already exists')) {
                    throw createError;
                }
            }
        }
    }
}