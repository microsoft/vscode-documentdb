/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BufferErrorCode, DocumentBuffer } from '../utils/documentBuffer';
import { TaskBase } from './TaskEngine';
import {
    type BulkWriteResult,
    ConflictResolutionStrategy,
    type CopyPasteConfig,
    type DocumentDetails,
    type DocumentReader,
    type DocumentWriter,
} from './CopyPasteInterfaces';

/**
 * Task for copying and pasting collections between databases
 */
export class CopyPasteCollectionTask extends TaskBase {
    private totalDocuments: number = 0;
    private processedDocuments: number = 0;
    private readonly buffer: DocumentBuffer<DocumentDetails>;

    constructor(
        id: string,
        private readonly config: CopyPasteConfig,
        private readonly reader: DocumentReader,
        private readonly writer: DocumentWriter,
    ) {
        super(id);
        
        // Create buffer for streaming with reasonable defaults
        this.buffer = new DocumentBuffer<DocumentDetails>({
            maxBufferSizeBytes: 16 * 1024 * 1024, // 16MB
            maxDocumentCount: 100,
            maxSingleDocumentSizeBytes: 8 * 1024 * 1024, // 8MB
            calculateDocumentSize: (doc: DocumentDetails) => {
                // Rough estimation - could be improved with actual serialization
                return JSON.stringify(doc).length * 2; // Factor for BSON overhead
            },
        });
    }

    /**
     * Initialize the task by counting source documents and ensuring target collection exists
     */
    protected async initialize(): Promise<void> {
        this.checkCancellation();
        this.setProgress(0, 'Counting source documents...');

        // Count documents in source collection
        this.totalDocuments = await this.reader.countDocuments(
            this.config.source.connectionId,
            this.config.source.databaseName,
            this.config.source.collectionName,
        );

        this.checkCancellation();

        // Ensure target collection exists
        this.setProgress(5, 'Preparing target collection...');
        await this.writer.ensureCollectionExists(
            this.config.target.connectionId,
            this.config.target.databaseName,
            this.config.target.collectionName,
        );

        this.setProgress(10, `Ready to copy ${this.totalDocuments} documents`);
    }

    /**
     * Run the main copy operation using buffer-based streaming
     */
    protected async run(): Promise<void> {
        this.checkCancellation();

        if (this.totalDocuments === 0) {
            this.setProgress(100, 'No documents to copy');
            return;
        }

        const documentStream = this.reader.streamDocuments(
            this.config.source.connectionId,
            this.config.source.databaseName,
            this.config.source.collectionName,
        );

        let hasErrors = false;

        try {
            // Process documents in streaming fashion
            for await (const document of documentStream) {
                this.checkCancellation();

                // Try to add document to buffer
                const insertResult = this.buffer.insertOrFlush(document);

                if (insertResult.success) {
                    // Document was buffered successfully
                    continue;
                }

                // Handle buffer overflow or large documents
                if (insertResult.documentsToProcess && insertResult.documentsToProcess.length > 0) {
                    // Process the documents that need immediate attention
                    const result = await this.writeDocumentsBatch(insertResult.documentsToProcess);
                    hasErrors = hasErrors || result.errors.length > 0;

                    // If buffer was full, try to add the current document again
                    if (insertResult.errorCode === BufferErrorCode.BufferFull) {
                        const retryResult = this.buffer.insert(document);
                        if (!retryResult.success) {
                            // If it still fails, process immediately
                            const immediateResult = await this.writeDocumentsBatch([document]);
                            hasErrors = hasErrors || immediateResult.errors.length > 0;
                        }
                    }
                } else {
                    // Handle other error cases based on conflict resolution strategy
                    if (this.config.onConflict === ConflictResolutionStrategy.Abort) {
                        throw new Error(`Failed to process document: ${insertResult.errorCode}`);
                    }
                }

                this.updateProgress();
            }

            // Process any remaining documents in the buffer
            const remainingStats = this.buffer.getStats();
            if (remainingStats.documentCount > 0) {
                const finalDocuments = this.buffer.flush();
                const result = await this.writeDocumentsBatch(finalDocuments);
                hasErrors = hasErrors || result.errors.length > 0;
            }

            // Handle final results
            if (hasErrors && this.config.onConflict === ConflictResolutionStrategy.Abort) {
                throw new Error('Copy operation completed with errors');
            }

            this.setProgress(100, `Copied ${this.processedDocuments} documents successfully`);

        } catch (error) {
            // Clean up buffer state on error
            this.buffer.flush();
            throw error;
        }
    }

    /**
     * Write a batch of documents to the target collection
     */
    private async writeDocumentsBatch(documents: DocumentDetails[]): Promise<BulkWriteResult> {
        if (documents.length === 0) {
            return { insertedCount: 0, errors: [] };
        }

        this.checkCancellation();

        const result = await this.writer.writeDocuments(
            this.config.target.connectionId,
            this.config.target.databaseName,
            this.config.target.collectionName,
            documents,
        );

        this.processedDocuments += result.insertedCount;

        // Handle errors based on conflict resolution strategy
        if (result.errors.length > 0 && this.config.onConflict === ConflictResolutionStrategy.Abort) {
            const firstError = result.errors[0];
            throw new Error(`Write operation failed: ${firstError.error.message}`);
        }

        return result;
    }

    /**
     * Update progress based on processed documents
     */
    private updateProgress(): void {
        if (this.totalDocuments === 0) {
            return;
        }

        const progressPercent = Math.min(95, (this.processedDocuments / this.totalDocuments) * 85 + 10);
        this.setProgress(
            progressPercent,
            `Copied ${this.processedDocuments} of ${this.totalDocuments} documents`,
        );
    }

    /**
     * Handle task cancellation by cleaning up resources
     */
    protected async onCancel(): Promise<void> {
        // Clean up buffer
        this.buffer.flush();
    }
}