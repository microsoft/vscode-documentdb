/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CollectionIndexCopier, type IndexCopyResult } from '../../data-api/indexes/CollectionIndexCopier';
import { type DocumentReader } from '../../data-api/types';
import { type StreamingDocumentWriter, StreamingWriterError } from '../../data-api/writers/StreamingDocumentWriter';
import { type TaskTelemetryContext } from '../../taskHost';
import { Task } from '../../taskService';
import { type ResourceDefinition, type ResourceTrackingTask } from '../../taskServiceResourceTracking';
import {
    type CopyCollectionStrings,
    type CopyPasteCollectionTaskOptions,
    defaultCopyCollectionStrings,
} from './copyCollectionStrings';
import { type CopyPasteConfig } from './copyPasteConfig';

/**
 * Error thrown when source validation fails for copy-paste operations.
 * This is used to distinguish user-facing validation errors from other errors (e.g., network issues).
 */
export class SourceValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SourceValidationError';
    }
}

/**
 * Task for copying documents from a source to a target collection.
 *
 * This task uses a database-agnostic approach with `DocumentReader` and `StreamingDocumentWriter`
 * interfaces. It uses StreamingDocumentWriter to stream documents from the source and write
 * them in batches to the target, managing memory usage with a configurable buffer.
 */
export class CopyPasteCollectionTask extends Task implements ResourceTrackingTask {
    public readonly type: string = 'copy-paste-collection';
    public readonly name: string;

    private readonly config: CopyPasteConfig;
    private readonly copyCollectionStrings: CopyCollectionStrings;
    private readonly validateSource?: CopyPasteCollectionTaskOptions['validateSource'];
    private readonly collectMetadata?: CopyPasteCollectionTaskOptions['collectMetadata'];
    private readonly documentReader: DocumentReader;
    private readonly documentWriter: StreamingDocumentWriter;
    private readonly indexCopier?: CollectionIndexCopier;
    private readonly indexPresentationDelayMs: number;
    private sourceDocumentCount: number = 0;
    private totalProcessedDocuments: number = 0;

    // Timeout reassurance: tracks when to show "still working" messages
    private reassuranceTimer?: NodeJS.Timeout;
    private reassuranceTicks: number = 0;
    private static readonly REASSURANCE_INTERVAL_MS = 1000;
    private static readonly REASSURANCE_START_TICKS = 2; // Start showing after 2 seconds
    private static readonly MAX_REASSURANCE_TICKS = 16; // Stop after 16 seconds
    private static readonly INDEX_PRESENTATION_DELAY_MS = 5000;

    /**
     * Creates a new CopyPasteCollectionTask instance.
     *
     * @param config Configuration for the copy-paste operation
     * @param documentReader Reader implementation for the source database
     * @param documentWriter StreamingDocumentWriter implementation for the target database
     */
    constructor(
        config: CopyPasteConfig,
        documentReader: DocumentReader,
        documentWriter: StreamingDocumentWriter,
        indexCopier?: CollectionIndexCopier,
        indexPresentationDelayMs: number = CopyPasteCollectionTask.INDEX_PRESENTATION_DELAY_MS,
        options?: CopyPasteCollectionTaskOptions,
    ) {
        super(options);
        this.config = config;
        this.copyCollectionStrings = { ...defaultCopyCollectionStrings, ...options?.copyCollectionStrings };
        this.validateSource = options?.validateSource;
        this.collectMetadata = options?.collectMetadata;
        this.documentReader = documentReader;
        this.documentWriter = documentWriter;
        this.indexCopier = indexCopier;
        this.indexPresentationDelayMs = indexPresentationDelayMs;

        // Generate a descriptive name for the task
        this.name = this.copyCollectionStrings.taskName(
            config.source.collectionName,
            config.source.databaseName,
            config.target.databaseName,
            config.target.collectionName,
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
                clusterId: this.config.source.clusterId,
                databaseName: this.config.source.databaseName,
                collectionName: this.config.source.collectionName,
            },
            // Target resource
            {
                clusterId: this.config.target.clusterId,
                databaseName: this.config.target.databaseName,
                collectionName: this.config.target.collectionName,
            },
        ];
    }

    /**
     * Initializes the task by counting documents and ensuring target collection exists.
     *
     * @param signal AbortSignal to check for cancellation
     * @param context Optional telemetry context for tracking task operations
     */
    protected async onInitialize(signal: AbortSignal, context?: TaskTelemetryContext): Promise<void> {
        if (context) {
            context.telemetry.properties.copyOperationCorrelationId = this.config.copyOperationCorrelationId;
        }
        if (this.validateSource) {
            this.updateStatus(this.getStatus().state, this.copyCollectionStrings.validatingSourceCollection);
            try {
                await this.validateSource(signal, context);
            } catch (error) {
                if (error instanceof SourceValidationError) {
                    throw error;
                }
                throw new Error(
                    this.copyCollectionStrings.failedToValidateSource(
                        error instanceof Error ? error.message : String(error),
                    ),
                );
            }
        }

        // Add copy-paste specific telemetry properties
        if (context) {
            context.telemetry.properties.onConflict = this.config.onConflict;
            context.telemetry.properties.copyIndexes = this.config.copyIndexes ? 'true' : 'false';
            context.telemetry.properties.isCrossConnection =
                this.config.source.clusterId !== this.config.target.clusterId ? 'true' : 'false';

            try {
                await this.collectMetadata?.(context);
            } catch {
                // Metadata collection must not fail the task.
            }
        }

        // Count total documents for progress calculation
        this.updateStatus(this.getStatus().state, this.copyCollectionStrings.countingSourceDocuments);

        try {
            this.sourceDocumentCount = await this.documentReader.countDocuments(signal, context);

            // Add document count to telemetry
            if (context) {
                context.telemetry.measurements.sourceDocumentCount = this.sourceDocumentCount;
            }
        } catch (error) {
            throw new Error(this.copyCollectionStrings.failedToCountSourceDocuments, {
                cause: error,
            });
        }

        if (signal.aborted) {
            return;
        }

        // Ensure target exists
        this.updateStatus(this.getStatus().state, this.copyCollectionStrings.ensuringTargetExists);

        try {
            const ensureTargetResult = await this.documentWriter.ensureTargetExists();

            // Add telemetry about whether the target was created
            if (context) {
                context.telemetry.properties.targetWasCreated = ensureTargetResult.targetWasCreated ? 'true' : 'false';
            }
        } catch (error) {
            throw new Error(this.copyCollectionStrings.failedToEnsureTargetExists, {
                cause: error,
            });
        }
    }

    /**
     * Performs the main copy-paste operation using StreamingDocumentWriter.
     *
     * @param signal AbortSignal to check for cancellation
     * @param context Optional telemetry context for tracking task operations
     */
    protected async doWork(signal: AbortSignal, context?: TaskTelemetryContext): Promise<void> {
        if (context) {
            context.telemetry.properties.copyOperationCorrelationId = this.config.copyOperationCorrelationId;
        }
        if (this.config.copyIndexes) {
            await this.copyIndexes(signal, context);
        }

        if (signal.aborted) {
            return;
        }

        // Handle empty source collection
        if (this.sourceDocumentCount === 0) {
            this.updateProgress(100, this.copyCollectionStrings.sourceCollectionEmpty);
            if (context) {
                context.telemetry.measurements.totalProcessedDocuments = 0;
                context.telemetry.measurements.bufferFlushCount = 0;
            }

            return;
        }

        // Create document stream with keep-alive enabled to prevent database timeouts
        const documentStream = this.documentReader.streamDocuments({
            signal,
            keepAlive: true,
            actionContext: context,
        });

        // Stream documents with progress tracking using the unified StreamingDocumentWriter
        // Start reassurance timer to show "still working" messages during long batch writes
        this.startReassuranceTimer();

        try {
            const result = await this.documentWriter.streamDocuments(
                documentStream,
                { conflictResolutionStrategy: this.config.onConflict },
                {
                    onProgress: (processedCount, details) => {
                        // Reset reassurance tick count on each real progress update
                        this.reassuranceTicks = 0;

                        // Update task's total
                        this.totalProcessedDocuments += processedCount;

                        // Calculate and report progress percentage
                        const progressPercentage = Math.min(
                            100,
                            Math.round((this.totalProcessedDocuments / this.sourceDocumentCount) * 100),
                        );

                        // Build progress message with optional details
                        let progressMessage = this.getProgressMessage(progressPercentage);
                        if (details) {
                            progressMessage += ` - ${details}`;
                        }

                        this.logger.trace(
                            `[CopyPasteTask] onProgress: ${progressPercentage}% (${this.totalProcessedDocuments}/${this.sourceDocumentCount} docs) - ${progressMessage}`,
                        );

                        this.updateProgress(progressPercentage, progressMessage);
                    },
                    abortSignal: signal,
                    actionContext: context,
                },
            );

            // Stop reassurance timer
            this.stopReassuranceTimer();

            // Add streaming statistics to telemetry (includes all counts)
            if (context) {
                context.telemetry.measurements.totalProcessedDocuments = result.totalProcessed;
                context.telemetry.measurements.totalInsertedDocuments = result.insertedCount ?? 0;
                context.telemetry.measurements.totalSkippedDocuments = result.skippedCount ?? 0;
                context.telemetry.measurements.totalReplacedDocuments = result.replacedCount ?? 0;
                context.telemetry.measurements.totalCreatedDocuments = result.createdCount ?? 0;
                context.telemetry.measurements.bufferFlushCount = result.flushCount;
            }

            // Final progress update with summary
            const summaryMessage = this.buildSummaryMessage(result);
            this.updateProgress(100, summaryMessage);
        } catch (error) {
            // Stop reassurance timer on error
            this.stopReassuranceTimer();
            // Check if it's a StreamingWriterError with partial statistics
            if (error instanceof StreamingWriterError) {
                // Add partial statistics to telemetry even on error
                if (context) {
                    context.telemetry.properties.errorDuringStreaming = 'true';
                    context.telemetry.measurements.totalProcessedDocuments = error.partialStats.totalProcessed;
                    context.telemetry.measurements.totalInsertedDocuments = error.partialStats.insertedCount ?? 0;
                    context.telemetry.measurements.totalSkippedDocuments = error.partialStats.skippedCount ?? 0;
                    context.telemetry.measurements.totalReplacedDocuments = error.partialStats.replacedCount ?? 0;
                    context.telemetry.measurements.totalCreatedDocuments = error.partialStats.createdCount ?? 0;
                    context.telemetry.measurements.bufferFlushCount = error.partialStats.flushCount;
                }

                // Build error message with partial stats
                const partialSummary = this.buildSummaryMessage(error.partialStats);
                const errorMessage = this.copyCollectionStrings.failedAfterPartialCompletion(partialSummary);

                // Update error message to include partial stats
                throw new Error(`${errorMessage}\n${error.message}`);
            }

            // Regular error - add basic telemetry
            if (context) {
                context.telemetry.properties.errorDuringStreaming = 'true';
                context.telemetry.measurements.processedBeforeError = this.totalProcessedDocuments;
            }
            throw error;
        }
    }

    private async copyIndexes(signal: AbortSignal, context?: TaskTelemetryContext): Promise<void> {
        if (!this.indexCopier) {
            throw new Error(this.copyCollectionStrings.indexCopyServicesNotConfigured);
        }

        this.updateProgress(0, this.copyCollectionStrings.copyingIndexesBeforeDocuments);
        this.logger.trace('[CopyPasteTask] Starting index copy phase.');

        let result: IndexCopyResult;
        try {
            result = await this.indexCopier.copyIndexes({
                signal,
                onStart: (total) => {
                    this.updateProgress(0, this.copyCollectionStrings.copyingIndexes(total.toString()));
                },
                onProgress: ({ completed, total, indexName }) => {
                    this.logger.trace(`[CopyPasteTask] Index copy progress: ${completed}/${total} (${indexName}).`);
                },
            });
        } catch (error) {
            if (signal.aborted) {
                throw error;
            }

            const errorMessage = error instanceof Error ? error.message : String(error);
            if (context) {
                context.telemetry.properties.indexCopyFailed = 'true';
                context.telemetry.properties.indexCopyError = error instanceof Error ? error.name : 'UnknownError';
            }
            throw new Error(this.copyCollectionStrings.failedToCopyIndexes(errorMessage), {
                cause: error,
            });
        }

        if (context) {
            context.telemetry.measurements.selectedIndexCount = result.selectedIndexCount;
            context.telemetry.measurements.createdIndexCount = result.createdCount;
            context.telemetry.measurements.skippedIndexCount = result.skippedCount;
            context.telemetry.measurements.renamedIndexCount = result.renamedCount;
            context.telemetry.measurements.conflictingIndexCount = result.conflictingCount;
            context.telemetry.properties.indexCopyCancelled = result.cancelled ? 'true' : 'false';
            context.telemetry.properties.indexCopyFailed = 'false';
        }

        if (result.cancelled) {
            this.logger.warn(
                `[CopyPasteTask] Index copy was cancelled after ${result.createdCount} indexes were created. Created indexes remain on the target.`,
            );
        } else {
            this.logger.trace(
                `[CopyPasteTask] Index copy completed: ${result.createdCount} created, ${result.skippedCount} skipped, ${result.conflictingCount} conflicts, ${result.renamedCount} renamed.`,
            );
        }

        if (result.createdCount > 0 && !signal.aborted) {
            this.updateProgress(
                0,
                this.copyCollectionStrings.indexesCopied(result.createdCount.toString()),
            );
            await this.waitForPresentationDelay(signal, this.indexPresentationDelayMs);
        }
    }

    private async waitForPresentationDelay(signal: AbortSignal, delayMs: number): Promise<void> {
        await new Promise<void>((resolve) => {
            const onAbort = (): void => {
                clearTimeout(timeout);
                resolve();
            };
            const timeout = setTimeout(() => {
                signal.removeEventListener('abort', onAbort);
                resolve();
            }, delayMs);
            signal.addEventListener('abort', onAbort, { once: true });
        });
    }

    /**
     * Builds a summary message from streaming statistics.
     * Only shows statistics that are relevant (non-zero) to avoid clutter.
     *
     * @param stats Streaming statistics to summarize
     * @returns Formatted summary message
     */
    private buildSummaryMessage(stats: {
        totalProcessed: number;
        insertedCount?: number;
        skippedCount?: number;
        replacedCount?: number;
        createdCount?: number;
    }): string {
        const parts: string[] = [];

        // Always show total processed
        parts.push(this.copyCollectionStrings.processed(stats.totalProcessed.toLocaleString()));

        // Add strategy-specific breakdown (only non-zero counts)
        if ((stats.insertedCount ?? 0) > 0) {
            parts.push(this.copyCollectionStrings.inserted((stats.insertedCount ?? 0).toLocaleString()));
        }
        if ((stats.skippedCount ?? 0) > 0) {
            parts.push(this.copyCollectionStrings.skipped((stats.skippedCount ?? 0).toLocaleString()));
        }
        if ((stats.replacedCount ?? 0) > 0) {
            parts.push(this.copyCollectionStrings.replaced((stats.replacedCount ?? 0).toLocaleString()));
        }
        if ((stats.createdCount ?? 0) > 0) {
            parts.push(this.copyCollectionStrings.created((stats.createdCount ?? 0).toLocaleString()));
        }

        return parts.join(', ');
    }

    /**
     * Generates an appropriate progress message based on the conflict resolution strategy.
     *
     * @param progressPercentage Optional percentage to include in message
     * @param suffix Optional suffix to append (e.g., "still working...")
     * @returns Localized progress message
     */
    private getProgressMessage(progressPercentage?: number, suffix?: string): string {
        // Format: "45% - 1,234/5,678 documents" with optional suffix
        const percentageStr = progressPercentage !== undefined ? `${progressPercentage}% - ` : '';
        const countStr = this.copyCollectionStrings.documentProgress(
            this.totalProcessedDocuments.toLocaleString(),
            this.sourceDocumentCount.toLocaleString(),
        );

        const baseMessage = `${percentageStr}${countStr}`;
        return suffix ? `${baseMessage} (${suffix})` : baseMessage;
    }

    /**
     * Starts the reassurance timer that shows "still working" messages
     * when no progress updates have been received for a while.
     *
     * After 2 seconds of no progress, shows "writing batch..." and adds
     * one dot per second to indicate the system is still working.
     */
    private startReassuranceTimer(): void {
        this.reassuranceTicks = 0;

        this.reassuranceTimer = setInterval(() => {
            this.reassuranceTicks++;

            // Only show reassurance after 2 seconds, stop after max ticks
            if (
                this.reassuranceTicks >= CopyPasteCollectionTask.REASSURANCE_START_TICKS &&
                this.reassuranceTicks <= CopyPasteCollectionTask.MAX_REASSURANCE_TICKS
            ) {
                // Calculate current progress percentage
                const progressPercentage =
                    this.sourceDocumentCount > 0
                        ? Math.min(100, Math.round((this.totalProcessedDocuments / this.sourceDocumentCount) * 100))
                        : undefined;

                // Build suffix with growing dots: "writing batch..." then "writing batch...." etc.
                const extraDots = '.'.repeat(this.reassuranceTicks - CopyPasteCollectionTask.REASSURANCE_START_TICKS);
                const suffix = this.copyCollectionStrings.writingBatch + extraDots;
                const message = this.getProgressMessage(progressPercentage, suffix);
                this.updateProgress(progressPercentage ?? 0, message);
            }
        }, CopyPasteCollectionTask.REASSURANCE_INTERVAL_MS);
    }

    /**
     * Stops the reassurance timer.
     */
    private stopReassuranceTimer(): void {
        if (this.reassuranceTimer) {
            clearInterval(this.reassuranceTimer);
            this.reassuranceTimer = undefined;
        }
    }
}
