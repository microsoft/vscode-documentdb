/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Views } from '../../../documentdb/Views';
import { AtlasExperience } from '../../../DocumentDBExperiences';
import { createGenericElementWithContext } from '../../../tree/api/createGenericElementWithContext';
import { type ExtTreeElementBase, type TreeElement } from '../../../tree/TreeElement';
import {
    isTreeElementWithContextValue,
    type TreeElementWithContextValue,
} from '../../../tree/TreeElementWithContextValue';
import { type TreeElementWithRetryChildren } from '../../../tree/TreeElementWithRetryChildren';
import { escapeMarkdown } from '../../../webviews/utils/escapeMarkdown';
import { AtlasApiClient, AtlasApiError } from '../api/AtlasApiClient';
import { type AtlasSessionManager } from '../auth/AtlasSessionManager';
import { createAtlasClusterModel } from '../models/AtlasClusterModel';
import { type AtlasProject } from '../models/AtlasProjectModel';
import { AtlasClusterItem } from './AtlasClusterItem';
import { showAtlasLoadFailure } from './showAtlasLoadFailure';

/**
 * Tree item representing a MongoDB Atlas project.
 * On expand, fetches and displays clusters within the project.
 */
export class AtlasProjectItem implements TreeElement, TreeElementWithContextValue, TreeElementWithRetryChildren {
    public readonly id: string;
    public contextValue: string = 'enableRefreshCommand;treeItem_atlasProject';

    constructor(
        parentId: string,
        private readonly project: AtlasProject,
        private readonly sessionManager: AtlasSessionManager,
        private readonly orgName?: string,
    ) {
        this.id = `${parentId}/${project.id}`;
    }

    async getChildren(): Promise<ExtTreeElementBase[]> {
        const session = await this.sessionManager.getSession();
        if (!session) {
            await showAtlasLoadFailure(
                vscode.l10n.t('Failed to load MongoDB Atlas clusters.'),
                vscode.l10n.t('Atlas session is not available.'),
            );
            return [this.createRetryNode()];
        }

        try {
            const client = new AtlasApiClient(session, this.sessionManager);
            const clusters = await client.listClusters(this.project.id);

            if (clusters.length === 0) {
                return [
                    createGenericElementWithContext({
                        contextValue: 'info',
                        id: `${this.id}/no-clusters`,
                        label: vscode.l10n.t('No clusters found in this project'),
                        iconPath: new vscode.ThemeIcon('info'),
                    }),
                ];
            }

            return clusters
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
                .map((cluster) => {
                    const model = createAtlasClusterModel(this.project.id, this.project.name, cluster, AtlasExperience);
                    const treeCluster = {
                        ...model,
                        treeId: `${this.id}/${cluster.name.replaceAll('/', '_')}`,
                        viewId: Views.DiscoveryView,
                    };
                    return new AtlasClusterItem('', treeCluster);
                });
        } catch (error) {
            if (error instanceof AtlasApiError && (error.statusCode === 401 || error.statusCode === 403)) {
                await showAtlasLoadFailure(vscode.l10n.t('Failed to load MongoDB Atlas clusters.'), error.message);
                return [this.createRetryNode()];
            }

            const errorMessage = error instanceof Error ? error.message : String(error);
            await showAtlasLoadFailure(vscode.l10n.t('Failed to load MongoDB Atlas clusters.'), errorMessage);
            return [this.createRetryNode()];
        }
    }

    public hasRetryNode(children: TreeElement[] | null | undefined): boolean {
        return (
            children?.some((child) => isTreeElementWithContextValue(child) && child.contextValue === 'error') ?? false
        );
    }

    public getTreeItem(): vscode.TreeItem {
        const clusterCount = vscode.l10n.t('{0} clusters', String(this.project.clusterCount));
        const description = this.orgName ? `${this.orgName} · ${clusterCount}` : clusterCount;

        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.project.name,
            description,
            tooltip: this.buildTooltip(),
            iconPath: new vscode.ThemeIcon('project'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    private buildTooltip(): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = false;

        md.appendMarkdown(`**${escapeMarkdown(this.project.name)}**\n\n`);
        if (this.orgName) {
            md.appendMarkdown(`- **${vscode.l10n.t('Organization')}:** ${escapeMarkdown(this.orgName)}\n`);
        }
        md.appendMarkdown(`- **${vscode.l10n.t('Project ID')}:** ${escapeMarkdown(this.project.id)}\n`);
        md.appendMarkdown(`- **${vscode.l10n.t('Clusters')}:** ${String(this.project.clusterCount)}\n`);

        return md;
    }

    private createRetryNode(): TreeElement & TreeElementWithContextValue {
        return createGenericElementWithContext({
            contextValue: 'error',
            id: `${this.id}/retry`,
            label: vscode.l10n.t('Click here to retry'),
            iconPath: new vscode.ThemeIcon('refresh'),
            commandId: 'vscode-documentdb.command.internal.retry',
            commandArgs: [this],
        });
    }
}
