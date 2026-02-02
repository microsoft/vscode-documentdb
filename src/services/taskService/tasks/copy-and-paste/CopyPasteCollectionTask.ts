/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ClustersClient } from '../../../../documentdb/ClustersClient';
import { ext } from '../../../../extensionVariables';
import { type DocumentReader } from '../../data-api/types';
import { type StreamingDocumentWriter, StreamingWriterError } from '../../data-api/writers/StreamingDocumentWriter';
import { Task } from '../../taskService';
import { type ResourceDefinition, type ResourceTrackingTask } from '../../taskServiceResourceTracking';
import { type CopyPasteConfig } from './copyPasteConfig';

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
    private readonly documentReader: DocumentReader;
    private readonly documentWriter: StreamingDocumentWriter;
    private sourceDocumentCount: number = 0;
    private totalProcessedDocuments: number = 0;

    // Timeout reassurance: tracks when to show "still working" messages
    private reassuranceTimer?: NodeJS.Timeout;
    private reassuranceTicks: number = 0;
    private static readonly REASSURANCE_INTERVAL_MS = 1000;
    private static readonly REASSURANCE_START_TICKS = 2; // Start showing after 2 seconds
    private static readonly MAX_REASSURANCE_TICKS = 16; // Stop after 16 seconds

    /**
     * Creates a new CopyPasteCollectionTask instance.
     *
     * @param config Configuration for the copy-paste operation
     * @param documentReader Reader implementation for the source database
     * @param documentWriter StreamingDocumentWriter implementation for the target database
     */
    constructor(config: CopyPasteConfig, documentReader: DocumentReader, documentWriter: StreamingDocumentWriter) {
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
     * Collects cluster metadata for telemetry purposes.
     * This method attempts to gather cluster information without failing the task if metadata collection fails.
     *
     * @param clusterId Cluster ID to collect metadata for
     * @param prefix Prefix for telemetry properties (e.g., 'source' or 'target')
     * @param context Telemetry context to add properties to
     */
    private async collectClusterMetadata(clusterId: string, prefix: string, context: IActionContext): Promise<void> {
        try {
            const client = await ClustersClient.getClient(clusterId);
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
                this.config.source.clusterId !== this.config.target.clusterId
            ).toString();

            // Collect cluster metadata for source and target connections and await their completion (non-blocking for errors)
            const metadataPromises = [this.collectClusterMetadata(this.config.source.clusterId, 'source', context)];
            if (this.config.source.clusterId !== this.config.target.clusterId) {
                metadataPromises.push(this.collectClusterMetadata(this.config.target.clusterId, 'target', context));
            }
            await Promise.allSettled(metadataPromises);
        }

        // Count total documents for progress calculation
        this.updateStatus(this.getStatus().state, vscode.l10n.t('Counting documents in the source collection...'));

        try {
            this.sourceDocumentCount = await this.documentReader.countDocuments(signal, context);

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

        // Ensure target exists
        this.updateStatus(this.getStatus().state, vscode.l10n.t('Ensuring target exists...'));

        try {
            const ensureTargetResult = await this.documentWriter.ensureTargetExists();

            // Add telemetry about whether the target was created
            if (context) {
                context.telemetry.properties.targetWasCreated = ensureTargetResult.targetWasCreated.toString();
            }
        } catch (error) {
            throw new Error(vscode.l10n.t('Failed to ensure the target collection exists.'), {
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
    protected async doWork(signal: AbortSignal, context?: IActionContext): Promise<void> {
        // Handle empty source collection
        if (this.sourceDocumentCount === 0) {
            this.updateProgress(100, vscode.l10n.t('Source collection is empty.'));
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

                        ext.outputChannel.trace(
                            vscode.l10n.t(
                                '[CopyPasteTask] onProgress: {0}% ({1}/{2} docs) - {3}',
                                progressPercentage.toString(),
                                this.totalProcessedDocuments.toString(),
                                this.sourceDocumentCount.toString(),
                                progressMessage,
                            ),
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
                const errorMessage = vscode.l10n.t('Task failed after partial completion: {0}', partialSummary);

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
        parts.push(vscode.l10n.t('{0} processed', stats.totalProcessed.toLocaleString()));

        // Add strategy-specific breakdown (only non-zero counts)
        if ((stats.insertedCount ?? 0) > 0) {
            parts.push(vscode.l10n.t('{0} inserted', (stats.insertedCount ?? 0).toLocaleString()));
        }
        if ((stats.skippedCount ?? 0) > 0) {
            parts.push(vscode.l10n.t('{0} skipped', (stats.skippedCount ?? 0).toLocaleString()));
        }
        if ((stats.replacedCount ?? 0) > 0) {
            parts.push(vscode.l10n.t('{0} replaced', (stats.replacedCount ?? 0).toLocaleString()));
        }
        if ((stats.createdCount ?? 0) > 0) {
            parts.push(vscode.l10n.t('{0} created', (stats.createdCount ?? 0).toLocaleString()));
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
        const countStr = vscode.l10n.t(
            '{0}/{1} documents',
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
                const suffix = vscode.l10n.t('writing batch...') + extraDots;
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
