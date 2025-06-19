/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MongoBulkWriteError } from 'mongodb';
import { ClustersClient } from '../../../documentdb/ClustersClient';
import { type DocumentWriter, type DocumentDetails, type BulkWriteResult, type DocumentWriterOptions } from './interfaces';

/**
 * MongoDB-specific implementation of DocumentWriter.
 * Handles writing documents to MongoDB collections using the ClustersClient.
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
        _options?: DocumentWriterOptions, // Prefix with underscore to indicate it's unused
    ): Promise<BulkWriteResult> {
        if (documents.length === 0) {
            return {
                insertedCount: 0,
                errors: [],
            };
        }

        try {
            const client = await ClustersClient.getClient(connectionId);
            
            // Extract the document content from DocumentDetails
            // We need to cast to Document type expected by MongoDB client
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
            const mongoDocuments = documents.map((doc) => doc.documentContent as any);
            
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            const result = await client.insertDocuments(databaseName, collectionName, mongoDocuments);
            
            return {
                insertedCount: result.insertedCount,
                errors: [], // ClustersClient.insertDocuments doesn't return detailed errors in the current implementation
            };
        } catch (error) {
            // Handle MongoDB bulk write errors
            if (error instanceof MongoBulkWriteError) {
                const errors: Array<{ documentId?: unknown; error: Error }> = [];
                
                // Process write errors if available
                if (error.writeErrors) {
                    const writeErrors = Array.isArray(error.writeErrors) ? error.writeErrors : [error.writeErrors];
                    
                    for (const writeError of writeErrors) {
                        errors.push({
                            documentId: undefined, // MongoDB doesn't provide document ID in write errors by default
                            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument
                            error: new Error((writeError.errmsg as string) || writeError.toString()),
                        });
                    }
                }
                
                return {
                    insertedCount: error.insertedCount || 0,
                    errors,
                };
            }
            
            // Handle other errors
            throw new Error(
                `Failed to write documents to collection ${collectionName}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }

    /**
     * Ensures the target collection exists in MongoDB.
     * MongoDB creates collections automatically when first document is inserted,
     * so this is primarily a no-op but includes validation.
     *
     * @param connectionId Connection identifier to get the MongoDB client  
     * @param databaseName Name of the target database
     * @param collectionName Name of the target collection
     * @returns Promise that resolves when the collection is ready
     */
    async ensureCollectionExists(connectionId: string, databaseName: string, collectionName: string): Promise<void> {
        try {
            const client = await ClustersClient.getClient(connectionId);
            
            // Get the list of collections to verify the database exists
            // This also validates that we can connect to the database
            await client.listCollections(databaseName);
            
            // MongoDB will create the collection automatically when the first document is inserted
            // No explicit creation needed, but we've validated the connection and database access
        } catch (error) {
            throw new Error(
                `Failed to ensure collection ${collectionName} exists in database ${databaseName}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }
}