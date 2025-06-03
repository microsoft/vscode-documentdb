/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type Document } from 'bson';
import { ClustersClient } from '../documentdb/ClustersClient';
import { CollectionItem } from '../tree/documentdb/CollectionItem';

// Buffer size for batch document insertion to improve performance
export const DOCUMENT_IMPORT_BUFFER_SIZE = 100;

export interface BatchInsertResult {
    insertedCount: number;
    error: string;
}

export interface BatchProgressInfo {
    start: number;
    end: number;
    total: number;
}

/**
 * Utility class for buffering documents during import operations
 */
export class DocumentBuffer {
    private buffer: Document[] = [];
    private totalProcessed = 0;

    constructor(private readonly bufferSize: number = DOCUMENT_IMPORT_BUFFER_SIZE) {}

    /**
     * Add a document to the buffer
     */
    add(document: Document): void {
        this.buffer.push(document);
    }

    /**
     * Check if the buffer is full
     */
    isFull(): boolean {
        return this.buffer.length >= this.bufferSize;
    }

    /**
     * Check if the buffer has documents
     */
    hasDocuments(): boolean {
        return this.buffer.length > 0;
    }

    /**
     * Get the current buffer size
     */
    size(): number {
        return this.buffer.length;
    }

    /**
     * Get progress information for the current batch
     */
    getBatchProgressInfo(totalDocuments: number): BatchProgressInfo {
        return {
            start: this.totalProcessed + 1,
            end: this.totalProcessed + this.buffer.length,
            total: totalDocuments,
        };
    }

    /**
     * Flush the buffer by inserting all documents in batch
     */
    async flush(collectionItem: CollectionItem): Promise<BatchInsertResult> {
        if (this.buffer.length === 0) {
            return { insertedCount: 0, error: '' };
        }

        try {
            const result = await insertDocumentsBatch(collectionItem, this.buffer);
            this.totalProcessed += result.insertedCount;
            this.buffer = []; // Clear the buffer
            return result;
        } catch (e) {
            this.buffer = []; // Clear the buffer even on error
            return { insertedCount: 0, error: parseError(e).message };
        }
    }

    /**
     * Get the total number of documents processed so far
     */
    getTotalProcessed(): number {
        return this.totalProcessed;
    }

    /**
     * Reset the buffer and counters
     */
    reset(): void {
        this.buffer = [];
        this.totalProcessed = 0;
    }
}

/**
 * Insert a batch of documents into the collection
 */
async function insertDocumentsBatch(
    collectionItem: CollectionItem,
    documents: Document[],
): Promise<BatchInsertResult> {
    if (documents.length === 0) {
        return { insertedCount: 0, error: '' };
    }

    try {
        const client = await ClustersClient.getClient(collectionItem.cluster.id);
        const response = await client.insertDocuments(
            collectionItem.databaseInfo.name,
            collectionItem.collectionInfo.name,
            documents,
        );

        if (response?.acknowledged) {
            return { insertedCount: response.insertedCount, error: '' };
        } else {
            return {
                insertedCount: 0,
                error: l10n.t('The batch insertion failed. The operation was not acknowledged by the database.'),
            };
        }
    } catch (e) {
        return { insertedCount: 0, error: parseError(e).message };
    }
}