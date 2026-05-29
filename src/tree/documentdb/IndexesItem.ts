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

    /**
     * Flag indicating if a count fetch is in progress.
     */
    private isLoadingCount: boolean = false;

    /**
     * Cached combined index list (regular + search) from the most recent
     * fetch, so `getChildren()` can reuse it instead of making a second
     * round-trip to the server.
     * undefined means not yet fetched.
     */
    private cachedIndexes: IndexItemModel[] | undefined = undefined;

    constructor(
        readonly cluster: TreeCluster<BaseClusterModel>,
        readonly databaseInfo: DatabaseItemModel,
        readonly collectionInfo: CollectionItemModel,
        /**
         * Stale-check predicate. The owning CollectionItem hands in a function
         * that returns true only while this IndexesItem belongs to the
         * current expansion. When the user refreshes / collapses / re-expands
         * the collection, the predicate flips to false and any queued or
         * in-flight count work bails out before mutating state.
         * Defaults to always-current so direct callers are unaffected.
         */
        private readonly isCurrent: () => boolean = () => true,
    ) {
        this.id = `${cluster.treeId}/${databaseInfo.name}/${collectionInfo.name}/indexes`;
        this.experience = cluster.dbExperience;
        this.experienceContextValue = `experience_${this.experience.api}`;
        this.contextValue = createContextValue([this.contextValue, this.experienceContextValue]);
    }

    /**
     * Starts loading the index count asynchronously.
     * When the count is retrieved, it triggers a tree item refresh to update the description.
     * This method is fire-and-forget and does not block tree expansion.
     */
    public loadIndexCount(): void {
        // Skip if already loading or if we already have a valid count
        if (this.isLoadingCount || typeof this.indexCount === 'number') {
            return;
        }

        this.isLoadingCount = true;

        // Fire-and-forget: load count in background
        void this.fetchAndUpdateCount();
    }

    /**
     * Fetches the index count and triggers a tree refresh when complete.
     * As a side effect, caches the combined index list on the instance so
     * that a subsequent `getChildren()` call can reuse it and avoid a second
     * round-trip to the server.
     */
    private async fetchAndUpdateCount(): Promise<void> {
        const clusterId = this.cluster.clusterId;
        const dbName = this.databaseInfo.name;
        const collName = this.collectionInfo.name;
        const isCurrent = this.isCurrent;

        let result: number | null;
        let combinedIndexes: IndexItemModel[] = [];
        try {
            const client = await ClustersClient.getClient(clusterId);
            if (!isCurrent()) {
                return;
            }
            const indexes = await client.listIndexes(dbName, collName);

            // Also try to fetch search indexes, but silently fail if not supported
            let searchIndexes: IndexItemModel[] = [];
            try {
                searchIndexes = await client.listSearchIndexesForAtlas(dbName, collName);
            } catch {
                // Search indexes not supported on this platform
            }

            combinedIndexes = [...indexes, ...searchIndexes];
            result = combinedIndexes.length;
        } catch {
            result = null;
        } finally {
            // Only clear the loading flag when still current so we don't
            // mutate a stale instance that no longer owns the UI state.
            if (isCurrent()) {
                this.isLoadingCount = false;
            }
        }

        if (!isCurrent()) {
            // Stale: do not write back to this instance and do not fire a
            // tree refresh. The current instance owns the UI state.
            return;
        }

        this.indexCount = result;
        if (result !== null) {
            this.cachedIndexes = combinedIndexes;
        }
        // Trigger a tree item refresh to show the updated description
        ext.state.notifyChildrenChanged(this.id);
    }

    async getChildren(): Promise<TreeElement[]> {
        // Reuse the cached index list from the background count fetch when
        // available — avoids a second round-trip for the same data. Fall
        // back to fetching on-demand if the cache hasn't been populated yet
        // (e.g. count load is still in-flight or failed).
        if (!this.cachedIndexes) {
            const client: ClustersClient = await ClustersClient.getClient(this.cluster.clusterId);
            const indexes = await client.listIndexes(this.databaseInfo.name, this.collectionInfo.name);

            // Try to get search indexes, but silently fail if not supported by the platform
            try {
                const searchIndexes = await client.listSearchIndexesForAtlas(
                    this.databaseInfo.name,
                    this.collectionInfo.name,
                );
                indexes.push(...searchIndexes);
            } catch {
                // Search indexes not supported on this platform, continue without them
            }

            this.cachedIndexes = indexes;
        }

        // Sort indexes by name, with _id_ always first
        this.cachedIndexes.sort((a, b) => compareIndexNames(a.name, b.name));

        return this.cachedIndexes.map((index) => {
            return new IndexItem(this.cluster, this.databaseInfo, this.collectionInfo, index);
        });
    }

    getTreeItem(): vscode.TreeItem {
        // Build description based on index count state
        let description: string | undefined;
        if (typeof this.indexCount === 'number') {
            description = this.indexCount === 1 ? l10n.t('1 index') : l10n.t('{0} indexes', this.indexCount);
        }

        return {
            id: this.id,
            contextValue: this.contextValue,
            label: l10n.t('Indexes'),
            description,
            iconPath: new vscode.ThemeIcon('combine'), // TODO: create our onw icon here, this one's shape can change
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
