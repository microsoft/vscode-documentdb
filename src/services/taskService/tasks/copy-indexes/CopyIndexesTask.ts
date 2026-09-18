/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../../../extensionVariables';
import {
    type CollectionEndpoint,
    type CollectionIndexCopier,
    type IndexCopyResult,
} from '../../data-api/indexes/CollectionIndexCopier';
import { Task } from '../../taskService';
import { type ResourceDefinition, type ResourceTrackingTask } from '../../taskServiceResourceTracking';

export interface CopyIndexesConfig {
    readonly source: CollectionEndpoint;
    readonly target: CollectionEndpoint;
    readonly sourceIndexNames?: readonly string[];
    readonly copyScope: 'index' | 'indexes' | 'allIndexes';
    readonly copyOperationCorrelationId: string;
}

export class CopyIndexesTask extends Task implements ResourceTrackingTask {
    public readonly type: string = 'copy-paste-indexes';
    public readonly name: string;

    public constructor(
        private readonly config: CopyIndexesConfig,
        private readonly indexCopier: CollectionIndexCopier,
    ) {
        super();
        this.name = vscode.l10n.t(
            'Copy indexes from "{sourceDatabase}/{sourceCollection}" to "{targetDatabase}/{targetCollection}"',
            {
                sourceDatabase: config.source.databaseName,
                sourceCollection: config.source.collectionName,
                targetDatabase: config.target.databaseName,
                targetCollection: config.target.collectionName,
            },
        );
    }

    public getUsedResources(): ResourceDefinition[] {
        return [this.config.source, this.config.target];
    }

    protected async onInitialize(_signal: AbortSignal, context?: IActionContext): Promise<void> {
        if (context) {
            context.telemetry.properties.copyOperationCorrelationId = this.config.copyOperationCorrelationId;
        }
    }

    protected async doWork(signal: AbortSignal, context?: IActionContext): Promise<void> {
        let total = 0;
        let completed = 0;

        if (context) {
            context.telemetry.properties.isCrossConnection =
                this.config.source.clusterId !== this.config.target.clusterId ? 'true' : 'false';
            context.telemetry.properties.isCrossDatabase =
                this.config.source.databaseName !== this.config.target.databaseName ? 'true' : 'false';
            context.telemetry.properties.copyScope = this.config.copyScope;
            context.telemetry.properties.copyOperationCorrelationId = this.config.copyOperationCorrelationId;
        }

        let result: IndexCopyResult;
        try {
            result = await this.indexCopier.copyIndexes({
                sourceIndexNames: this.config.sourceIndexNames,
                allowDocumentAffectingIndexes: true,
                signal,
                onStart: (resolvedTotal) => {
                    total = resolvedTotal;
                    this.updateProgress(
                        total === 0 ? 100 : 0,
                        vscode.l10n.t('Preparing to copy {0} indexes...', total.toString()),
                    );
                },
                onProgress: (progress) => {
                    completed = progress.completed;
                    const percentage =
                        progress.total === 0 ? 100 : Math.floor((progress.completed / progress.total) * 100);
                    this.updateProgress(
                        percentage,
                        vscode.l10n.t(
                            'Copying indexes: {0}/{1} ({2})',
                            progress.completed.toString(),
                            progress.total.toString(),
                            progress.indexName,
                        ),
                    );
                },
            });
        } catch (error) {
            if (signal.aborted) {
                if (context) {
                    context.telemetry.properties.indexCopyCancelled = 'true';
                    context.telemetry.properties.indexCopyFailed = 'false';
                    context.telemetry.measurements.selectedIndexCount = total;
                }
                throw error;
            }

            if (context) {
                context.telemetry.properties.indexCopyFailed = 'true';
                context.telemetry.properties.indexCopyError = error instanceof Error ? error.name : 'UnknownError';
                context.telemetry.measurements.selectedIndexCount = total;
            }
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(vscode.l10n.t('Failed to copy indexes: {0}', errorMessage), { cause: error });
        }

        this.recordResultTelemetry(context, result);
        if (result.cancelled || signal.aborted) {
            const message = vscode.l10n.t(
                'Stopped after {0}/{1} indexes. Created indexes remain on the target.',
                completed.toString(),
                total.toString(),
            );
            this.updateProgress(total === 0 ? 100 : Math.floor((completed / total) * 100), message);
            ext.outputChannel.warn(vscode.l10n.t('[IndexCopy] {0}', message));
            return;
        }

        const message = vscode.l10n.t(
            '{0} indexes created, {1} equivalent indexes skipped, {2} option conflicts skipped, {3} renamed.',
            result.createdCount.toString(),
            result.skippedCount.toString(),
            result.conflictingCount.toString(),
            result.renamedCount.toString(),
        );
        this.updateProgress(100, message);
        ext.outputChannel.trace(vscode.l10n.t('[IndexCopy] {0}', message));
    }

    private recordResultTelemetry(context: IActionContext | undefined, result: IndexCopyResult): void {
        if (!context) {
            return;
        }

        context.telemetry.measurements.selectedIndexCount = result.selectedIndexCount;
        context.telemetry.measurements.createdIndexCount = result.createdCount;
        context.telemetry.measurements.skippedIndexCount = result.skippedCount;
        context.telemetry.measurements.renamedIndexCount = result.renamedCount;
        context.telemetry.measurements.conflictingIndexCount = result.conflictingCount;
        context.telemetry.properties.indexCopyCancelled = result.cancelled ? 'true' : 'false';
        context.telemetry.properties.indexCopyFailed = 'false';
    }
}
