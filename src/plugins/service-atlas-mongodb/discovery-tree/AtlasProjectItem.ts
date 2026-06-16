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
                    label: vscode.l10n.t('Session expired. Please sign in again.'),
                    iconPath: new vscode.ThemeIcon('warning'),
                }),
            ];
        }

        try {
            const client = new AtlasApiClient(session);
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
                        treeId: `${this.id}/${cluster.name}`,
                        viewId: Views.DiscoveryView,
                    };
                    return new AtlasClusterItem('', treeCluster);
                });
        } catch (error) {
            if (error instanceof AtlasApiError && error.statusCode === 401) {
                // Attempt token refresh for OAuth sessions before signing out
                const refreshedSession = await this.sessionManager.tryRefreshIfOAuth();
                if (refreshedSession) {
                    try {
                        const retryClient = new AtlasApiClient(refreshedSession);
                        const retryClusters = await retryClient.listClusters(this.project.id);
                        return retryClusters
                            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
                            .map((cluster) => {
                                const model = createAtlasClusterModel(
                                    this.project.id,
                                    this.project.name,
                                    cluster,
                                    AtlasExperience,
                                );
                                const treeCluster = {
                                    ...model,
                                    treeId: `${this.id}/${cluster.name}`,
                                    viewId: Views.DiscoveryView,
                                };
                                return new AtlasClusterItem('', treeCluster);
                            });
                    } catch {
                        // Refresh succeeded but retry still failed — fall through to sign out
                    }
                }

                await this.sessionManager.signOut();
                return [
                    createGenericElementWithContext({
                        contextValue: 'error',
                        id: `${this.id}/auth-error`,
                        label: vscode.l10n.t('Authentication expired. Please sign in again.'),
                        iconPath: new vscode.ThemeIcon('error'),
                    }),
                ];
            }

            if (error instanceof AtlasApiError && error.statusCode === 403) {
                // Genuinely lacks permissions. Clear the cached session so that
                // "Manage Credentials" re-prompts for authentication.
                await this.sessionManager.signOut();
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
