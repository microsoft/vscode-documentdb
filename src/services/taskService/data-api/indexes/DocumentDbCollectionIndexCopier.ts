/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Document, type IndexDescriptionInfo } from 'mongodb';
import * as vscode from 'vscode';
import { ClustersClient } from '../../../../documentdb/ClustersClient';
import { ext } from '../../../../extensionVariables';
import {
    type CollectionIndexCopier,
    type CopyIndexesOptions,
    type GetSourceIndexSummaryOptions,
    type IndexCopyResult,
    type SourceIndexSummary,
} from './CollectionIndexCopier';

export interface DocumentDbCollectionEndpoint {
    clusterId: string;
    databaseName: string;
    collectionName: string;
}

interface IndexDefinition {
    key: Record<string, number | string>;
    name: string;
    options: Document;
    hidden: boolean;
}

class IndexVisibilityError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'IndexVisibilityError';
    }
}

const semanticIndexOptionNames = new Set([
    'bits',
    'bucketSize',
    'collation',
    'cosmosSearchOptions',
    'default_language',
    'expireAfterSeconds',
    'language_override',
    'max',
    'min',
    'partialFilterExpression',
    'sparse',
    'storageEngine',
    'unique',
    'weights',
    'wildcardProjection',
]);

export function isDocumentAffectingIndex(options: Readonly<Document>): boolean {
    return options.unique === true || Object.hasOwn(options, 'expireAfterSeconds');
}

/**
 * Copies indexes between two DocumentDB API collections.
 *
 * This class intentionally keeps catalog reading, comparison, naming, and creation together.
 * Index catalogs are small and bounded, and all of these rules depend on DocumentDB API index
 * semantics. Splitting them into source and target services would add delegation without creating
 * a reusable boundary; callers instead depend on the compact `CollectionIndexCopier` contract.
 * A portable index model should be introduced only when cross-database index migration is required.
 */
export class DocumentDbCollectionIndexCopier implements CollectionIndexCopier {
    public constructor(
        private readonly source: DocumentDbCollectionEndpoint,
        private readonly target: DocumentDbCollectionEndpoint,
    ) {}

    public async getSourceIndexSummary(options: GetSourceIndexSummaryOptions = {}): Promise<SourceIndexSummary> {
        const requestedNames = this.getRequestedNames(options.sourceIndexNames);
        const sourceClient = await ClustersClient.getClient(this.source.clusterId, options.signal);
        const indexes = await this.readIndexes(sourceClient, this.source, options.signal);
        const copyableIndexes = indexes
            .filter((index) => !this.isIdIndex(index))
            .map((index) => this.toIndexDefinition(index));
        const selectedIndexes = this.selectSourceIndexes(copyableIndexes, requestedNames);
        return {
            count: indexes.length,
            uniqueIndexNames: selectedIndexes
                .filter((index) => index.options.unique === true)
                .map((index) => index.name),
            ttlIndexNames: selectedIndexes
                .filter((index) => Object.hasOwn(index.options, 'expireAfterSeconds'))
                .map((index) => index.name),
        };
    }

    public async copyIndexes(options: CopyIndexesOptions = {}): Promise<IndexCopyResult> {
        const requestedNames = this.getRequestedNames(options.sourceIndexNames);
        const [sourceClient, targetClient] = await Promise.all([
            ClustersClient.getClient(this.source.clusterId, options.signal),
            ClustersClient.getClient(this.target.clusterId, options.signal),
        ]);

        // Read both bounded catalogs once so equivalence and name collisions use stable snapshots.
        const copyableSourceIndexes = await this.readCopyableIndexes(sourceClient, this.source, options.signal);
        const sourceIndexes = this.selectSourceIndexes(copyableSourceIndexes, requestedNames);
        if (!options.allowDocumentAffectingIndexes) {
            const documentAffectingIndexNames = sourceIndexes
                .filter((index) => isDocumentAffectingIndex(index.options))
                .map((index) => `"${index.name}"`);
            if (documentAffectingIndexNames.length > 0) {
                throw new Error(
                    vscode.l10n.t(
                        'Cannot copy TTL or unique indexes as part of a collection paste: {0}.',
                        documentAffectingIndexNames.join(', '),
                    ),
                );
            }
        }
        options.onStart?.(sourceIndexes.length);
        const targetIndexes = await this.readCopyableIndexes(targetClient, this.target, options.signal);
        const targetIndexNames = new Set(targetIndexes.map((index) => index.name));
        const targetSignatures = new Set(targetIndexes.map((index) => this.getDefinitionSignature(index)));
        const targetKeySignatures = new Set(targetIndexes.map((index) => this.getKeySignature(index)));

        const result: IndexCopyResult = {
            selectedIndexCount: sourceIndexes.length,
            createdCount: 0,
            skippedCount: 0,
            renamedCount: 0,
            conflictingCount: 0,
            cancelled: false,
        };

        ext.outputChannel.trace(
            vscode.l10n.t('[IndexCopy] Found {0} source indexes to evaluate.', sourceIndexes.length.toString()),
        );

        // Create sequentially for deterministic naming, progress, and cancellation between indexes.
        for (const sourceIndex of sourceIndexes) {
            if (options.signal?.aborted) {
                result.cancelled = true;
                break;
            }

            if (targetSignatures.has(this.getDefinitionSignature(sourceIndex))) {
                result.skippedCount++;
                ext.outputChannel.debug(
                    vscode.l10n.t('[IndexCopy] Skipping equivalent index "{0}".', sourceIndex.name),
                );
                options.onProgress?.({
                    completed: result.createdCount + result.skippedCount,
                    total: sourceIndexes.length,
                    indexName: sourceIndex.name,
                });
                continue;
            }

            if (targetKeySignatures.has(this.getKeySignature(sourceIndex))) {
                result.skippedCount++;
                result.conflictingCount++;
                ext.outputChannel.warn(
                    vscode.l10n.t(
                        '[IndexCopy] Skipping index "{0}" because the target has the same key pattern with different options.',
                        sourceIndex.name,
                    ),
                );
                options.onProgress?.({
                    completed: result.createdCount + result.skippedCount,
                    total: sourceIndexes.length,
                    indexName: sourceIndex.name,
                });
                continue;
            }

            const targetName = this.getAvailableName(sourceIndex.name, targetIndexNames);
            if (targetName !== sourceIndex.name) {
                result.renamedCount++;
                ext.outputChannel.debug(
                    vscode.l10n.t(
                        '[IndexCopy] Renaming index "{0}" to "{1}" to avoid a collision.',
                        sourceIndex.name,
                        targetName,
                    ),
                );
            }

            try {
                await this.createIndex(targetClient, this.target, { ...sourceIndex, name: targetName });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                ext.outputChannel.error(
                    vscode.l10n.t('[IndexCopy] Failed to create index "{0}": {1}', targetName, errorMessage),
                );
                const copyError = new Error(
                    vscode.l10n.t('Failed to copy index "{0}": {1}', targetName, errorMessage),
                    {
                        cause: error,
                    },
                );
                if (error instanceof IndexVisibilityError) {
                    copyError.name = error.name;
                }
                throw copyError;
            }

            result.createdCount++;
            targetIndexNames.add(targetName);
            targetSignatures.add(this.getDefinitionSignature(sourceIndex));
            targetKeySignatures.add(this.getKeySignature(sourceIndex));
            ext.outputChannel.trace(vscode.l10n.t('[IndexCopy] Created index "{0}".', targetName));
            options.onProgress?.({
                completed: result.createdCount + result.skippedCount,
                total: sourceIndexes.length,
                indexName: targetName,
            });
        }

        result.cancelled = result.cancelled || options.signal?.aborted === true;
        return result;
    }

    private getRequestedNames(sourceIndexNames?: readonly string[]): ReadonlySet<string> | undefined {
        if (sourceIndexNames === undefined) {
            return undefined;
        }

        const requestedNames = new Set(sourceIndexNames);
        if (requestedNames.size !== sourceIndexNames.length) {
            throw new Error(vscode.l10n.t('Source index names must be unique.'));
        }

        return requestedNames;
    }

    private selectSourceIndexes(
        sourceIndexes: readonly IndexDefinition[],
        requestedNames?: ReadonlySet<string>,
    ): IndexDefinition[] {
        if (requestedNames === undefined) {
            return [...sourceIndexes];
        }

        const unresolvedNames = new Set(requestedNames);
        const selectedIndexes = sourceIndexes.filter((index) => {
            if (!requestedNames.has(index.name)) {
                return false;
            }

            unresolvedNames.delete(index.name);
            return true;
        });

        if (unresolvedNames.size > 0) {
            const names = [...unresolvedNames].map((name) => `"${name}"`).join(', ');
            throw new Error(vscode.l10n.t('Source indexes were not found: {0}.', names));
        }

        return selectedIndexes;
    }

    private async readCopyableIndexes(
        client: ClustersClient,
        endpoint: DocumentDbCollectionEndpoint,
        signal?: AbortSignal,
    ): Promise<IndexDefinition[]> {
        const indexes = await this.readIndexes(client, endpoint, signal);
        return indexes.filter((index) => !this.isIdIndex(index)).map((index) => this.toIndexDefinition(index));
    }

    private async readIndexes(
        client: ClustersClient,
        endpoint: DocumentDbCollectionEndpoint,
        signal?: AbortSignal,
    ): Promise<IndexDescriptionInfo[]> {
        if (signal?.aborted) {
            throw this.getAbortError(signal);
        }

        return this.waitForOperation(
            client.getCollection(endpoint.databaseName, endpoint.collectionName).indexes(),
            signal,
        );
    }

    private async waitForOperation<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
        if (!signal) {
            return operation;
        }

        return new Promise<T>((resolve, reject) => {
            const onAbort = (): void => reject(this.getAbortError(signal));
            signal.addEventListener('abort', onAbort, { once: true });
            void operation.then(
                (result) => {
                    signal.removeEventListener('abort', onAbort);
                    resolve(result);
                },
                (error: unknown) => {
                    signal.removeEventListener('abort', onAbort);
                    reject(error instanceof Error ? error : new Error(String(error)));
                },
            );
        });
    }

    private getAbortError(signal: AbortSignal): Error {
        if (signal.reason instanceof Error) {
            return signal.reason;
        }

        const error = new Error('Operation aborted');
        error.name = 'AbortError';
        return error;
    }

    private async createIndex(
        client: ClustersClient,
        endpoint: DocumentDbCollectionEndpoint,
        index: IndexDefinition,
    ): Promise<void> {
        const result = await client.createIndex(endpoint.databaseName, endpoint.collectionName, {
            ...index.options,
            background: true,
            key: Object.fromEntries(this.getKeyEntries(index.key)),
            name: index.name,
        });

        if (typeof result.note === 'string') {
            ext.outputChannel.warn(vscode.l10n.t('[IndexCopy] Index "{0}": {1}', index.name, result.note));
        }

        if (result.ok !== 1) {
            throw new Error(typeof result.note === 'string' ? result.note : vscode.l10n.t('Failed to create index.'));
        }

        if (index.hidden) {
            const visibilityResult = await client.hideIndex(endpoint.databaseName, endpoint.collectionName, index.name);
            if (visibilityResult.ok === 0 || visibilityResult.errmsg) {
                const errorMessage =
                    typeof visibilityResult.errmsg === 'string'
                        ? visibilityResult.errmsg
                        : vscode.l10n.t('Failed to hide index.');
                throw new IndexVisibilityError(
                    vscode.l10n.t('Index "{0}" was created but could not be hidden: {1}', index.name, errorMessage),
                );
            }
        }
    }

    private toIndexDefinition(index: IndexDescriptionInfo): IndexDefinition {
        const options = Object.fromEntries(
            Object.entries(index).filter(
                ([property]) => !['key', 'name', 'v', 'ns', 'background', 'hidden'].includes(property),
            ),
        );
        return {
            key: index.key,
            name: index.name ?? this.getGeneratedName(index.key),
            options,
            hidden: index.hidden === true,
        };
    }

    private isIdIndex(index: IndexDescriptionInfo): boolean {
        const entries = Object.entries(index.key);
        return entries.length === 1 && entries[0][0] === '_id';
    }

    private getDefinitionSignature(index: IndexDefinition): string {
        return JSON.stringify({
            key: this.getKeyEntries(index.key),
            options: this.sortObject(
                Object.fromEntries(
                    Object.entries(index.options).filter(([name]) => semanticIndexOptionNames.has(name)),
                ),
            ),
        });
    }

    private getKeySignature(index: IndexDefinition): string {
        return JSON.stringify(this.getKeyEntries(index.key));
    }

    private sortObject(value: unknown): unknown {
        if (Array.isArray(value)) {
            return value.map((item) => this.sortObject(item));
        }

        if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
            return Object.fromEntries(
                Object.entries(value)
                    .sort(([left], [right]) => left.localeCompare(right))
                    .map(([key, nestedValue]) => [key, this.sortObject(nestedValue)]),
            );
        }

        return value;
    }

    private getAvailableName(preferredName: string, existingNames: Set<string>): string {
        if (!existingNames.has(preferredName)) {
            return preferredName;
        }

        const baseName = `${preferredName}_copy`;
        let candidate = baseName;
        let suffix = 2;
        while (existingNames.has(candidate)) {
            candidate = `${baseName}_${suffix}`;
            suffix++;
        }
        return candidate;
    }

    private getGeneratedName(key: Record<string, number | string>): string {
        return this.getKeyEntries(key)
            .map(([field, direction]) => `${field}_${String(direction)}`)
            .join('_');
    }

    private getKeyEntries(key: Record<string, number | string>): [string, number | string][] {
        return Object.entries(key);
    }
}
