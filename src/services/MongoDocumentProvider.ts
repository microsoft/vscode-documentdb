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
} from './copyPasteTypes';

/**
 * MongoDB-specific implementation of DocumentReader
 */
export class MongoDocumentReader implements DocumentReader {
    /**
     * Stream documents from MongoDB collection
     */
    public async *streamDocuments(
        connectionId: string,
        databaseName: string,
        collectionName: string,
    ): AsyncIterable<DocumentDetails> {
        const client = await ClustersClient.getClient(connectionId);
        
        // Use ClustersClient's streamDocuments method
        const docStream = client.streamDocuments(databaseName, collectionName, new AbortController().signal);
        
        for await (const document of docStream) {
            yield {
                id: (document as WithId<Document>)._id,
                documentContent: document,
            };
        }
    }

    /**
     * Count documents in MongoDB collection
     */
    public async countDocuments(connectionId: string, databaseName: string, collectionName: string): Promise<number> {
        const client = await ClustersClient.getClient(connectionId);
        
        // For a more accurate count, we'll iterate through the stream
        // This approach ensures we count exactly what will be copied
        let count = 0;
        const docStream = client.streamDocuments(databaseName, collectionName, new AbortController().signal);
        
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _document of docStream) {
            count++;
        }
        
        return count;
    }
}

/**
 * MongoDB-specific implementation of DocumentWriter
 */
export class MongoDocumentWriter implements DocumentWriter {
    /**
     * Write documents to MongoDB collection using bulk operations
     */
    public async writeDocuments(
        connectionId: string,
        databaseName: string,
        collectionName: string,
        documents: DocumentDetails[],
        _options?: DocumentWriterOptions,
    ): Promise<BulkWriteResult> {
        const client = await ClustersClient.getClient(connectionId);
        
        // Convert DocumentDetails to MongoDB documents
        const mongoDocuments = documents.map((doc) => doc.documentContent as WithId<Document>);
        
        try {
            const result = await client.insertDocuments(databaseName, collectionName, mongoDocuments);
            
            return {
                insertedCount: result.insertedCount,
                errors: [],
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
                        const errorMessage = 'errmsg' in writeError ? (writeError.errmsg as string) : 'Unknown write error';
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

            const insertedCount = error && typeof error === 'object' && 'result' in error 
                ? ((error as { result?: { insertedCount?: number } }).result?.insertedCount ?? 0)
                : 0;

            return {
                insertedCount,
                errors,
            };
        }
    }

    /**
     * Ensure MongoDB collection exists
     */
    public async ensureCollectionExists(
        connectionId: string,
        databaseName: string,
        collectionName: string,
    ): Promise<void> {
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