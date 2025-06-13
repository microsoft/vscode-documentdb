/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type Document } from 'mongodb';
import { ClustersClient } from '../../documentdb/ClustersClient';
import {
    type BulkWriteResult,
    type DocumentDetails,
    type DocumentReader,
    type DocumentWriter,
    type DocumentWriterOptions,
} from './interfaces';

/**
 * MongoDB-specific implementation of DocumentReader
 */
export class MongoDocumentReader implements DocumentReader {
    public async countDocuments(connectionId: string, databaseName: string, collectionName: string): Promise<number> {
        const client = await this.getClient(connectionId);
        
        // Use a dummy query to count documents - using existing runQuery method
        // We can't access the private _mongoClient, so we'll count using a different approach
        try {
            // Use existing streamDocuments method and count them
            // For efficiency, we could implement a specific count method in ClustersClient later
            let count = 0;
            const abortController = new AbortController();
            
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for await (const _document of client.streamDocuments(databaseName, collectionName, abortController.signal)) {
                count++;
            }
            
            return count;
        } catch (error) {
            throw new Error(
                vscode.l10n.t(
                    'Failed to count documents: {0}',
                    error instanceof Error ? error.message : String(error),
                ),
            );
        }
    }

    public async *streamDocuments(
        connectionId: string,
        databaseName: string,
        collectionName: string,
    ): AsyncIterable<DocumentDetails> {
        const client = await this.getClient(connectionId);
        const abortController = new AbortController();

        try {
            // Use the existing streamDocuments method from ClustersClient
            for await (const document of client.streamDocuments(databaseName, collectionName, abortController.signal)) {
                yield {
                    id: document._id,
                    documentContent: document,
                };
            }
        } finally {
            abortController.abort();
        }
    }

    private async getClient(connectionId: string): Promise<ClustersClient> {
        return await ClustersClient.getClient(connectionId);
    }
}

/**
 * MongoDB-specific implementation of DocumentWriter
 */
export class MongoDocumentWriter implements DocumentWriter {
    private static readonly DEFAULT_BATCH_SIZE = 1000;

    public async ensureCollectionExists(
        connectionId: string,
        databaseName: string,
        collectionName: string,
    ): Promise<void> {
        const client = await this.getClient(connectionId);
        
        // Check if collection exists by attempting to get its information
        try {
            const collections = await client.listCollections(databaseName);
            const collectionExists = collections.some(col => col.name === collectionName);
            
            if (!collectionExists) {
                // Collection will be created automatically when first document is inserted
                // This is MongoDB's default behavior
            }
        } catch (error) {
            throw new Error(
                vscode.l10n.t(
                    'Failed to verify collection existence: {0}',
                    error instanceof Error ? error.message : String(error),
                ),
            );
        }
    }

    public async writeDocuments(
        connectionId: string,
        databaseName: string,
        collectionName: string,
        documents: DocumentDetails[],
        options?: DocumentWriterOptions,
    ): Promise<BulkWriteResult> {
        if (documents.length === 0) {
            return { insertedCount: 0, errors: [] };
        }

        const client = await this.getClient(connectionId);
        const batchSize = options?.batchSize ?? MongoDocumentWriter.DEFAULT_BATCH_SIZE;

        let totalInserted = 0;
        const allErrors: Array<{ documentId?: unknown; error: unknown }> = [];

        // Process documents in batches
        for (let i = 0; i < documents.length; i += batchSize) {
            const batch = documents.slice(i, i + batchSize);
            const batchDocuments = batch.map(doc => doc.documentContent as Document);

            try {
                const result = await client.insertDocuments(databaseName, collectionName, batchDocuments);
                totalInserted += result.insertedCount;
            } catch (error) {
                // For this basic implementation, we'll treat any error as affecting all documents in the batch
                // More sophisticated error handling can be added later
                for (const doc of batch) {
                    allErrors.push({
                        documentId: doc.id,
                        error,
                    });
                }
            }
        }

        return {
            insertedCount: totalInserted,
            errors: allErrors,
        };
    }

    private async getClient(connectionId: string): Promise<ClustersClient> {
        return await ClustersClient.getClient(connectionId);
    }
}