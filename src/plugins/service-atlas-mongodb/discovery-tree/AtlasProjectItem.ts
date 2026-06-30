/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Views } from '../../../documentdb/Views';
import { AtlasExperience } from '../../../DocumentDBExperiences';
import { createGenericElementWithContext } from '../../../tree/api/createGenericElementWithContext';
import { type ExtTreeElementBase, type TreeElement } from '../../../tree/TreeElement';
import { type TreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';
import { AtlasApiClient, AtlasApiError } from '../api/AtlasApiClient';
import { AtlasSessionState } from '../auth/AtlasSession';
import { type AtlasSessionManager } from '../auth/AtlasSessionManager';
import { createAtlasClusterModel } from '../models/AtlasClusterModel';
import { type AtlasProject } from '../models/AtlasProjectModel';
import { AtlasClusterItem } from './AtlasClusterItem';

/**
 * Tree item representing a MongoDB Atlas project.
 * On expand, fetches and displays clusters within the project.
 */
export class AtlasProjectItem implements TreeElement, TreeElementWithContextValue {
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
            return [
                createGenericElementWithContext({
                    contextValue: 'error',
                    id: `${this.id}/no-session`,
                    label: vscode.l10n.t('Please sign in to MongoDB Atlas again.'),
                    iconPath: new vscode.ThemeIcon('warning'),
                }),
            ];
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
                // The client already attempted a silent token refresh + retry before throwing.
                // Only when the refresh token is completely rejected does the session manager
                // sign out (state === None) — in that case prompt the user to sign in again.
                if (this.sessionManager.state === AtlasSessionState.None) {
                    return [
                        createGenericElementWithContext({
                            contextValue: 'error',
                            id: `${this.id}/auth-error`,
                            label: vscode.l10n.t('Please sign in to MongoDB Atlas again.'),
                            iconPath: new vscode.ThemeIcon('error'),
                        }),
                    ];
                }

                // Transient failure or insufficient permissions — keep the session intact
                // and surface the error without forcing a re-authentication.
                return [
                    createGenericElementWithContext({
                        contextValue: 'error',
                        id: `${this.id}/auth-error`,
                        label: error.message,
                        iconPath: new vscode.ThemeIcon('error'),
                    }),
                ];
            }

            const errorMessage = error instanceof Error ? error.message : String(error);
            return [
                createGenericElementWithContext({
                    contextValue: 'error',
                    id: `${this.id}/error`,
                    label: vscode.l10n.t('Failed to load clusters: {0}', errorMessage),
                    iconPath: new vscode.ThemeIcon('error'),
                }),
            ];
        }
    }

    public getTreeItem(): vscode.TreeItem {
        const clusterCount = vscode.l10n.t('{0} clusters', String(this.project.clusterCount));
        const description = this.orgName ? `${this.orgName} · ${clusterCount}` : clusterCount;

        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.project.name,
            description,
            iconPath: new vscode.ThemeIcon('project'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
