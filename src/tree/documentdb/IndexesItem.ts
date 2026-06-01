/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import {
    ClustersClient,
    type CollectionItemModel,
    type DatabaseItemModel,
    type IndexItemModel,
} from '../../documentdb/ClustersClient';
import { type Experience } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
import { meterSilentCatch } from '../../utils/callWithAccumulatingTelemetry';
import { getCountPrefix } from '../../utils/countPrefix';
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
     * `undefined` means not yet loaded, `null` means loading failed (used as a
     * sentinel so a failed load is not retried for this item instance).
     */
    private indexCount: number | undefined | null;
    private isLoadingCount: boolean = false;

    constructor(
        readonly cluster: TreeCluster<BaseClusterModel>,
        readonly databaseInfo: DatabaseItemModel,
        readonly collectionInfo: CollectionItemModel,
    ) {
        this.id = `${cluster.treeId}/${databaseInfo.name}/${collectionInfo.name}/indexes`;
        this.experience = cluster.dbExperience;
        this.experienceContextValue = `experience_${this.experience.api}`;
        this.contextValue = createContextValue([this.contextValue, this.experienceContextValue]);
    }

    async getChildren(): Promise<TreeElement[]> {
        const indexes = await this.fetchIndexes();

        // Update the index count from the full list we just fetched.
        const previousCount = this.indexCount;
        this.indexCount = indexes.length;

        if (previousCount !== this.indexCount) {
            ext.state.notifyChildrenChanged(this.id);
        }

        // Sort indexes by name, with _id_ always first
        indexes.sort((a, b) => compareIndexNames(a.name, b.name));

        return indexes.map((index) => {
            return new IndexItem(this.cluster, this.databaseInfo, this.collectionInfo, index);
        });
    }

    /**
     * Starts loading the index count asynchronously.
     * When the count is retrieved, it triggers a tree item refresh to update the description.
     * This method is fire-and-forget and does not block tree expansion.
     */
    public loadIndexCount(): void {
        if (this.isLoadingCount || this.indexCount !== undefined) {
            return;
        }

        this.isLoadingCount = true;
        void this.fetchAndUpdateCount();
    }

    private async fetchAndUpdateCount(): Promise<void> {
        try {
            const indexes = await this.fetchIndexes();
            this.indexCount = indexes.length;
        } catch {
            meterSilentCatch('IndexesItem_loadIndexCount');
            // Use null (not undefined) so loadIndexCount() does not retry a
            // known-failing request for this item instance.
            this.indexCount = null;
        } finally {
            this.isLoadingCount = false;
            ext.state.notifyChildrenChanged(this.id);
        }
    }

    private async fetchIndexes(): Promise<IndexItemModel[]> {
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

        return indexes;
    }

    getTreeItem(): vscode.TreeItem {
        let description: string | undefined;
        if (typeof this.indexCount === 'number') {
            const prefix = getCountPrefix();
            if (prefix) {
                description = `${prefix}${this.indexCount}`;
            } else {
                description = `${this.indexCount}`;
            }
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
