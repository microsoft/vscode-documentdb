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

export class IndexesItem implements TreeElement, TreeElementWithExperience, TreeElementWithContextValue {
    public readonly id: string;
    public readonly experience: Experience;
    public contextValue: string = 'treeItem_indexes';

    private readonly experienceContextValue: string = '';
    private indexCount: number | undefined;

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

        this.updateIndexCount(indexes.length);

        // Sort indexes by name
        indexes.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        return indexes.map((index) => {
            return new IndexItem(this.cluster, this.databaseInfo, this.collectionInfo, index);
        });
    }

    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: l10n.t('Indexes'),
            description:
                typeof this.indexCount === 'number'
                    ? this.indexCount === 1
                        ? l10n.t('1 index')
                        : l10n.t('{0} indexes', this.indexCount)
                    : undefined,
            iconPath: new vscode.ThemeIcon('combine'), // TODO: create our onw icon here, this one's shape can change
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    private updateIndexCount(count: number): void {
        if (this.indexCount === count) {
            return;
        }

        this.indexCount = count;
        ext.state.notifyChildrenChanged(this.id);
    }
}
