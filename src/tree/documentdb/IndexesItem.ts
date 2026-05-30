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
     * round-trip to the server. Already sorted.
     * undefined means not yet fetched.
     */
    private cachedIndexes: IndexItemModel[] | undefined = undefined;

    /**
     * Shared in-flight fetch promise so concurrent callers
     * (`fetchAndUpdateCount` + `getChildren`) reuse the same round-trip
     * instead of issuing duplicate requests.
     */
    private inFlightFetch: Promise<IndexItemModel[]> | null = null;

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
     * Delegates to the shared {@link fetchAndCacheIndexes} so concurrent
     * `getChildren()` calls reuse the same in-flight request.
     */
    private async fetchAndUpdateCount(): Promise<void> {
        const isCurrent = this.isCurrent;

        try {
            await this.fetchAndCacheIndexes();
        } catch {
            // fetchAndCacheIndexes already logs errors; swallow here so the
            // finally block still runs and clears isLoadingCount.
        } finally {
            if (isCurrent()) {
                this.isLoadingCount = false;
            }
        }

        if (!isCurrent()) {
            return;
        }

        // Trigger a tree item refresh to show the updated description
        ext.state.notifyChildrenChanged(this.id);
    }

    /**
     * Shared fetch-and-cache helper used by both `getChildren()` and
     * `fetchAndUpdateCount()`. Deduplicates concurrent callers through
     * {@link inFlightFetch} so only one round-trip is issued.
     *
     * Caches the sorted combined index list into {@link cachedIndexes} and
     * the count into {@link indexCount} (null on failure).
     *
     * @returns The sorted combined index list.
     * @throws If the fetch fails (after logging).
     */
    private async fetchAndCacheIndexes(): Promise<IndexItemModel[]> {
        // If a fetch is already in flight, return the shared promise
        if (this.inFlightFetch) {
            return this.inFlightFetch;
        }

        const clusterId = this.cluster.clusterId;
        const dbName = this.databaseInfo.name;
        const collName = this.collectionInfo.name;

        this.inFlightFetch = (async (): Promise<IndexItemModel[]> => {
            let combinedIndexes: IndexItemModel[] = [];
            const client = await ClustersClient.getClient(clusterId);
            const indexes = await client.listIndexes(dbName, collName);

            // Also try to fetch search indexes, but silently fail if not supported
            let searchIndexes: IndexItemModel[] = [];
            try {
                searchIndexes = await client.listSearchIndexesForAtlas(dbName, collName);
            } catch (err) {
                // Log so transient network/auth errors are diagnosable
                ext.outputChannel.warn(
                    l10n.t(
                        'Failed to list search indexes for {0}.{1}: {2}',
                        dbName,
                        collName,
                        err instanceof Error ? err.message : String(err),
                    ),
                );
            }

            combinedIndexes = [...indexes, ...searchIndexes];
            // Sort before caching so getChildren() never mutates the shared array in-place
            combinedIndexes.sort((a, b) => compareIndexNames(a.name, b.name));

            // Cache the result
            this.cachedIndexes = combinedIndexes;
            this.indexCount = combinedIndexes.length;
            return combinedIndexes;
        })();

        try {
            return await this.inFlightFetch;
        } catch (err) {
            // Log the error and cache the failure
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
        // Reuse the cached index list when available — otherwise fetch
        // via the shared helper (which deduplicates with any in-flight
        // background count load).
        if (!this.cachedIndexes) {
            try {
                await this.fetchAndCacheIndexes();
            } catch {
                // fetchAndCacheIndexes already logged the error; continue
                // with an empty list so the tree still renders.
            }
        }

        return (this.cachedIndexes ?? []).map((index) => {
            return new IndexItem(this.cluster, this.databaseInfo, this.collectionInfo, index);
        });
    }

    getTreeItem(): vscode.TreeItem {
        // Build description based on index count state
        let description: string | undefined;
        if (this.isLoadingCount) {
            // Background fetch in progress — show a loading indicator
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
        // When indexCount is undefined (not yet started) or null (failed),
        // leave description undefined so no badge is shown.

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
