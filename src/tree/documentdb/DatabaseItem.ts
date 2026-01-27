/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue, createGenericElement } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type Experience } from '../../DocumentDBExperiences';
import { ClustersClient, type DatabaseItemModel } from '../../documentdb/ClustersClient';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type ClusterModel } from './ClusterModel';
import { CollectionItem } from './CollectionItem';

export class DatabaseItem implements TreeElement, TreeElementWithExperience, TreeElementWithContextValue {
    public readonly id: string;
    public readonly experience: Experience;
    public contextValue: string = 'treeItem_database';

    private readonly experienceContextValue: string = '';

    constructor(
        readonly cluster: ClusterModel,
        readonly databaseInfo: DatabaseItemModel,
    ) {
        this.id = `${cluster.id}/${databaseInfo.name}`;
        this.experience = cluster.dbExperience;
        this.experienceContextValue = `experience_${this.experience?.api}`;
        this.contextValue = createContextValue([this.contextValue, this.experienceContextValue]);
    }

    async getChildren(): Promise<TreeElement[]> {
        const client: ClustersClient = await ClustersClient.getClient(this.cluster.id);
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

        // Sort collections alphabetically by name
        collections.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        return collections.map((collection) => {
            const collectionItem = new CollectionItem(this.cluster, this.databaseInfo, collection);
            // Start loading document count in background (fire-and-forget)
            // This does not block tree expansion
            collectionItem.loadDocumentCount();
            return collectionItem;
        });
    }

    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.databaseInfo.name,
            iconPath: new vscode.ThemeIcon('database'), // TODO: create our own icon here, this one's shape can change
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
