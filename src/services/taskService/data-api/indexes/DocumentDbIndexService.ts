/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CreateIndexesOptions, type IndexDescriptionInfo, type IndexSpecification } from 'mongodb';
import * as vscode from 'vscode';
import { type ClustersClient } from '../../../../documentdb/ClustersClient';
import { ext } from '../../../../extensionVariables';

export interface IndexCopyProgress {
    completed: number;
    total: number;
    indexName: string;
}

export interface IndexCopyResult {
    sourceIndexCount: number;
    createdCount: number;
    skippedCount: number;
    renamedCount: number;
}

export interface CopyIndexesOptions {
    signal?: AbortSignal;
    onProgress?: (progress: IndexCopyProgress) => void;
}

interface IndexDefinition {
    key: IndexSpecification;
    name: string;
    options: CreateIndexesOptions;
}

/**
 * Reads and writes traditional DocumentDB API indexes without exposing driver index definitions
 * to the copy-and-paste task.
 */
export class DocumentDbIndexService {
    public constructor(
        private readonly client: ClustersClient,
        private readonly databaseName: string,
        private readonly collectionName: string,
    ) {}

    public async countCopyableIndexes(): Promise<number> {
        return (await this.readCopyableIndexes()).length;
    }

    public async copyIndexesTo(
        target: DocumentDbIndexService,
        options: CopyIndexesOptions = {},
    ): Promise<IndexCopyResult> {
        const sourceIndexes = await this.readCopyableIndexes();
        const targetIndexes = await target.readCopyableIndexes();
        const targetIndexNames = new Set(targetIndexes.map((index) => index.name));
        const targetSignatures = new Set(targetIndexes.map((index) => this.getDefinitionSignature(index)));

        const result: IndexCopyResult = {
            sourceIndexCount: sourceIndexes.length,
            createdCount: 0,
            skippedCount: 0,
            renamedCount: 0,
        };

        ext.outputChannel.trace(
            vscode.l10n.t('[IndexCopy] Found {0} source indexes to evaluate.', sourceIndexes.length.toString()),
        );

        for (const sourceIndex of sourceIndexes) {
            if (options.signal?.aborted) {
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

            const targetName = this.getAvailableName(sourceIndex.name, targetIndexNames);
            if (targetName !== sourceIndex.name) {
                result.renamedCount++;
                ext.outputChannel.debug(
                    vscode.l10n.t('[IndexCopy] Renaming index "{0}" to "{1}" to avoid a collision.', sourceIndex.name, targetName),
                );
            }

            try {
                await target.createIndex({ ...sourceIndex, name: targetName });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                ext.outputChannel.error(
                    vscode.l10n.t('[IndexCopy] Failed to create index "{0}": {1}', targetName, errorMessage),
                );
                throw error;
            }

            result.createdCount++;
            targetIndexNames.add(targetName);
            targetSignatures.add(this.getDefinitionSignature(sourceIndex));
            ext.outputChannel.trace(vscode.l10n.t('[IndexCopy] Created index "{0}".', targetName));
            options.onProgress?.({
                completed: result.createdCount + result.skippedCount,
                total: sourceIndexes.length,
                indexName: targetName,
            });
        }

        return result;
    }

    private async readCopyableIndexes(): Promise<IndexDefinition[]> {
        const indexes = await this.client.getCollection(this.databaseName, this.collectionName).indexes();
        return indexes.filter((index) => !this.isIdIndex(index)).map((index) => this.toIndexDefinition(index));
    }

    private async createIndex(index: IndexDefinition): Promise<void> {
        await this.client
            .getCollection(this.databaseName, this.collectionName)
            .createIndex(index.key, { ...index.options, name: index.name });
    }

    private toIndexDefinition(index: IndexDescriptionInfo): IndexDefinition {
        const { key, name, v: _version, ns: _namespace, ...options } = index;
        return {
            key,
            name: name ?? this.getGeneratedName(key),
            options,
        };
    }

    private isIdIndex(index: IndexDescriptionInfo): boolean {
        const entries = Object.entries(index.key);
        return entries.length === 1 && entries[0][0] === '_id';
    }

    private getDefinitionSignature(index: IndexDefinition): string {
        return JSON.stringify({
            key: Object.entries(index.key),
            options: this.sortObject(index.options),
        });
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

    private getGeneratedName(key: IndexSpecification): string {
        const entries = key instanceof Map ? [...key.entries()] : Object.entries(key);
        return entries.map(([field, direction]) => `${field}_${String(direction)}`).join('_');
    }
}
