/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue, createGenericElement } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ClustersClient, type DatabaseItemModel } from '../../documentdb/ClustersClient';
import { type Experience } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
import { type BaseClusterModel, type TreeCluster } from '../models/BaseClusterModel';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { CollectionItem } from './CollectionItem';

/**
 * Escapes markdown special characters so user-provided text is always rendered
 * as plain text rather than being interpreted as markdown formatting or links.
 */
function escapeMarkdown(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!|~]/g, '\\$&');
}

export class DatabaseItem implements TreeElement, TreeElementWithExperience, TreeElementWithContextValue {
    public readonly id: string;
    public readonly experience: Experience;
    public contextValue: string = 'treeItem_database';

    private readonly experienceContextValue: string = '';

    /**
     * Cached collection count for the database.
     * undefined means not yet loaded, null means loading failed.
     */
    private collectionCount: number | undefined | null = undefined;

    /**
     * Flag indicating if a count fetch is in progress.
     */
    private isLoadingCount: boolean = false;

    constructor(
        readonly cluster: TreeCluster<BaseClusterModel>,
        readonly databaseInfo: DatabaseItemModel,
    ) {
        this.id = `${cluster.treeId}/${databaseInfo.name}`;
        this.experience = cluster.dbExperience;
        this.experienceContextValue = `experience_${this.experience?.api}`;
        this.contextValue = createContextValue([this.contextValue, this.experienceContextValue]);
    }

    /**
     * Starts loading the collection count asynchronously.
     * When the count is retrieved, it triggers a tree item refresh to update the description.
     * This method is fire-and-forget and does not block tree expansion.
     */
    public loadCollectionCount(): void {
        // Skip if already loading or already loaded
        if (this.isLoadingCount || this.collectionCount !== undefined) {
            return;
        }

        this.isLoadingCount = true;

        // Fire-and-forget: load count in background
        void this.fetchAndUpdateCount();
    }

    /**
     * Fetches the collection count and triggers a tree refresh when complete.
     */
    private async fetchAndUpdateCount(): Promise<void> {
        try {
            const client = await ClustersClient.getClient(this.cluster.clusterId);
            const collections = await client.listCollections(this.databaseInfo.name);
            this.collectionCount = collections.length;
        } catch {
            // On error, set to null to indicate failure (we won't retry automatically)
            this.collectionCount = null;
        } finally {
            this.isLoadingCount = false;
            // Trigger a tree item refresh to show the updated description
            ext.state.notifyChildrenChanged(this.id);
        }
    }

    async getChildren(): Promise<TreeElement[]> {
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
        // Build description based on collection count state
        let description: string | undefined;
        if (typeof this.collectionCount === 'number') {
            description =
                this.collectionCount === 1
                    ? l10n.t('1 collection')
                    : l10n.t('{count} collections', { count: this.collectionCount });
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
