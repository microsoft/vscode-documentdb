/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createMongoDbBuffer, type DocumentBuffer } from '../../utils/documentBuffer';
import {
    type BulkWriteResult,
    type DocumentDetails,
    type DocumentReader,
    type DocumentWriter,
} from './DocumentInterfaces';
import { type Task, type TaskProgress, TaskStatus } from './Task';

/**
 * Conflict resolution strategies for copy-paste operations
 */
export enum ConflictResolutionStrategy {
    Abort = 'abort',
    // Future options: Overwrite = 'overwrite', Skip = 'skip'
}

/**
 * Configuration for copy-paste operations
 */
export interface CopyPasteConfig {
    /**
     * Source collection information
     */
    source: {
        connectionId: string;
        databaseName: string;
        collectionName: string;
    };

    /**
     * Target collection information
     */
    target: {
        connectionId: string;
        databaseName: string;
        collectionName: string;
    };

    /**
     * Conflict resolution strategy
     */
    onConflict: ConflictResolutionStrategy;

    /**
     * Optional reference to a connection manager or client object.
     * For now, this is typed as `any` to allow flexibility.
     * Specific task implementations (e.g., for MongoDB) will cast this to their
     * required client/connection type.
     */
    connectionManager?: unknown;
}

/**
 * Task implementation for copying documents from one collection to another
 */
export class CopyPasteCollectionTask implements Task {
    private _status: TaskStatus = TaskStatus.Pending;
    private _progress?: TaskProgress;
    private _error?: Error;
    private _statusCallbacks: Array<(task: Task) => void> = [];
    private _progressCallbacks: Array<(task: Task) => void> = [];
    private _abortController?: AbortController;
    private _buffer?: DocumentBuffer<DocumentDetails>;

    constructor(
        public readonly id: string,
        public readonly description: string,
        private readonly config: CopyPasteConfig,
        private readonly reader: DocumentReader,
        private readonly writer: DocumentWriter,
    ) {}

    get status(): TaskStatus {
        return this._status;
    }

    get progress(): TaskProgress | undefined {
        return this._progress;
    }

    get error(): Error | undefined {
        return this._error;
    }

    async execute(): Promise<void> {
        try {
            this._abortController = new AbortController();
            this._setStatus(TaskStatus.Initializing);

            // Step 1: Count documents for progress tracking
            this._setProgress(0, -1, 'Counting source documents...');
            const totalDocuments = await this.reader.countDocuments(
                this.config.source.connectionId,
                this.config.source.databaseName,
                this.config.source.collectionName,
            );

            this._setProgress(0, totalDocuments, 'Preparing target collection...');

            // Step 2: Ensure target collection exists
            await this.writer.ensureCollectionExists(
                this.config.target.connectionId,
                this.config.target.databaseName,
                this.config.target.collectionName,
            );

            // Step 3: Initialize buffer for streaming
            this._buffer = createMongoDbBuffer<DocumentDetails>();
            this._setStatus(TaskStatus.Running);

            // Step 4: Start streaming and copying documents
            let processedCount = 0;
            const documentStream = this.reader.streamDocuments(
                this.config.source.connectionId,
                this.config.source.databaseName,
                this.config.source.collectionName,
            );

            this._setProgress(0, totalDocuments, 'Copying documents...');

            for await (const document of documentStream) {
                // Check for cancellation
                if (this._abortController?.signal.aborted) {
                    throw new Error('Operation was cancelled');
                }

                // Try to add document to buffer
                const bufferResult = this._buffer.insertOrFlush(document);

                if (bufferResult.documentsToProcess && bufferResult.documentsToProcess.length > 0) {
                    // Write buffered documents
                    await this._writeDocuments(bufferResult.documentsToProcess);
                    processedCount += bufferResult.documentsToProcess.length;

                    // Update progress
                    this._setProgress(processedCount, totalDocuments, 'Copying documents...');

                    // If the document wasn't added to buffer due to being too large, handle it separately
                    if (!bufferResult.success) {
                        await this._writeDocuments([document]);
                        processedCount += 1;
                        this._setProgress(processedCount, totalDocuments, 'Copying documents...');
                    }
                }
            }

            // Flush any remaining documents in the buffer
            const remainingDocuments = this._buffer.flush();
            if (remainingDocuments.length > 0) {
                await this._writeDocuments(remainingDocuments);
                processedCount += remainingDocuments.length;
            }

            // Final progress update
            this._setProgress(processedCount, totalDocuments, 'Copy operation completed');
            this._setStatus(TaskStatus.Completed);
        } catch (error) {
            this._error = error instanceof Error ? error : new Error(String(error));
            this._setStatus(TaskStatus.Failed);
            throw this._error;
        }
    }

    async cancel(): Promise<void> {
        if (this._abortController) {
            this._abortController.abort();
        }
        this._setStatus(TaskStatus.Failed);
        this._error = new Error('Operation was cancelled');
    }

    onStatusChange(callback: (task: Task) => void): () => void {
        this._statusCallbacks.push(callback);
        return () => {
            const index = this._statusCallbacks.indexOf(callback);
            if (index > -1) {
                this._statusCallbacks.splice(index, 1);
            }
        };
    }

    onProgressChange(callback: (task: Task) => void): () => void {
        this._progressCallbacks.push(callback);
        return () => {
            const index = this._progressCallbacks.indexOf(callback);
            if (index > -1) {
                this._progressCallbacks.splice(index, 1);
            }
        };
    }

    private _setStatus(status: TaskStatus): void {
        this._status = status;
        this._statusCallbacks.forEach((callback) => callback(this));
    }

    private _setProgress(completed: number, total: number, message?: string): void {
        this._progress = { completed, total, message };
        this._progressCallbacks.forEach((callback) => callback(this));
    }

    private async _writeDocuments(documents: DocumentDetails[]): Promise<void> {
        const result: BulkWriteResult = await this.writer.writeDocuments(
            this.config.target.connectionId,
            this.config.target.databaseName,
            this.config.target.collectionName,
            documents,
        );

        // Handle write errors based on conflict resolution strategy
        if (result.errors.length > 0) {
            switch (this.config.onConflict) {
                case ConflictResolutionStrategy.Abort:
                    // Throw the first error to abort the operation
                    throw result.errors[0].error;
                default:
                    // For future conflict strategies, handle accordingly
                    throw new Error(`Unsupported conflict resolution strategy: ${this.config.onConflict}`);
            }
        }
    }
}