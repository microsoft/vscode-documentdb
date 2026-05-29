/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ClustersClient, type CollectionItemModel, type DatabaseItemModel } from '../../documentdb/ClustersClient';
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
     * `undefined` means not yet loaded. `null` means loading failed (treated
     * the same as not-loaded in the UI — no description is shown — so callers
     * don't need to distinguish the two states).
     */
    private indexCount: number | undefined | null = undefined;

    /**
     * Flag indicating if a count fetch is in progress.
     */
    private isLoadingCount: boolean = false;

    /**
     * Cached index arrays from the last `fetchAndUpdateCount()` call.
     * When set, `getChildren()` reuses these instead of making a second
     * `listIndexes()` / `listSearchIndexesForAtlas()` round-trip.
     */
    private cachedIndexes: CollectionItemModel[] | undefined;
    private cachedSearchIndexes: CollectionItemModel[] | undefined;

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
        // Skip if already loading or already loaded
        if (this.isLoadingCount || this.indexCount !== undefined) {
            return;
        }

        this.isLoadingCount = true;

        // Fire-and-forget: load count in background
        void this.fetchAndUpdateCount();
    }

    /**
     * Fetches the index count and caches the index arrays for reuse by
     * {@link getChildren}. Triggers a tree refresh when complete.
     */
    private async fetchAndUpdateCount(): Promise<void> {
        const clusterId = this.cluster.clusterId;
        const dbName = this.databaseInfo.name;
        const collName = this.collectionInfo.name;
        const isCurrent = this.isCurrent;

        let result: number | null;
        try {
            const client = await ClustersClient.getClient(clusterId);
            if (!isCurrent()) {
                // Stale: don't write back. The current instance owns the UI.
                return;
            }
            const indexes = await client.listIndexes(dbName, collName);

            // Also try to count search indexes, but silently fail if not supported
            let searchIndexes: CollectionItemModel[] = [];
            try {
                searchIndexes = await client.listSearchIndexesForAtlas(dbName, collName);
            } catch {
                // Search indexes not supported on this platform
            }

            // Cache the arrays so getChildren() can reuse them
            this.cachedIndexes = indexes;
            this.cachedSearchIndexes = searchIndexes.length > 0 ? searchIndexes : undefined;

            result = indexes.length + searchIndexes.length;
        } catch {
            result = null;
            // Clear any partial cache on failure so getChildren() does a
            // fresh fetch.
            this.cachedIndexes = undefined;
            this.cachedSearchIndexes = undefined;
        } finally {
            // Always reset isLoadingCount so that:
            // - Stale instances that skipped mutation in the early return above
            //   don't silently stay in "loading" state.
            // - Error paths reset the guard for potential retry.
            this.isLoadingCount = false;
        }

        if (!isCurrent()) {
            // Stale: do not write back to this instance and do not fire a
            // tree refresh. The current instance owns the UI state.
            return;
        }

        this.indexCount = result;
        // Trigger a tree item refresh to show the updated description
        ext.state.notifyChildrenChanged(this.id);
    }

    async getChildren(): Promise<TreeElement[]> {
        const client: ClustersClient = await ClustersClient.getClient(this.cluster.clusterId);

        // Reuse cached arrays from a completed fetchAndUpdateCount() to avoid
        // a second listIndexes + listSearchIndexesForAtlas round-trip.
        const indexes =
            this.cachedIndexes ??
            (await client.listIndexes(this.databaseInfo.name, this.collectionInfo.name));
        let searchIndexes: CollectionItemModel[] = [];
        if (this.cachedSearchIndexes) {
            searchIndexes = this.cachedSearchIndexes;
        } else {
            try {
                searchIndexes = await client.listSearchIndexesForAtlas(
                    this.databaseInfo.name,
                    this.collectionInfo.name,
                );
            } catch {
                // Search indexes not supported on this platform, continue without them
            }
        }

        // Clear caches after use so the next expand always gets fresh data.
        this.cachedIndexes = undefined;
        this.cachedSearchIndexes = undefined;

        // Combine and sort
        const allIndexes = [...indexes, ...searchIndexes];
        allIndexes.sort((a, b) => compareIndexNames(a.name, b.name));

        return allIndexes.map((index) => {
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
