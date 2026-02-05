/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ClustersClient, type CollectionItemModel, type DatabaseItemModel } from '../../documentdb/ClustersClient';
import { type Experience } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
import { formatDocumentCount } from '../../utils/formatDocumentCount';
import { type BaseClusterModel, type TreeCluster } from '../models/BaseClusterModel';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { DocumentsItem } from './DocumentsItem';
import { IndexesItem } from './IndexesItem';

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

    constructor(
        readonly cluster: TreeCluster<BaseClusterModel>,
        readonly databaseInfo: DatabaseItemModel,
        readonly collectionInfo: CollectionItemModel,
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
        try {
            const client = await ClustersClient.getClient(this.cluster.clusterId);
            this.documentCount = await client.estimateDocumentCount(this.databaseInfo.name, this.collectionInfo.name);
        } catch {
            // On error, set to null to indicate failure (we won't retry automatically)
            this.documentCount = null;
        } finally {
            this.isLoadingCount = false;
            // Trigger a tree item refresh to show the updated description
            ext.state.notifyChildrenChanged(this.id);
        }
    }

    async getChildren(): Promise<TreeElement[]> {
        return [
            new DocumentsItem(this.cluster, this.databaseInfo, this.collectionInfo, this),
            new IndexesItem(this.cluster, this.databaseInfo, this.collectionInfo),
        ];
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
            iconPath: new vscode.ThemeIcon('folder-library'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
