/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type Document, type WithId } from 'mongodb';
import { ClustersClient } from '../../../../documentdb/ClustersClient';
import { type DocumentDetails } from '../types';
import { BaseDocumentReader } from './BaseDocumentReader';

/**
 * DocumentDB-specific implementation of DocumentReader.
 *
 * Extends BaseDocumentReader to provide MongoDB-specific document reading
 * capabilities for Azure Cosmos DB for MongoDB (both vCore and RU) and
 * MongoDB-compatible databases.
 *
 * Features:
 * - Streaming document reads using MongoDB cursor
 * - Fast document counting via estimatedDocumentCount
 * - Support for BSON document types
 * - Connection management via ClustersClient
 */
export class DocumentDbDocumentReader extends BaseDocumentReader {
    /** Connection identifier for accessing the DocumentDB cluster */
    private readonly connectionId: string;

    constructor(connectionId: string, databaseName: string, collectionName: string) {
        super(databaseName, collectionName);
        this.connectionId = connectionId;
    }

    /**
     * Streams documents from a DocumentDB collection.
     *
     * Connects to the database using the ClustersClient and streams all documents
     * from the collection specified in the constructor. Each document is converted
     * to DocumentDetails format with its _id and full content.
     *
     * @param signal Optional AbortSignal for canceling the stream
     * @param _actionContext Optional action context for telemetry (currently unused)
     * @returns AsyncIterable of document details
     */
    protected async *streamDocumentsFromDatabase(
        signal?: AbortSignal,
        _actionContext?: IActionContext,
    ): AsyncIterable<DocumentDetails> {
        const client = await ClustersClient.getClient(this.connectionId);

        const documentStream = client.streamDocumentsWithQuery(
            this.databaseName,
            this.collectionName,
            signal ?? new AbortController().signal,
        );
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
     * Uses estimatedDocumentCount for O(1) performance by reading from metadata
     * rather than scanning the entire collection. This provides fast results for
     * progress calculation, especially useful for large collections.
     *
     * Note: estimatedDocumentCount doesn't support filtering, so exact counts
     * with filters would require countDocuments() method in future iterations.
     *
     * @param _signal Optional AbortSignal for canceling the count operation (currently unused)
     * @param _actionContext Optional action context for telemetry (currently unused)
     * @returns Promise resolving to the estimated document count
     */
    protected async countDocumentsInDatabase(_signal?: AbortSignal, _actionContext?: IActionContext): Promise<number> {
        const client = await ClustersClient.getClient(this.connectionId);
        // Currently we use estimatedDocumentCount to get a rough idea of the document count
        // estimatedDocumentCount evaluates document counts based on metadata with O(1) complexity
        // We gain performance benefits by avoiding a full collection scan, especially for large collections
        //
        // NOTE: estimatedDocumentCount doesn't support filtering
        //       so we need to provide alternative count method for filtering implementation in later iteration
        return await client.estimateDocumentCount(this.databaseName, this.collectionName);
    }
}
