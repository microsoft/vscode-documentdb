/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ClustersClient, type CollectionItemModel, type DatabaseItemModel, type IndexItemModel } from '../../documentdb/ClustersClient';
import { type Experience } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
import { type BaseClusterModel, type TreeCluster } from '../models/BaseClusterModel';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { IndexItem } from './IndexItem';

/** Comparator that sorts index names alphabetically, with `_id_` always first. */
export function compareIndexNames(a: string, b: string): number {
    if (a === b) return 0;
    if (a === '_id_') return -1;
    if (b === '_id_') return 1;
    return a.localeCompare(b, undefined, { numeric: true });
}

export class IndexesItem implements TreeElement, TreeElementWithExperience, TreeElementWithContextValue {
    public readonly id: string;
    public readonly experience: Experience;
    public contextValue: string = 'treeItem_indexes';

    private readonly experienceContextValue: string = '';

    /**
     * Cached index count for the collection.
     * undefined means not yet loaded, null means loading failed.
     */
    private indexCount: number | undefined | null = undefined;

    /** Flag indicating if a count fetch is in progress. */
    private isLoadingCount: boolean = false;

    /**
     * Cached combined index list (regular + search) from the most recent
     * fetch, already sorted. undefined means not yet fetched.
     */
    private cachedIndexes: IndexItemModel[] | undefined = undefined;

    /**
     * Shared in-flight fetch promise so concurrent callers
     * (`fetchAndUpdateCount` + `getChildren`) reuse the same round-trip.
     */
    private inFlightFetch: Promise<IndexItemModel[]> | null = null;

    constructor(
        readonly cluster: TreeCluster<BaseClusterModel>,
        readonly databaseInfo: DatabaseItemModel,
        readonly collectionInfo: CollectionItemModel,
        /**
         * AbortSignal from the owning CollectionItem. When the user refreshes /
         * collapses / re-expands the collection, the CollectionItem aborts this
         * signal so in-flight work bails before mutating UI state.
         * Defaults to a never-aborted signal.
         */
        private readonly signal: AbortSignal = new AbortController().signal,
    ) {
        this.id = `${cluster.treeId}/${databaseInfo.name}/${collectionInfo.name}/indexes`;
        this.experience = cluster.dbExperience;
        this.experienceContextValue = `experience_${this.experience.api}`;
        this.contextValue = createContextValue([this.contextValue, this.experienceContextValue]);
    }

    /** Fire-and-forget: load index count in background. */
    public loadIndexCount(): void {
        if (this.isLoadingCount || typeof this.indexCount === 'number') {
            return;
        }
        this.isLoadingCount = true;
        void this.fetchAndUpdateCount();
    }

    /** Background count loader. Delegates to {@link fetchAndCacheIndexes}. */
    private async fetchAndUpdateCount(): Promise<void> {
        try {
            await this.fetchAndCacheIndexes();
        } catch {
            // fetchAndCacheIndexes already logged; just clear the loading flag.
        } finally {
            if (!this.signal.aborted) {
                this.isLoadingCount = false;
            }
        }
        if (!this.signal.aborted) {
            ext.state.notifyChildrenChanged(this.id);
        }
    }

    /**
     * Shared fetch-and-cache helper used by both `getChildren()` and
     * `fetchAndUpdateCount()`. Deduplicates concurrent callers through
     * {@link inFlightFetch} so only one round-trip is issued.
     */
    private async fetchAndCacheIndexes(): Promise<IndexItemModel[]> {
        if (this.inFlightFetch) {
            return this.inFlightFetch;
        }

        const clusterId = this.cluster.clusterId;
        const dbName = this.databaseInfo.name;
        const collName = this.collectionInfo.name;

        this.inFlightFetch = (async (): Promise<IndexItemModel[]> => {
            const client = await ClustersClient.getClient(clusterId);
            if (this.signal.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
            const indexes = await client.listIndexes(dbName, collName);

            let searchIndexes: IndexItemModel[] = [];
            try {
                searchIndexes = await client.listSearchIndexesForAtlas(dbName, collName);
            } catch (err) {
                ext.outputChannel.warn(
                    l10n.t(
                        'Failed to list search indexes for {0}.{1}: {2}',
                        dbName,
                        collName,
                        err instanceof Error ? err.message : String(err),
                    ),
                );
            }

            const combinedIndexes = [...indexes, ...searchIndexes];
            combinedIndexes.sort((a, b) => compareIndexNames(a.name, b.name));
            this.cachedIndexes = combinedIndexes;
            this.indexCount = combinedIndexes.length;
            return combinedIndexes;
        })();

        try {
            return await this.inFlightFetch;
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
                throw err;
            }
            ext.outputChannel.warn(
                l10n.t(
                    'Failed to load indexes for {0}.{1}: {2}',
                    dbName,
                    collName,
                    err instanceof Error ? err.message : String(err),
                ),
            );
            this.indexCount = null;
            throw err;
        } finally {
            this.inFlightFetch = null;
        }
    }

    async getChildren(): Promise<TreeElement[]> {
        if (!this.cachedIndexes) {
            try {
                await this.fetchAndCacheIndexes();
            } catch {
                // Error already logged; render empty tree.
            }
        }
        return (this.cachedIndexes ?? []).map(
            (index) => new IndexItem(this.cluster, this.databaseInfo, this.collectionInfo, index),
        );
    }

    getTreeItem(): vscode.TreeItem {
        let description: string | undefined;
        if (this.isLoadingCount) {
            description = l10n.t('…');
        } else if (typeof this.indexCount === 'number') {
            if (this.indexCount === 0) {
                description = l10n.t('No indexes');
            } else if (this.indexCount === 1) {
                description = l10n.t('1 index');
            } else {
                description = l10n.t('{0} indexes', this.indexCount);
            }
        }
        // undefined (not started) or null (failed): no badge.

        return {
            id: this.id,
            contextValue: this.contextValue,
            label: l10n.t('Indexes'),
            description,
            iconPath: new vscode.ThemeIcon('combine'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
