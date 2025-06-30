/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
    type CopyPasteConfig,
    type DocumentDetails,
    type DocumentReader,
    type DocumentWriter,
    ConflictResolutionStrategy,
} from '../../utils/copyPasteUtils';
import { Task } from '../taskService';

/**
 * Task for copying documents from a source collection to a target collection.
 *
 * This task implements a database-agnostic approach using DocumentReader and DocumentWriter
 * interfaces to handle the actual data operations. It manages memory efficiently through
 * a buffer-based streaming approach where documents are read and written in batches.
 */
export class CopyPasteCollectionTask extends Task {
    public readonly type: string = 'copy-paste-collection';
    public readonly name: string;

    private readonly config: CopyPasteConfig;
    private readonly documentReader: DocumentReader;
    private readonly documentWriter: DocumentWriter;
    private totalDocuments: number = 0;
    private processedDocuments: number = 0;

    // Buffer configuration for memory management
    private readonly bufferSize: number = 100; // Number of documents to buffer
    private readonly maxBufferMemoryMB: number = 32; // Rough memory limit for buffer

    /**
     * Creates a new CopyPasteCollectionTask instance.
     *
     * @param config Configuration for the copy-paste operation
     * @param documentReader Reader implementation for the source database
     * @param documentWriter Writer implementation for the target database
     */
    constructor(config: CopyPasteConfig, documentReader: DocumentReader, documentWriter: DocumentWriter) {
        super();
        this.config = config;
        this.documentReader = documentReader;
        this.documentWriter = documentWriter;

        // Generate a descriptive name for the task
        this.name = vscode.l10n.t(
            'Copy collection "{0}" from "{1}" to "{2}"',
            config.source.collectionName,
            config.source.databaseName,
            config.target.databaseName,
        );
    }

    /**
     * Initializes the task by counting documents and ensuring target collection exists.
     *
     * @param signal AbortSignal to check for cancellation
     */
    protected async onInitialize(signal: AbortSignal): Promise<void> {
        // Count total documents for progress calculation
        this.updateStatus(this.getStatus().state, vscode.l10n.t('Counting documents in source collection...'), 0);

        if (signal.aborted) {
            return;
        }

        try {
            this.totalDocuments = await this.documentReader.countDocuments(
                this.config.source.connectionId,
                this.config.source.databaseName,
                this.config.source.collectionName,
            );
        } catch (error) {
            throw new Error(
                vscode.l10n.t(
                    'Failed to count documents in source collection: {0}',
                    error instanceof Error ? error.message : String(error),
                ),
            );
        }

        if (signal.aborted) {
            return;
        }

        // Ensure target collection exists
        this.updateStatus(this.getStatus().state, vscode.l10n.t('Ensuring target collection exists...'), 0);

        try {
            await this.documentWriter.ensureCollectionExists(
                this.config.target.connectionId,
                this.config.target.databaseName,
                this.config.target.collectionName,
            );
        } catch (error) {
            throw new Error(
                vscode.l10n.t(
                    'Failed to ensure target collection exists: {0}',
                    error instanceof Error ? error.message : String(error),
                ),
            );
        }
    }

    /**
     * Performs the main copy-paste operation using buffer-based streaming.
     *
     * @param signal AbortSignal to check for cancellation
     */
    protected async doWork(signal: AbortSignal): Promise<void> {
        // Handle the case where there are no documents to copy
        if (this.totalDocuments === 0) {
            this.updateProgress(100, vscode.l10n.t('No documents to copy. Operation completed.'));
            return;
        }

        this.updateProgress(0, vscode.l10n.t('Starting document copy...'));

        const documentStream = this.documentReader.streamDocuments(
            this.config.source.connectionId,
            this.config.source.databaseName,
            this.config.source.collectionName,
        );

        const buffer: DocumentDetails[] = [];
        let bufferMemoryEstimate = 0;

        try {
            for await (const document of documentStream) {
                if (signal.aborted) {
                    // Cleanup any remaining buffer
                    if (buffer.length > 0) {
                        await this.flushBuffer(buffer);
                    }
                    return;
                }

                // Add document to buffer
                buffer.push(document);
                bufferMemoryEstimate += this.estimateDocumentMemory(document);

                // Check if we need to flush the buffer
                if (this.shouldFlushBuffer(buffer.length, bufferMemoryEstimate)) {
                    await this.flushBuffer(buffer);
                    buffer.length = 0; // Clear buffer
                    bufferMemoryEstimate = 0;
                }
            }

            // Flush any remaining documents in the buffer
            if (buffer.length > 0) {
                await this.flushBuffer(buffer);
            }

            // Ensure we report 100% completion
            this.updateProgress(100, vscode.l10n.t('Copy operation completed successfully'));
        } catch (error) {
            // For basic implementation, any error should abort the operation
            if (this.config.onConflict === ConflictResolutionStrategy.Abort) {
                throw new Error(
                    vscode.l10n.t('Copy operation failed: {0}', error instanceof Error ? error.message : String(error)),
                );
            }
            // Future: Handle other conflict resolution strategies
            throw error;
        }
    }

    /**
     * Flushes the document buffer by writing all documents to the target collection.
     *
     * @param buffer Array of documents to write
     */
    private async flushBuffer(buffer: DocumentDetails[]): Promise<void> {
        if (buffer.length === 0) {
            return;
        }

        const result = await this.documentWriter.writeDocuments(
            this.config.target.connectionId,
            this.config.target.databaseName,
            this.config.target.collectionName,
            buffer,
            { batchSize: buffer.length },
        );

        // Update processed count
        this.processedDocuments += result.insertedCount;

        // Check for errors in the write result
        if (result.errors.length > 0) {
            // For basic implementation with abort strategy, any error should fail the task
            if (this.config.onConflict === ConflictResolutionStrategy.Abort) {
                const firstError = result.errors[0];
                throw new Error(vscode.l10n.t('Write operation failed: {0}', firstError.error.message));
            }
            // Future: Handle other conflict resolution strategies
        }

        // Update progress
        const progress = Math.min(100, (this.processedDocuments / this.totalDocuments) * 100);
        this.updateProgress(
            progress,
            vscode.l10n.t('Copied {0} of {1} documents', this.processedDocuments, this.totalDocuments),
        );
    }

    /**
     * Determines whether the buffer should be flushed based on size and memory constraints.
     *
     * @param bufferCount Number of documents in the buffer
     * @param memoryEstimate Estimated memory usage in bytes
     * @returns True if the buffer should be flushed
     */
    private shouldFlushBuffer(bufferCount: number, memoryEstimate: number): boolean {
        // Flush if we've reached the document count limit
        if (bufferCount >= this.bufferSize) {
            return true;
        }

        // Flush if we've exceeded the memory limit (converted to bytes)
        const memoryLimitBytes = this.maxBufferMemoryMB * 1024 * 1024;
        if (memoryEstimate >= memoryLimitBytes) {
            return true;
        }

        return false;
    }

    /**
     * Estimates the memory usage of a document in bytes.
     * This is a rough estimate based on JSON serialization.
     *
     * @param document Document to estimate
     * @returns Estimated memory usage in bytes
     */
    private estimateDocumentMemory(document: DocumentDetails): number {
        try {
            // Rough estimate: JSON stringify the document content
            const jsonString = JSON.stringify(document.documentContent);
            return jsonString.length * 2; // Rough estimate for UTF-16 encoding
        } catch {
            // If we can't serialize, use a conservative estimate
            return 1024; // 1KB default estimate
        }
    }
}
