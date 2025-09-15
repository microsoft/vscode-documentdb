/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Document, type WithId } from 'mongodb';
import { ClustersClient } from '../../../../../documentdb/ClustersClient';
import { type DocumentDetails, type DocumentReader } from '../documentInterfaces';

/**
 * DocumentDB-specific implementation of DocumentReader.
 */
export class DocumentDbDocumentReader implements DocumentReader {
    /**
     * Streams documents from a DocumentDB collection.
     *
     * @param connectionId Connection identifier to get the DocumentDB client
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
     * Counts the total number of documents in the DocumentDB collection.
     *
     * @param connectionId Connection identifier to get the DocumentDB client
     * @param databaseName Name of the database
     * @param collectionName Name of the collection
     * @returns Promise resolving to the document count
     */
    async countDocuments(connectionId: string, databaseName: string, collectionName: string): Promise<number> {
        const client = await ClustersClient.getClient(connectionId);
        // Currently we use estimatedDocumentCount to get a rough idea of the document count
        // estimatedDocumentCount evaluates document counts based on metadata with O(1) complexity
        // We gain performance benefits by avoiding a full collection scan, especially for large collections
        //
        // NOTE: estimatedDocumentCount doesn't support filtering
        //       so we need to provide alternative count method for filtering implementation in later iteration
        return await client.estimateDocumentCount(databaseName, collectionName);
    }
}
