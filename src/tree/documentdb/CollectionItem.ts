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
import { createConcurrencyLimiter, type LimitedRunner } from '../../utils/concurrencyLimiter';
import { formatDocumentCount } from '../../utils/formatDocumentCount';
import { escapeMarkdown } from '../../webviews/utils/escapeMarkdown';
import { type BaseClusterModel, type TreeCluster } from '../models/BaseClusterModel';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { DocumentsItem } from './DocumentsItem';
import { IndexesItem } from './IndexesItem';

/**
 * Per-cluster limiter for background document-count fetches.
 *
 * Tree expansion can trigger one `estimateDocumentCount` call per collection.
 * For databases with many collections that produces a burst of concurrent
 * requests that opens many sockets and competes with foreground operations
 * (queries, the collection view) for connection pool slots.
 *
 * Strategy: a plain semaphore capped at 5 in-flight count requests per
 * cluster. As soon as one finishes, the next queued one starts.
 *
 * Keyed by `clusterId` (the stable cache key) so each cluster gets an
 * independent pool.
 */
const documentCountLimiters = new Map<string, LimitedRunner>();

function getDocumentCountLimiter(clusterId: string): LimitedRunner {
    let limiter = documentCountLimiters.get(clusterId);
    if (!limiter) {
        limiter = createConcurrencyLimiter({
            concurrency: 5,
        });
        documentCountLimiters.set(clusterId, limiter);
    }
    return limiter;
}

export class CollectionItem implements TreeElement, TreeElementWithExperience, TreeElementWithContextValue {
    public readonly id: string;
    public readonly experience: Experience;
    public contextValue: string = 'treeItem_collection';

    private readonly experienceContextValue: string = '';

    /**
     * Cached estimated document count for the collection.
     * undefined means not yet loaded, null means loading failed.
     */
    private documentCount: number | undefined | null = undefined;

    /**
     * Flag indicating if a count fetch is in progress.
     */
    private isLoadingCount: boolean = false;

    /**
     * AbortController used to cancel in-flight index-fetch work owned by
     * stale IndexesItem instances. A new controller is created on every
     * `getChildren()` call and the previous one is aborted — a standard,
     * composable cancellation primitive that also lets underlying client
     * calls be aborted rather than only discarding their results.
     */
    private indexFetchAbortController: AbortController = new AbortController();

    constructor(
        readonly cluster: TreeCluster<BaseClusterModel>,
        readonly databaseInfo: DatabaseItemModel,
        readonly collectionInfo: CollectionItemModel,
        /**
         * Stale-check predicate. The owning DatabaseItem hands in a function
         * that returns true only while this CollectionItem belongs to the
         * current expansion. When the user refreshes / collapses / re-expands
         * the database, the predicate flips to false and any queued or
         * in-flight document-count work bails out before mutating state.
         * Defaults to always-current so direct callers are unaffected.
         */
        private readonly isCurrent: () => boolean = () => true,
    ) {
        this.id = `${cluster.treeId}/${databaseInfo.name}/${collectionInfo.name}`;
        this.experience = cluster.dbExperience;
        this.experienceContextValue = `experience_${this.experience.api}`;
        this.contextValue = createContextValue([this.contextValue, this.experienceContextValue]);
    }

    /**
     * Starts loading the document count asynchronously.
     * When the count is retrieved, it triggers a tree item refresh to update the description.
     * This method is fire-and-forget and does not block tree expansion.
     */
    public loadDocumentCount(): void {
        // Skip if already loading or already loaded
        if (this.isLoadingCount || this.documentCount !== undefined) {
            return;
        }

        this.isLoadingCount = true;

        // Fire-and-forget: load count in background
        void this.fetchAndUpdateCount();
    }

    /**
     * Fetches the document count and triggers a tree refresh when complete.
     */
    private async fetchAndUpdateCount(): Promise<void> {
        // Capture primitives and the stale-check closure into locals so the
        // task we hand to the limiter does not capture `this`. The outer
        // async frame still references `this` (it is an instance method), but
        // the inner task that the limiter holds while it is queued only pins
        // these few strings plus the small isCurrent closure.
        const clusterId = this.cluster.clusterId;
        const dbName = this.databaseInfo.name;
        const collName = this.collectionInfo.name;
        const isCurrent = this.isCurrent;
        const limit = getDocumentCountLimiter(clusterId);

        let result: number | null;
        try {
            result = await limit(async () => {
                // Stale-check at dispatch time: if this CollectionItem no
                // longer belongs to the current expansion (refresh / collapse
                // / re-expand happened while we were queued), skip the work.
                if (!isCurrent()) {
                    return null;
                }
                const client = await ClustersClient.getClient(clusterId);
                return client.estimateDocumentCount(dbName, collName);
            });
        } catch {
            // On error, fall through and let the post-await stale-check decide
            // whether to record the failure on this instance.
            result = null;
        }

        if (!isCurrent()) {
            // Stale: do not write back to this instance and do not fire a
            // tree refresh. The current instance owns the UI state.
            return;
        }

        this.isLoadingCount = false;
        this.documentCount = result;
        // Trigger a tree item refresh to show the updated description
        ext.state.notifyChildrenChanged(this.id);
    }

    async getChildren(): Promise<TreeElement[]> {
        // Cancel any in-flight index-fetch work from a previous expansion
        this.indexFetchAbortController.abort();
        this.indexFetchAbortController = new AbortController();

        const indexesItem = new IndexesItem(
            this.cluster,
            this.databaseInfo,
            this.collectionInfo,
            this.indexFetchAbortController.signal,
        );
        indexesItem.loadIndexCount();
        return [new DocumentsItem(this.cluster, this.databaseInfo, this.collectionInfo, this), indexesItem];
    }

    getTreeItem(): vscode.TreeItem {
        // Build description based on document count state
        let description: string | undefined;
        if (typeof this.documentCount === 'number') {
            description = formatDocumentCount(this.documentCount);
        }

        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.collectionInfo.name,
            description,
            tooltip: this.buildTooltip(),
            iconPath: new vscode.ThemeIcon('folder-library'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    /**
     * Builds a markdown tooltip showing the collection name, type, and document count.
     */
    private buildTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = false;

        md.appendMarkdown(`### ${escapeMarkdown(this.collectionInfo.name)}\n\n`);

        // Type badge (Collection, View, Timeseries)
        const collectionType = this.collectionInfo.type ?? 'collection';
        const capitalizedType = collectionType.charAt(0).toUpperCase() + collectionType.slice(1);
        md.appendMarkdown(`\`${capitalizedType}\`\n\n`);

        md.appendMarkdown('---\n\n');

        // Database context
        md.appendMarkdown(`**${l10n.t('Database')}:** ${escapeMarkdown(this.databaseInfo.name)}\n\n`);

        // Document count
        if (typeof this.documentCount === 'number') {
            md.appendMarkdown(`**${l10n.t('Documents')}:** ${formatDocumentCount(this.documentCount)}\n\n`);
        }

        // Shard key
        if (this.collectionInfo.shardKey) {
            const shardKeyEntries = Object.entries(this.collectionInfo.shardKey);
            if (shardKeyEntries.length > 0) {
                const entries = shardKeyEntries
                    .map(([k, v]) => {
                        const valueText = typeof v === 'string' ? `"${v}"` : String(v);
                        return `\`${k}: ${valueText}\``; // e.g. `userId: 1`
                    })
                    .join(', '); // e.g. `userId: 1`, `tenantId: "hashed"`
                md.appendMarkdown(`**${l10n.t('Shard Key')}:** ${entries}\n\n`);
            }
        }

        return md;
    }
}
