/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUtils } from '../../utils/randomUtils';
import { BaseTask } from './BaseTask';
import { type CopyPasteConfig, ConflictResolutionStrategy } from './copyPasteTypes';
import { type DocumentDetails, type DocumentReader, type DocumentWriter } from './documentInterfaces';
import { TaskStatus } from './Task';

/**
 * Task for copying and pasting collections between databases
 */
export class CopyPasteCollectionTask extends BaseTask {
    private _cancelled = false;
    private readonly _documentBuffer: DocumentDetails[] = [];
    private readonly _bufferMaxSize = 1000; // Maximum number of documents in buffer
    private readonly _batchSize = 100; // Number of documents to write in each batch

    constructor(
        private readonly config: CopyPasteConfig,
        private readonly documentReader: DocumentReader,
        private readonly documentWriter: DocumentWriter,
    ) {
        super(randomUtils.getRandomHexString(8));
    }

    public async execute(): Promise<void> {
        try {
            this.updateStatus(TaskStatus.Initializing);
            this.updateProgress({ percentage: 0, message: 'Initializing copy operation...' });

            // Validate configuration
            this.validateConfig();

            // Count total documents for progress calculation
            const totalDocuments = await this.countSourceDocuments();
            this.updateProgress({
                percentage: 5,
                message: `Found ${totalDocuments} documents to copy`,
                totalCount: totalDocuments,
                processedCount: 0,
            });

            this.updateStatus(TaskStatus.Running);

            // Start the copy operation with buffer-based streaming
            await this.copyDocuments(totalDocuments);

            this.updateStatus(TaskStatus.Completed);
            this.updateProgress({
                percentage: 100,
                message: 'Copy operation completed successfully',
                processedCount: totalDocuments,
                totalCount: totalDocuments,
            });
        } catch (error) {
            this.setError(error instanceof Error ? error : new Error(String(error)));
        }
    }

    public cancel(): void {
        this._cancelled = true;
        this.updateStatus(TaskStatus.Failed);
        this.setError(new Error('Task was cancelled'));
    }

    private validateConfig(): void {
        if (!this.config.source.connectionId || !this.config.source.databaseName || !this.config.source.collectionName) {
            throw new Error('Invalid source configuration: connectionId, databaseName, and collectionName are required');
        }

        if (!this.config.target.connectionId || !this.config.target.databaseName || !this.config.target.collectionName) {
            throw new Error('Invalid target configuration: connectionId, databaseName, and collectionName are required');
        }

        if (this.config.onConflict !== ConflictResolutionStrategy.Abort) {
            throw new Error(`Unsupported conflict resolution strategy: ${this.config.onConflict}`);
        }
    }

    private async countSourceDocuments(): Promise<number> {
        try {
            const count = await this.documentReader.countDocuments(
                this.config.source.connectionId,
                this.config.source.databaseName,
                this.config.source.collectionName,
            );
            return count;
        } catch (error) {
            throw new Error(`Failed to count source documents: ${error}`);
        }
    }

    private async copyDocuments(totalDocuments: number): Promise<void> {
        const documentStream = this.documentReader.streamDocuments(
            this.config.source.connectionId,
            this.config.source.databaseName,
            this.config.source.collectionName,
        );

        // Start concurrent read and write operations
        const readerPromise = this.readDocuments(documentStream);
        const writerPromise = this.writeDocuments(totalDocuments);

        await Promise.all([readerPromise, writerPromise]);
    }

    private async readDocuments(documentStream: AsyncIterable<DocumentDetails>): Promise<void> {
        try {
            for await (const document of documentStream) {
                if (this._cancelled) {
                    break;
                }

                // Add document to buffer
                this._documentBuffer.push(document);

                // If buffer is full, wait for writer to process some documents
                while (this._documentBuffer.length >= this._bufferMaxSize && !this._cancelled) {
                    await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay to prevent busy waiting
                }
            }
        } catch (error) {
            throw new Error(`Failed to read documents: ${error}`);
        }
    }

    private async writeDocuments(totalDocuments: number): Promise<void> {
        let processedCount = 0;

        while (processedCount < totalDocuments && !this._cancelled) {
            // Wait for documents in buffer or for reading to complete
            while (this._documentBuffer.length === 0 && processedCount < totalDocuments && !this._cancelled) {
                await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay
            }

            if (this._cancelled) {
                break;
            }

            // Extract batch from buffer
            const batchSize = Math.min(this._batchSize, this._documentBuffer.length);
            if (batchSize === 0) {
                continue;
            }

            const batch = this._documentBuffer.splice(0, batchSize);

            try {
                // Write batch to target
                const result = await this.documentWriter.writeDocuments(
                    this.config.target.connectionId,
                    this.config.target.databaseName,
                    this.config.target.collectionName,
                    batch,
                    { batchSize: this._batchSize },
                );

                // Check for errors (abort strategy)
                if (result.errors.length > 0) {
                    const errorMessages = result.errors.map((e) => e.error.message).join('; ');
                    throw new Error(`Bulk write errors: ${errorMessages}`);
                }

                processedCount += result.insertedCount;

                // Update progress
                const percentage = Math.min(95, Math.floor((processedCount / totalDocuments) * 100));
                this.updateProgress({
                    percentage,
                    message: `Copied ${processedCount} of ${totalDocuments} documents`,
                    processedCount,
                    totalCount: totalDocuments,
                });
            } catch (error) {
                throw new Error(`Failed to write documents: ${error}`);
            }
        }
    }
}