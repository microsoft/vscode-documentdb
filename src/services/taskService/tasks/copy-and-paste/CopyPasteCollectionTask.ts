/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ext } from '../../../../extensionVariables';
import { Task } from '../../taskService';
import { type ResourceDefinition, type ResourceTrackingTask } from '../../taskServiceResourceTracking';
import { ConflictResolutionStrategy, type CopyPasteConfig } from './copyPasteConfig';
import { type DocumentDetails, type DocumentReader, type DocumentWriter } from './documentInterfaces';

/**
 * Task for copying documents from a source to a target collection.
 *
 * This task uses a database-agnostic approach with `DocumentReader` and `DocumentWriter`
 * interfaces. It streams documents from the source and writes them in batches to the
 * target, managing memory usage with a configurable buffer.
 */
export class CopyPasteCollectionTask extends Task implements ResourceTrackingTask {
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
            'Copy "{sourceCollection}" from "{sourceDatabase}" to "{targetDatabase}/{targetCollection}"',
            {
                sourceCollection: config.source.collectionName,
                sourceDatabase: config.source.databaseName,
                targetDatabase: config.target.databaseName,
                targetCollection: config.target.collectionName,
            },
        );
    }

    /**
     * Returns all resources currently being used by this task.
     * This includes both the source and target collections.
     */
    public getUsedResources(): ResourceDefinition[] {
        return [
            // Source resource
            {
                connectionId: this.config.source.connectionId,
                databaseName: this.config.source.databaseName,
                collectionName: this.config.source.collectionName,
            },
            // Target resource
            {
                connectionId: this.config.target.connectionId,
                databaseName: this.config.target.databaseName,
                collectionName: this.config.target.collectionName,
            },
        ];
    }

    /**
     * Initializes the task by counting documents and ensuring target collection exists.
     *
     * @param signal AbortSignal to check for cancellation
     */
    protected async onInitialize(signal: AbortSignal): Promise<void> {
        // Count total documents for progress calculation
        this.updateStatus(this.getStatus().state, vscode.l10n.t('Counting documents in source collection...'));

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
        this.updateStatus(this.getStatus().state, vscode.l10n.t('Ensuring target collection exists...'));

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
            this.updateProgress(100, vscode.l10n.t('Source collection is empty.'));
            return;
        }

        const documentStream = this.documentReader.streamDocuments(
            this.config.source.connectionId,
            this.config.source.databaseName,
            this.config.source.collectionName,
        );

        const buffer: DocumentDetails[] = [];
        let bufferMemoryEstimate = 0;

        for await (const document of documentStream) {
            if (signal.aborted) {
                // Buffer is a local variable, no need to clear, just exit.
                return;
            }

            // Add document to buffer
            buffer.push(document);
            bufferMemoryEstimate += this.estimateDocumentMemory(document);

            // Check if we need to flush the buffer
            if (this.shouldFlushBuffer(buffer.length, bufferMemoryEstimate)) {
                await this.flushBuffer(buffer, signal);
                buffer.length = 0; // Clear buffer
                bufferMemoryEstimate = 0;
            }
        }

        if (signal.aborted) {
            return;
        }

        // Flush any remaining documents in the buffer
        if (buffer.length > 0) {
            await this.flushBuffer(buffer, signal);
        }

        // Ensure we report 100% completion
        this.updateProgress(100, vscode.l10n.t('Copy operation completed successfully'));
    }

    /**
     * Flushes the document buffer by writing all documents to the target collection.
     *
     * @param buffer Array of documents to write.
     * @param signal AbortSignal to check for cancellation.
     */
    private async flushBuffer(buffer: DocumentDetails[], signal: AbortSignal): Promise<void> {
        if (buffer.length === 0 || signal.aborted) {
            return;
        }

        const result = await this.documentWriter.writeDocuments(
            this.config.target.connectionId,
            this.config.target.databaseName,
            this.config.target.collectionName,
            this.config,
            buffer,
            { batchSize: buffer.length },
        );

        // Update processed count
        this.processedDocuments += result.insertedCount;

        // Check for errors in the write result
        if (result.errors && result.errors.length > 0) {
            // Handle errors based on the configured conflict resolution strategy.
            if (this.config.onConflict === ConflictResolutionStrategy.Abort) {
                // Abort strategy: fail the entire task on the first error.
                const firstError = result.errors[0] as { error: Error };
                throw new Error(
                    vscode.l10n.t(
                        'Task aborted due to an error: {0}. {1} document(s) were inserted in total.',
                        firstError.error?.message ?? 'Unknown error',
                        this.processedDocuments.toString(),
                    ),
                );
            } else if (this.config.onConflict === ConflictResolutionStrategy.Skip) {
                // Skip strategy: log each error and continue.
                for (const error of result.errors) {
                    ext.outputChannel.appendLog(
                        vscode.l10n.t(
                            'Skipped document with _id: {0} due to error: {1}',
                            String(error.documentId ?? 'unknown'),
                            error.error?.message ?? 'Unknown error',
                        ),
                    );
                }
                ext.outputChannel.show();
            } else if (this.config.onConflict === ConflictResolutionStrategy.GenerateNewIds) {
                // GenerateNewIds strategy: this should not have conflicts since we remove _id
                // If errors occur, they're likely other issues, so log them
                for (const error of result.errors) {
                    ext.outputChannel.appendLog(
                        vscode.l10n.t(
                            'Error inserting document (GenerateNewIds): {0}',
                            error.error?.message ?? 'Unknown error',
                        ),
                    );
                }
                ext.outputChannel.show();
            } else {
                // Overwrite or other strategies: treat errors as fatal for now.
                // This can be expanded if other strategies need more nuanced error handling.
                const firstError = result.errors[0] as { error: Error };
                throw new Error(
                    vscode.l10n.t(
                        'An error occurred while writing documents: {0}',
                        firstError.error?.message ?? 'Unknown error',
                    ),
                );
            }
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
            // A rough estimate based on the length of the JSON string representation.
            // V8 strings are typically 2 bytes per character (UTF-16).
            const jsonString = JSON.stringify(document.documentContent);
            return jsonString.length * 2;
        } catch {
            // If serialization fails, return a conservative default.
            return 1024; // 1KB
        }
    }
}
