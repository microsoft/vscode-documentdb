/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue, createGenericElement } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ClustersClient, type CollectionItemModel, type DatabaseItemModel } from '../../documentdb/ClustersClient';
import { type Experience } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
import { meterSilentCatch } from '../../utils/callWithAccumulatingTelemetry';
import { getCountPrefix } from '../../utils/countPrefix';
import { escapeMarkdown } from '../../webviews/utils/escapeMarkdown';
import { type BaseClusterModel, type TreeCluster } from '../models/BaseClusterModel';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { CollectionItem } from './CollectionItem';

export class DatabaseItem implements TreeElement, TreeElementWithExperience, TreeElementWithContextValue {
    public readonly id: string;
    public readonly experience: Experience;
    public contextValue: string = 'treeItem_database';

    private readonly experienceContextValue: string = '';

    private collectionCount: number | undefined;
    private cachedCollections: CollectionItemModel[] | undefined;
    private isLoadingCount: boolean = false;
    private collectionsPromise: Promise<CollectionItemModel[]> | undefined;
    private isRefreshingCollectionCount: boolean = false;

    /**
     * Monotonic counter bumped on every `getChildren` call. Used to invalidate
     * background document-count work owned by stale CollectionItem instances
     * (refresh / collapse / re-expand creates fresh instances; we want the
     * previous ones to bail before mutating UI state or hitting the server).
     */
    private expansionGeneration = 0;

    constructor(
        readonly cluster: TreeCluster<BaseClusterModel>,
        readonly databaseInfo: DatabaseItemModel,
    ) {
        this.id = `${cluster.treeId}/${databaseInfo.name}`;
        this.experience = cluster.dbExperience;
        this.experienceContextValue = `experience_${this.experience?.api}`;
        this.contextValue = createContextValue([this.contextValue, this.experienceContextValue]);
    }

    async getChildren(): Promise<TreeElement[]> {
        const myGeneration = ++this.expansionGeneration;
        const isCurrent = (): boolean => this.expansionGeneration === myGeneration;

        const collections = [...(await this.getCollections())];
        const previousCount = this.collectionCount;
        this.collectionCount = collections.length;

        // If the count changed (e.g. user-initiated refresh after an external
        // mutation), re-render this node so the description matches the children
        // we are about to return.
        if (previousCount !== this.collectionCount) {
            this.isRefreshingCollectionCount = true;
            try {
                ext.state.notifyChildrenChanged(this.id);
            } finally {
                queueMicrotask(() => {
                    this.isRefreshingCollectionCount = false;
                });
            }
        }

        if (collections.length === 0) {
            // no databases in there:
            return [
                createGenericElement({
                    contextValue: createContextValue(['treeItem_no-collections', this.experienceContextValue]),
                    id: `${this.id}/no-collections`,
                    label: l10n.t('Create Collection…'),
                    iconPath: new vscode.ThemeIcon('plus'),
                    commandId: 'vscode-documentdb.command.createCollection',
                    commandArgs: [this],
                }) as TreeElement,
            ];
        }

        // Sort collections alphabetically by name before kicking off background
        // count loads. The per-cluster limiter dispatches in FIFO order, so
        // sorting first means counts are requested in alphabetical order.
        // Completion order still depends on per-request latency and may differ.
        collections.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        return collections.map((collection) => {
            const collectionItem = new CollectionItem(this.cluster, this.databaseInfo, collection, isCurrent);
            // Start loading document count in background (fire-and-forget).
            collectionItem.loadDocumentCount();
            return collectionItem;
        });
    }

    /**
     * Starts loading the collection count asynchronously.
     * When the count is retrieved, it triggers a tree item refresh to update the description.
     * This method is fire-and-forget and does not block tree expansion.
     */
    public loadCollectionCount(): void {
        if (this.isLoadingCount || this.collectionCount !== undefined) {
            return;
        }

        this.isLoadingCount = true;
        void this.fetchAndUpdateCount();
    }

    private async fetchAndUpdateCount(): Promise<void> {
        try {
            const collections = await this.getCollections();
            this.collectionCount = collections.length;
        } catch {
            meterSilentCatch('DatabaseItem_loadCollectionCount');
            this.collectionCount = undefined;
        } finally {
            this.isLoadingCount = false;
            this.isRefreshingCollectionCount = true;
            try {
                ext.state.notifyChildrenChanged(this.id);
            } finally {
                queueMicrotask(() => {
                    this.isRefreshingCollectionCount = false;
                });
            }
        }
    }

    private getCollections(): Promise<CollectionItemModel[]> {
        if (this.cachedCollections) {
            return Promise.resolve(this.cachedCollections);
        }

        if (!this.collectionsPromise) {
            this.collectionsPromise = ClustersClient.getClient(this.cluster.clusterId)
                .then((client) => client.listCollections(this.databaseInfo.name))
                .then((collections) => {
                    this.cachedCollections = collections;
                    return collections;
                })
                .finally(() => {
                    this.collectionsPromise = undefined;
                });
        }

        return this.collectionsPromise;
    }

    public invalidateChildrenCache(): void {
        if (this.isRefreshingCollectionCount) {
            return;
        }

        this.cachedCollections = undefined;
        this.collectionsPromise = undefined;
    }

    getTreeItem(): vscode.TreeItem {
        let description: string | undefined;
        if (typeof this.collectionCount === 'number' && this.collectionCount > 0) {
            const prefix = getCountPrefix();
            if (prefix) {
                description = `${prefix}${this.collectionCount}`;
            } else {
                description = `${this.collectionCount}`;
            }
        }

        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.databaseInfo.name,
            description,
            tooltip: this.buildTooltip(),
            iconPath: new vscode.ThemeIcon('database'), // TODO: create our own icon here, this one's shape can change
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    /**
     * Builds a markdown tooltip showing the database name and collection count.
     */
    private buildTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = false;

        md.appendMarkdown(`### ${escapeMarkdown(this.databaseInfo.name)}\n\n`);

        md.appendMarkdown(`\`${l10n.t('Database')}\`\n\n`);

        if (typeof this.collectionCount === 'number') {
            md.appendMarkdown(`**${l10n.t('Collections')}:** ${this.collectionCount}\n\n`);
        }

        return md;
    }
}
