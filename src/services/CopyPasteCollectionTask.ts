/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { v4 as uuidv4 } from 'uuid';
import { createMongoDbBuffer } from '../utils/documentBuffer';
import {
    type BulkWriteResult,
    ConflictResolutionStrategy,
    type CopyPasteConfig,
    type DocumentDetails,
    type DocumentReader,
    type DocumentWriter,
} from './copyPasteTypes';
import { type Task, TaskState, type TaskStatus } from './taskService';

/**
 * Implementation of a copy-paste collection task using buffer-based streaming
 */
export class CopyPasteCollectionTask implements Task {
    public readonly id: string;
    public readonly type: string = 'copy-paste-collection';
    public readonly name: string;

    private status: TaskStatus;
    private isRunning: boolean = false;
    private shouldStop: boolean = false;
    private documentBuffer = createMongoDbBuffer<DocumentDetails>();

    constructor(
        private readonly config: CopyPasteConfig,
        private readonly reader: DocumentReader,
        private readonly writer: DocumentWriter,
    ) {
        this.id = uuidv4();
        this.name = `Copy collection ${config.source.collectionName} to ${config.target.collectionName}`;
        this.status = {
            state: TaskState.Pending,
            progress: 0,
            message: 'Task created',
        };
    }

    /**
     * Get the current status of the task
     */
    public getStatus(): TaskStatus {
        return { ...this.status };
    }

    /**
     * Start the copy-paste operation
     */
    public async start(): Promise<void> {
        if (this.isRunning) {
            throw new Error('Task is already running');
        }

        if (this.status.state !== TaskState.Pending) {
            throw new Error(`Cannot start task in state: ${this.status.state}`);
        }

        this.isRunning = true;
        this.shouldStop = false;

        try {
            await this.executeTask();
        } catch (error) {
            this.updateStatus({
                state: TaskState.Failed,
                error: error instanceof Error ? error : new Error(String(error)),
                message: `Task failed: ${error instanceof Error ? error.message : String(error)}`,
            });
            throw error;
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Stop the task gracefully
     */
    public async stop(): Promise<void> {
        if (!this.isRunning) {
            return;
        }

        this.shouldStop = true;
        this.updateStatus({
            state: TaskState.Stopping,
            message: 'Stopping task...',
        });

        // Wait for the task to acknowledge the stop request
        while (this.isRunning && this.status.state === TaskState.Stopping) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }

    /**
     * Clean up resources
     */
    public async delete(): Promise<void> {
        if (this.isRunning) {
            await this.stop();
        }
        // Additional cleanup if needed
    }

    /**
     * Execute the copy-paste operation with buffer-based streaming
     */
    private async executeTask(): Promise<void> {
        try {
            // Step 1: Initialize - count documents for progress tracking
            this.updateStatus({
                state: TaskState.Initializing,
                progress: 0,
                message: 'Counting source documents...',
            });

            const totalDocuments = await this.reader.countDocuments(
                this.config.source.connectionId,
                this.config.source.databaseName,
                this.config.source.collectionName,
            );

            if (this.shouldStop) {
                this.updateStatus({ state: TaskState.Stopped, message: 'Task stopped during initialization' });
                return;
            }

            // Step 2: Ensure target collection exists
            this.updateStatus({
                state: TaskState.Initializing,
                progress: 5,
                message: 'Ensuring target collection exists...',
            });

            await this.writer.ensureCollectionExists(
                this.config.target.connectionId,
                this.config.target.databaseName,
                this.config.target.collectionName,
            );

            if (this.shouldStop) {
                this.updateStatus({ state: TaskState.Stopped, message: 'Task stopped during setup' });
                return;
            }

            // Step 3: Start the streaming copy process
            this.updateStatus({
                state: TaskState.Running,
                progress: 10,
                message: 'Starting document copy...',
            });

            await this.streamDocuments(totalDocuments);

            if (this.shouldStop) {
                this.updateStatus({ state: TaskState.Stopped, message: 'Task stopped during copy' });
                return;
            }

            // Step 4: Complete
            this.updateStatus({
                state: TaskState.Completed,
                progress: 100,
                message: `Successfully copied ${totalDocuments} documents`,
            });
        } catch (error) {
            if (this.config.onConflict === ConflictResolutionStrategy.Abort) {
                throw error;
            }
            // For future conflict resolution strategies, handle them here
            throw error;
        }
    }

    /**
     * Stream documents using buffer-based approach
     */
    private async streamDocuments(totalDocuments: number): Promise<void> {
        let processedCount = 0;
        const documents = this.reader.streamDocuments(
            this.config.source.connectionId,
            this.config.source.databaseName,
            this.config.source.collectionName,
        );

        // Read documents and buffer them
        for await (const document of documents) {
            if (this.shouldStop) {
                break;
            }

            // Try to add document to buffer
            const insertResult = this.documentBuffer.insert(document);

            if (!insertResult.success) {
                // Buffer is full or document is too large, flush first
                if (this.documentBuffer.getStats().documentCount > 0) {
                    await this.flushBuffer();
                }

                // Try to insert again after flush
                const secondInsertResult = this.documentBuffer.insert(document);
                if (!secondInsertResult.success) {
                    // Document is too large for buffer, handle immediately
                    await this.writeDocuments([document]);
                    processedCount++;
                    this.updateProgress(processedCount, totalDocuments);
                    continue;
                }
            }

            processedCount++;
            this.updateProgress(processedCount, totalDocuments);

            // Check if we should flush the buffer
            if (this.documentBuffer.shouldFlush()) {
                await this.flushBuffer();
            }
        }

        // Flush any remaining documents in the buffer
        if (this.documentBuffer.getStats().documentCount > 0) {
            await this.flushBuffer();
        }
    }

    /**
     * Flush the document buffer to the target collection
     */
    private async flushBuffer(): Promise<void> {
        const documents = this.documentBuffer.flush();
        if (documents.length > 0) {
            await this.writeDocuments(documents);
        }
    }

    /**
     * Write documents to the target collection with error handling
     */
    private async writeDocuments(documents: DocumentDetails[]): Promise<void> {
        try {
            const result: BulkWriteResult = await this.writer.writeDocuments(
                this.config.target.connectionId,
                this.config.target.databaseName,
                this.config.target.collectionName,
                documents,
            );

            // Handle write errors based on conflict resolution strategy
            if (result.errors.length > 0 && this.config.onConflict === ConflictResolutionStrategy.Abort) {
                const firstError = result.errors[0];
                throw new Error(
                    `Write operation failed: ${firstError.error.message}. Document ID: ${firstError.documentId}`,
                );
            }
        } catch (error) {
            if (this.config.onConflict === ConflictResolutionStrategy.Abort) {
                throw error;
            }
            // For future conflict resolution strategies, handle them here
            throw error;
        }
    }

    /**
     * Update task progress
     */
    private updateProgress(current: number, total: number): void {
        const progress = Math.min(Math.round((current / total) * 90) + 10, 100); // Reserve 10% for setup
        this.updateStatus({
            state: TaskState.Running,
            progress,
            message: `Copied ${current} of ${total} documents`,
        });
    }

    /**
     * Update task status
     */
    private updateStatus(updates: Partial<TaskStatus>): void {
        this.status = {
            ...this.status,
            ...updates,
        };
    }
}