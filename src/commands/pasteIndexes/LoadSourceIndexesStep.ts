import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ClustersClient, getIndexExclusionReason } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { ext } from '../../extensionVariables';
import { CopyPasteBufferService } from '../../services/CopyPasteBufferService';
import { type PasteIndexesWizardContext } from './PasteIndexesWizardContext';

class SourceIndexesLoadedError extends Error {
    public constructor() {
        super('Source indexes loaded');
        this.name = 'SourceIndexesLoadedError';
    }
}

export class LoadSourceIndexesStep extends AzureWizardPromptStep<PasteIndexesWizardContext> {
    public async prompt(context: PasteIndexesWizardContext): Promise<void> {
        const controller = new AbortController();
        try {
            await context.ui.showQuickPick(this.loadSourceIndexes(context, controller.signal), {
                loadingPlaceHolder: vscode.l10n.t('Loading source indexes...'),
                suppressPersistence: true,
            });
        } catch (error) {
            if (error instanceof SourceIndexesLoadedError) {
                return;
            }
            throw error;
        } finally {
            controller.abort();
        }
    }

    public shouldPrompt(): boolean {
        return true;
    }

    private async loadSourceIndexes(context: PasteIndexesWizardContext, signal: AbortSignal): Promise<never> {
        try {
            await this.validateSource(context, signal);
            const client = await ClustersClient.getClient(context.source.clusterId, signal);
            const [ordinaryIndexes, searchIndexes] = await this.waitForCatalog(
                Promise.all([
                    client.listIndexes(context.source.databaseName, context.source.collectionName, signal),
                    client
                        .listSearchIndexesForAtlas(context.source.databaseName, context.source.collectionName, signal)
                        .catch((error: unknown) => {
                            if (signal.aborted) {
                                throw error;
                            }
                            return [];
                        }),
                ]),
                signal,
            );
            const catalog = [...ordinaryIndexes, ...searchIndexes];
            const classified = catalog.map((index) => ({ index, reason: getIndexExclusionReason(index) }));

            context.catalogCount = catalog.length;
            context.copyableIndexNames = classified
                .filter((entry) => entry.reason === undefined)
                .map((entry) => entry.index.name);
            context.copyableCount = context.copyableIndexNames.length;
            context.excluded = classified
                .filter((entry) => entry.reason !== undefined)
                .map((entry) => ({ name: entry.index.name, type: entry.index.type, reason: entry.reason! }));

            if (context.scope.kind === 'index') {
                const selectedIndexName = context.scope.indexName;
                const selected = classified.find((entry) => entry.index.name === selectedIndexName);
                if (!selected) {
                    await CopyPasteBufferService.clearIndexes();
                    throw new Error(
                        vscode.l10n.t(
                            'The copied index "{0}" no longer exists. Copy the index again.',
                            selectedIndexName,
                        ),
                    );
                }
                if (selected.reason !== undefined) {
                    await CopyPasteBufferService.clearIndexes();
                    throw new Error(
                        vscode.l10n.t(
                            'The copied index "{0}" is no longer supported by Copy/Paste Indexes. Copy a supported index instead.',
                            selectedIndexName,
                        ),
                    );
                }
                context.sourceIndexNames = [selectedIndexName];
            } else {
                context.sourceIndexNames = undefined;
            }

            const summary = await context.indexCopier.getSourceIndexSummary({
                sourceIndexNames: context.sourceIndexNames,
                signal,
            });
            context.uniqueIndexNames = summary.uniqueIndexNames;
            context.ttlIndexNames = summary.ttlIndexNames;
            context.telemetry.measurements.catalogIndexCount = context.catalogCount;
            context.telemetry.measurements.copyableIndexCount = context.copyableCount;
            context.telemetry.measurements.excludedIndexCount = context.excluded.length;
        } catch (error) {
            if (signal.aborted) {
                throw error;
            }
            context.telemetry.properties.sourceIndexLoadError = error instanceof Error ? error.name : 'UnknownError';
            const errorMessage = error instanceof Error ? error.message : String(error);
            ext.outputChannel.error(vscode.l10n.t('[IndexCopy] Failed to load source indexes: {0}', errorMessage));
            throw error;
        }

        throw new SourceIndexesLoadedError();
    }

    private async waitForCatalog<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
        signal.throwIfAborted();
        return new Promise<T>((resolve, reject) => {
            const onAbort = (): void => reject(signal.reason instanceof Error ? signal.reason : new Error('Operation aborted'));
            signal.addEventListener('abort', onAbort, { once: true });
            void operation.then(
                (result) => {
                    signal.removeEventListener('abort', onAbort);
                    resolve(result);
                },
                (error: unknown) => {
                    signal.removeEventListener('abort', onAbort);
                    reject(error);
                },
            );
        });
    }

    private async validateSource(context: PasteIndexesWizardContext, signal: AbortSignal): Promise<void> {
        if (!CredentialCache.hasCredentials(context.source.clusterId)) {
            await CopyPasteBufferService.clearIndexes();
            throw new Error(
                vscode.l10n.t('The source connection is no longer available. Reconnect and copy the indexes again.'),
            );
        }

        const client = await ClustersClient.getClient(context.source.clusterId, signal);
        const collections = await client.listCollections(context.source.databaseName);
        if (!collections.some((collection) => collection.name === context.source.collectionName)) {
            await CopyPasteBufferService.clearIndexes();
            throw new Error(
                vscode.l10n.t(
                    'The source collection "{0}" no longer exists. Copy the indexes again from an available collection.',
                    context.source.collectionName,
                ),
            );
        }
    }
}