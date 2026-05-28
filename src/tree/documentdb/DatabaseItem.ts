/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue, createGenericElement } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ClustersClient, type DatabaseItemModel } from '../../documentdb/ClustersClient';
import { type Experience } from '../../DocumentDBExperiences';
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

        const client: ClustersClient = await ClustersClient.getClient(this.cluster.clusterId);
        const collections = await client.listCollections(this.databaseInfo.name);

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

    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.databaseInfo.name,
            tooltip: this.buildTooltip(),
            iconPath: new vscode.ThemeIcon('database'), // TODO: create our own icon here, this one's shape can change
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    /**
     * Builds a markdown tooltip showing the database name.
     */
    private buildTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = false;

        md.appendMarkdown(`### ${escapeMarkdown(this.databaseInfo.name)}\n\n`);

        md.appendMarkdown(`\`${l10n.t('Database')}\`\n\n`);

        return md;
    }
}
