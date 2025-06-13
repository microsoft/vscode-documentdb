/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type DocumentBuffer, createMongoDbBuffer } from '../../utils/documentBuffer';
import { BufferErrorCode } from '../../utils/documentBuffer';
import { type Task, TaskState, type TaskStatus } from '../taskService';
import {
    ConflictResolutionStrategy,
    type CopyPasteConfig,
    type DocumentDetails,
    type DocumentReader,
    type DocumentWriter,
} from './interfaces';

/**
 * Implementation of the Copy-and-Paste task for collections.
 * This task handles copying all documents from a source collection to a target collection
 * using a buffered streaming approach for memory efficiency.
 */
export class CopyPasteCollectionTask implements Task {
    public readonly id: string;
    public readonly type: string = 'copy-paste-collection';
    public readonly name: string;

    private status: TaskStatus;
    private buffer: DocumentBuffer<DocumentDetails>;
    private totalDocuments: number = 0;
    private processedDocuments: number = 0;
    private abortController: AbortController;

    constructor(
        id: string,
        private config: CopyPasteConfig,
        private documentReader: DocumentReader,
        private documentWriter: DocumentWriter,
    ) {
        this.id = id;
        this.name = vscode.l10n.t(
            'Copy "{0}.{1}" to "{2}.{3}"',
            config.source.databaseName,
            config.source.collectionName,
            config.target.databaseName,
            config.target.collectionName,
        );

        this.status = {
            state: TaskState.Pending,
            progress: 0,
            message: vscode.l10n.t('Ready to start copy operation'),
        };

        this.buffer = createMongoDbBuffer<DocumentDetails>();
        this.abortController = new AbortController();
    }

    public getStatus(): TaskStatus {
        return { ...this.status };
    }

    public async start(): Promise<void> {
        if (this.status.state !== TaskState.Pending) {
            throw new Error(vscode.l10n.t('Task has already been started'));
        }

        try {
            this.updateStatus(TaskState.Initializing, 0, vscode.l10n.t('Counting documents in source collection...'));

            // Phase 1: Count documents for progress tracking
            this.totalDocuments = await this.documentReader.countDocuments(
                this.config.source.connectionId,
                this.config.source.databaseName,
                this.config.source.collectionName,
            );

            if (this.totalDocuments === 0) {
                this.updateStatus(TaskState.Completed, 100, vscode.l10n.t('No documents to copy'));
                return;
            }

            this.updateStatus(
                TaskState.Running,
                0,
                vscode.l10n.t('Starting copy of {0} documents...', this.totalDocuments),
            );

            // Phase 2: Ensure target collection exists
            await this.documentWriter.ensureCollectionExists(
                this.config.target.connectionId,
                this.config.target.databaseName,
                this.config.target.collectionName,
            );

            // Phase 3: Start streaming and buffering operation
            await this.performCopyOperation();

            this.updateStatus(
                TaskState.Completed,
                100,
                vscode.l10n.t('Successfully copied {0} documents', this.processedDocuments),
            );
        } catch (error) {
            this.updateStatus(
                TaskState.Failed,
                undefined,
                vscode.l10n.t('Copy operation failed: {0}', error instanceof Error ? error.message : String(error)),
                error,
            );
            throw error;
        }
    }

    public async stop(): Promise<void> {
        if (this.status.state === TaskState.Running || this.status.state === TaskState.Initializing) {
            this.updateStatus(TaskState.Stopping, undefined, vscode.l10n.t('Stopping copy operation...'));
            this.abortController.abort();
            this.updateStatus(TaskState.Stopped, undefined, vscode.l10n.t('Copy operation stopped'));
        }
    }

    public async delete(): Promise<void> {
        // Clean up resources
        this.abortController.abort();
        // Buffer cleanup is automatic with garbage collection
    }

    private async performCopyOperation(): Promise<void> {
        const documentStream = this.documentReader.streamDocuments(
            this.config.source.connectionId,
            this.config.source.databaseName,
            this.config.source.collectionName,
        );

        // Start concurrent reader and writer operations
        await Promise.all([this.readerLoop(documentStream), this.writerLoop()]);

        // Flush any remaining documents in the buffer
        await this.flushBuffer();
    }

    private async readerLoop(documentStream: AsyncIterable<DocumentDetails>): Promise<void> {
        try {
            for await (const document of documentStream) {
                if (this.abortController.signal.aborted) {
                    break;
                }

                const result = this.buffer.insertOrFlush(document);
                if (!result.success) {
                    if (result.errorCode === BufferErrorCode.DocumentTooLarge) {
                        // Handle oversized document - process immediately
                        if (result.documentsToProcess && result.documentsToProcess.length > 0) {
                            await this.writeDocuments(result.documentsToProcess);
                        }
                    } else if (result.errorCode === BufferErrorCode.BufferFull) {
                        // Buffer is full - flush it
                        if (result.documentsToProcess && result.documentsToProcess.length > 0) {
                            await this.writeDocuments(result.documentsToProcess);
                        }
                        // Try to insert the current document again
                        const retryResult = this.buffer.insertOrFlush(document);
                        if (!retryResult.success) {
                            throw new Error(
                                vscode.l10n.t('Failed to buffer document after flush: {0}', retryResult.errorCode),
                            );
                        }
                    } else {
                        throw new Error(vscode.l10n.t('Failed to buffer document: {0}', result.errorCode));
                    }
                }
            }
        } catch (error) {
            if (this.config.onConflict === ConflictResolutionStrategy.Abort) {
                throw error;
            }
        }
    }

    private async writerLoop(): Promise<void> {
        // In this implementation, writing is driven by the reader loop
        // This method could be enhanced for more sophisticated buffering strategies
        return Promise.resolve();
    }

    private async flushBuffer(): Promise<void> {
        const documents = this.buffer.flush();
        if (documents.length > 0) {
            await this.writeDocuments(documents);
        }
    }

    private async writeDocuments(documents: DocumentDetails[]): Promise<void> {
        const result = await this.documentWriter.writeDocuments(
            this.config.target.connectionId,
            this.config.target.databaseName,
            this.config.target.collectionName,
            documents,
        );

        if (result.errors.length > 0 && this.config.onConflict === ConflictResolutionStrategy.Abort) {
            const firstError = result.errors[0];
            throw new Error(
                vscode.l10n.t(
                    'Write operation failed with {0} errors. First error: {1}',
                    result.errors.length,
                    firstError.error instanceof Error ? firstError.error.message : String(firstError.error),
                ),
            );
        }

        this.processedDocuments += result.insertedCount;
        this.updateProgress();
    }

    private updateProgress(): void {
        const progress = this.totalDocuments > 0 ? Math.floor((this.processedDocuments / this.totalDocuments) * 100) : 0;
        this.updateStatus(
            TaskState.Running,
            progress,
            vscode.l10n.t('Copied {0} of {1} documents', this.processedDocuments, this.totalDocuments),
        );
    }

    private updateStatus(state: TaskState, progress?: number, message?: string, error?: unknown): void {
        this.status = {
            state,
            progress,
            message,
            error,
        };
    }
}