/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ClustersClient } from '../../../../documentdb/ClustersClient';
import { ext } from '../../../../extensionVariables';
import { Task } from '../../taskService';
import { type ResourceDefinition, type ResourceTrackingTask } from '../../taskServiceResourceTracking';
import { ConflictResolutionStrategy, type CopyPasteConfig } from './copyPasteConfig';
import { type DocumentDetails, type DocumentReader, type DocumentWriter } from './documentInterfaces';

/**
 * Interface for running statistics with reservoir sampling for median approximation.
 */
interface RunningStats {
    count: number;
    sum: number;
    min: number;
    max: number;
    reservoir: number[];
    reservoirSize: number;
}

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
    private sourceDocumentCount: number = 0;
    private processedDocuments: number = 0;
    private copiedDocuments: number = 0;

    // Buffer configuration for memory management
    private readonly bufferSize: number = 100; // Number of documents to buffer
    private readonly maxBufferMemoryMB: number = 32; // Rough memory limit for buffer

    // Performance tracking fields - using running statistics for memory efficiency
    private documentSizeStats: RunningStats = {
        count: 0,
        sum: 0,
        min: Number.MAX_VALUE,
        max: 0,
        // Reservoir sampling for approximate median (fixed size sample)
        reservoir: [],
        reservoirSize: 1000,
    };

    private flushDurationStats: RunningStats = {
        count: 0,
        sum: 0,
        min: Number.MAX_VALUE,
        max: 0,
        // Reservoir sampling for approximate median
        reservoir: [],
        reservoirSize: 100, // Smaller sample since we have fewer flush operations
    };

    private conflictStats = {
        skippedCount: 0,
        overwrittenCount: 0, // Note: may not be directly available depending on strategy
        errorCount: 0,
    };

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
     * Collects cluster metadata for telemetry purposes.
     * This method attempts to gather cluster information without failing the task if metadata collection fails.
     *
     * @param connectionId Connection ID to collect metadata for
     * @param prefix Prefix for telemetry properties (e.g., 'source' or 'target')
     * @param context Telemetry context to add properties to
     */
    private async collectClusterMetadata(connectionId: string, prefix: string, context: IActionContext): Promise<void> {
        try {
            const client = await ClustersClient.getClient(connectionId);
            const metadata = await client.getClusterMetadata();

            // Add metadata with prefix to avoid conflicts between source and target
            for (const [key, value] of Object.entries(metadata)) {
                if (value !== undefined && value !== null) {
                    context.telemetry.properties[`${prefix}_${key}`] = String(value);
                }
            }

            context.telemetry.properties[`${prefix}_metadataCollectionSuccess`] = 'true';
        } catch (error) {
            // Log the error but don't fail the task
            context.telemetry.properties[`${prefix}_metadata_error`] =
                error instanceof Error ? error.message : 'Unknown error';
            context.telemetry.properties[`${prefix}_metadataCollectionSuccess`] = 'false';
        }
    }

    /**
     * Initializes the task by counting documents and ensuring target collection exists.
     *
     * @param signal AbortSignal to check for cancellation
     * @param context Optional telemetry context for tracking task operations
     */
    protected async onInitialize(signal: AbortSignal, context?: IActionContext): Promise<void> {
        // Add copy-paste specific telemetry properties
        if (context) {
            context.telemetry.properties.onConflict = this.config.onConflict;
            context.telemetry.properties.isCrossConnection = (
                this.config.source.connectionId !== this.config.target.connectionId
            ).toString();

            // Collect cluster metadata for source and target connections and await their completion (non-blocking for errors)
            const metadataPromises = [this.collectClusterMetadata(this.config.source.connectionId, 'source', context)];
            if (this.config.source.connectionId !== this.config.target.connectionId) {
                metadataPromises.push(this.collectClusterMetadata(this.config.target.connectionId, 'target', context));
            }
            await Promise.allSettled(metadataPromises);
        }

        // Count total documents for progress calculation
        this.updateStatus(this.getStatus().state, vscode.l10n.t('Counting documents in the source collection...'));

        try {
            this.sourceDocumentCount = await this.documentReader.countDocuments(
                this.config.source.connectionId,
                this.config.source.databaseName,
                this.config.source.collectionName,
            );

            // Add document count to telemetry
            if (context) {
                context.telemetry.measurements.sourceDocumentCount = this.sourceDocumentCount;
            }
        } catch (error) {
            throw new Error(vscode.l10n.t('Failed to count documents in the source collection.'), {
                cause: error,
            });
        }

        if (signal.aborted) {
            return;
        }

        // Ensure target collection exists
        this.updateStatus(this.getStatus().state, vscode.l10n.t('Ensuring target collection exists...'));

        try {
            const ensureCollectionResult = await this.documentWriter.ensureCollectionExists(
                this.config.target.connectionId,
                this.config.target.databaseName,
                this.config.target.collectionName,
            );

            // Add telemetry about whether the collection was created
            if (context) {
                context.telemetry.properties.targetCollectionWasCreated =
                    ensureCollectionResult.collectionWasCreated.toString();
            }
        } catch (error) {
            throw new Error(vscode.l10n.t('Failed to ensure the target collection exists.'), {
                cause: error,
            });
        }
    }

    /**
     * Performs the main copy-paste operation using buffer-based streaming.
     *
     * @param signal AbortSignal to check for cancellation
     * @param context Optional telemetry context for tracking task operations
     */
    protected async doWork(signal: AbortSignal, context?: IActionContext): Promise<void> {
        // Add execution-specific telemetry
        if (context) {
            context.telemetry.properties.bufferSize = this.bufferSize.toString();
            context.telemetry.properties.maxBufferMemoryMB = this.maxBufferMemoryMB.toString();
        }

        // Handle the case where there are no documents to copy
        if (this.sourceDocumentCount === 0) {
            this.updateProgress(100, vscode.l10n.t('Source collection is empty.'));
            if (context) {
                context.telemetry.measurements.processedDocuments = 0;
                context.telemetry.measurements.copiedDocuments = 0;
                context.telemetry.measurements.bufferFlushCount = 0;
            }
            return;
        }

        const documentStream = this.documentReader.streamDocuments(
            this.config.source.connectionId,
            this.config.source.databaseName,
            this.config.source.collectionName,
        );

        const buffer: DocumentDetails[] = [];
        let bufferMemoryEstimate = 0;
        let bufferFlushCount = 0;

        for await (const document of documentStream) {
            if (signal.aborted) {
                // Add telemetry for aborted operation during document processing
                this.addPerformanceStatsToTelemetry(context, bufferFlushCount, {
                    abortedDuringProcessing: true,
                    completionPercentage:
                        this.sourceDocumentCount > 0
                            ? Math.round((this.processedDocuments / this.sourceDocumentCount) * 100)
                            : 0,
                });
                // Buffer is a local variable, no need to clear, just exit.
                return;
            }

            // Track document size for statistics
            const documentSize = this.estimateDocumentMemory(document);
            this.updateRunningStats(this.documentSizeStats, documentSize);

            // Add document to buffer
            buffer.push(document);
            bufferMemoryEstimate += documentSize;

            // Check if we need to flush the buffer
            if (this.shouldFlushBuffer(buffer.length, bufferMemoryEstimate)) {
                try {
                    await this.flushBuffer(buffer, signal);
                    bufferFlushCount++;
                } catch (error) {
                    // Add telemetry before re-throwing error to capture performance data
                    this.addPerformanceStatsToTelemetry(context, bufferFlushCount, {
                        errorDuringFlush: true,
                        errorStrategy: this.config.onConflict,
                        completionPercentage:
                            this.sourceDocumentCount > 0
                                ? Math.round((this.processedDocuments / this.sourceDocumentCount) * 100)
                                : 0,
                    });
                    throw error;
                }
                buffer.length = 0; // Clear buffer
                bufferMemoryEstimate = 0;
            }
        }

        if (signal.aborted) {
            // Add telemetry for aborted operation after stream completion
            this.addPerformanceStatsToTelemetry(context, bufferFlushCount, {
                abortedAfterProcessing: true,
                remainingBufferedDocuments: buffer.length,
                completionPercentage:
                    this.sourceDocumentCount > 0
                        ? Math.round(((this.processedDocuments + buffer.length) / this.sourceDocumentCount) * 100)
                        : 100, // Stream completed means 100% if no source documents
            });
            return;
        }

        // Flush any remaining documents in the buffer
        if (buffer.length > 0) {
            try {
                await this.flushBuffer(buffer, signal);
                bufferFlushCount++;
            } catch (error) {
                // Add telemetry before re-throwing error to capture performance data
                this.addPerformanceStatsToTelemetry(context, bufferFlushCount, {
                    errorDuringFinalFlush: true,
                    errorStrategy: this.config.onConflict,
                    remainingBufferedDocuments: buffer.length,
                    completionPercentage:
                        this.sourceDocumentCount > 0
                            ? Math.round(((this.processedDocuments + buffer.length) / this.sourceDocumentCount) * 100)
                            : 100,
                });
                throw error;
            }
        }

        // Add final telemetry measurements
        this.addPerformanceStatsToTelemetry(context, bufferFlushCount, {
            abortedAfterProcessing: false,
            completionPercentage: 100,
        });

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

        // Track flush duration for performance telemetry
        const startTime = Date.now();

        const result = await this.documentWriter.writeDocuments(
            this.config.target.connectionId,
            this.config.target.databaseName,
            this.config.target.collectionName,
            this.config,
            buffer,
            { batchSize: buffer.length },
        );

        // Record flush duration
        const flushDuration = Date.now() - startTime;
        this.updateRunningStats(this.flushDurationStats, flushDuration);

        // Update counters - all documents in the buffer were processed (attempted)
        this.processedDocuments += buffer.length;
        this.copiedDocuments += result.insertedCount;

        // Check for errors in the write result and track conflict statistics
        if (result.errors && result.errors.length > 0) {
            // Update conflict statistics
            this.conflictStats.errorCount += result.errors.length;

            // Handle errors based on the configured conflict resolution strategy.
            if (this.config.onConflict === ConflictResolutionStrategy.Abort) {
                // Abort strategy: fail the entire task on the first error.
                for (const error of result.errors) {
                    ext.outputChannel.error(
                        vscode.l10n.t('Error inserting document (Abort): {0}', error.error?.message ?? 'Unknown error'),
                    );
                }
                ext.outputChannel.show();

                const firstError = result.errors[0] as { error: Error };
                throw new Error(
                    vscode.l10n.t(
                        'Task aborted due to an error: {0}. {1} document(s) were inserted in total.',
                        firstError.error?.message ?? 'Unknown error',
                        this.copiedDocuments.toString(),
                    ),
                );
            } else if (this.config.onConflict === ConflictResolutionStrategy.Skip) {
                // Skip strategy: log each error and continue.
                this.conflictStats.skippedCount += result.errors.length;
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
                    ext.outputChannel.error(
                        vscode.l10n.t(
                            'Error inserting document (GenerateNewIds): {0}',
                            error.error?.message ?? 'Unknown error',
                        ),
                    );
                }
                ext.outputChannel.show();
            } else {
                // Overwrite or other strategies: treat errors as fatal for now.
                for (const error of result.errors) {
                    ext.outputChannel.error(
                        vscode.l10n.t(
                            'Error inserting document (Overwrite): {0}',
                            error.error?.message ?? 'Unknown error',
                        ),
                    );
                    ext.outputChannel.show();
                }

                // This can be expanded if other strategies need more nuanced error handling.
                const firstError = result.errors[0] as { error: Error };
                throw new Error(
                    vscode.l10n.t(
                        'An error occurred while writing documents. Error Count: {0}, First error details: {1}',
                        result.errors.length,
                        firstError.error?.message ?? 'Unknown error',
                    ),
                );
            }
        }

        // Update progress
        const progress = Math.min(100, (this.processedDocuments / this.sourceDocumentCount) * 100);
        this.updateProgress(progress, this.getProgressMessage());
    }

    /**
     * Generates an appropriate progress message based on the conflict resolution strategy.
     *
     * @returns Localized progress message
     */
    private getProgressMessage(): string {
        if (this.config.onConflict === ConflictResolutionStrategy.Skip && this.conflictStats.skippedCount > 0) {
            // Verbose message showing processed, copied, and skipped counts
            return vscode.l10n.t(
                'Processed {0} of {1} documents ({2} copied, {3} skipped)',
                this.processedDocuments,
                this.sourceDocumentCount,
                this.copiedDocuments,
                this.conflictStats.skippedCount,
            );
        } else {
            // Simple message for other strategies
            return vscode.l10n.t('Processed {0} of {1} documents', this.processedDocuments, this.sourceDocumentCount);
        }
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

    /**
     * Updates running statistics with a new value using reservoir sampling for median approximation.
     * This generic method works for both document size and flush duration statistics.
     *
     * @param stats The statistics object to update
     * @param value The new value to add to the statistics
     */
    private updateRunningStats(stats: RunningStats, value: number): void {
        stats.count++;
        stats.sum += value;
        stats.min = Math.min(stats.min, value);
        stats.max = Math.max(stats.max, value);

        // Reservoir sampling for median approximation
        if (stats.reservoir.length < stats.reservoirSize) {
            stats.reservoir.push(value);
        } else {
            // Randomly replace an element in the reservoir
            const randomIndex = Math.floor(Math.random() * stats.count);
            if (randomIndex < stats.reservoirSize) {
                stats.reservoir[randomIndex] = value;
            }
        }
    }

    /**
     * Adds performance statistics to telemetry context.
     *
     * @param context Telemetry context to add measurements to
     * @param bufferFlushCount Number of buffer flushes performed
     * @param additionalProperties Optional additional properties to add
     */
    private addPerformanceStatsToTelemetry(
        context: IActionContext | undefined,
        bufferFlushCount: number,
        additionalProperties?: Record<string, string | number | boolean>,
    ): void {
        if (!context) {
            return;
        }

        // Basic performance metrics
        context.telemetry.measurements.processedDocuments = this.processedDocuments;
        context.telemetry.measurements.copiedDocuments = this.copiedDocuments;
        context.telemetry.measurements.bufferFlushCount = bufferFlushCount;

        // Add document size statistics from running data
        const docSizeStats = this.getStatsFromRunningData(this.documentSizeStats);
        context.telemetry.measurements.documentSizeMinBytes = docSizeStats.min;
        context.telemetry.measurements.documentSizeMaxBytes = docSizeStats.max;
        context.telemetry.measurements.documentSizeAvgBytes = docSizeStats.average;
        context.telemetry.measurements.documentSizeMedianBytes = docSizeStats.median;

        // Add buffer flush duration statistics from running data
        const flushDurationStats = this.getStatsFromRunningData(this.flushDurationStats);
        context.telemetry.measurements.flushDurationMinMs = flushDurationStats.min;
        context.telemetry.measurements.flushDurationMaxMs = flushDurationStats.max;
        context.telemetry.measurements.flushDurationAvgMs = flushDurationStats.average;
        context.telemetry.measurements.flushDurationMedianMs = flushDurationStats.median;

        // Add conflict resolution statistics
        context.telemetry.measurements.conflictSkippedCount = this.conflictStats.skippedCount;
        context.telemetry.measurements.conflictErrorCount = this.conflictStats.errorCount;

        // Add any additional properties
        if (additionalProperties) {
            for (const [key, value] of Object.entries(additionalProperties)) {
                if (typeof value === 'string') {
                    context.telemetry.properties[key] = value;
                } else if (typeof value === 'boolean') {
                    context.telemetry.properties[key] = value.toString();
                } else {
                    context.telemetry.measurements[key] = value;
                }
            }
        }
    }

    /**
     * Gets statistics from running statistics data.
     *
     * @param stats Running statistics object
     * @returns Statistics object with min, max, average, and approximate median
     */
    private getStatsFromRunningData(stats: RunningStats): {
        min: number;
        max: number;
        average: number;
        median: number;
    } {
        if (stats.count === 0) {
            return { min: 0, max: 0, average: 0, median: 0 };
        }

        const min = stats.min === Number.MAX_VALUE ? 0 : stats.min;
        const max = stats.max;
        const average = stats.sum / stats.count;

        let median: number;
        if (stats.reservoir.length > 0) {
            // Calculate median from reservoir sample
            const sorted = [...stats.reservoir].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
        } else {
            // Fallback to simple approximation
            median = (min + max) / 2;
        }

        return { min, max, average, median };
    }
}
