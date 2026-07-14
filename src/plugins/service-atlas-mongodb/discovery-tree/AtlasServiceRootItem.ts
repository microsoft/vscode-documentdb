/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { createGenericElementWithContext } from '../../../tree/api/createGenericElementWithContext';
import { type ExtTreeElementBase, type TreeElement } from '../../../tree/TreeElement';
import {
    isTreeElementWithContextValue,
    type TreeElementWithContextValue,
} from '../../../tree/TreeElementWithContextValue';
import { type TreeElementWithRetryChildren } from '../../../tree/TreeElementWithRetryChildren';
import { AtlasApiClient, AtlasApiError } from '../api/AtlasApiClient';
import { AtlasSessionState } from '../auth/AtlasSession';
import { type AtlasSessionManager } from '../auth/AtlasSessionManager';
import { DISCOVERY_PROVIDER_ID } from '../config';
import { AtlasProjectItem } from './AtlasProjectItem';
import { showAtlasLoadFailure } from './showAtlasLoadFailure';

/**
 * Root tree item for the MongoDB Atlas discovery provider.
 * Handles authentication gating before fetching and displaying projects.
 */
export class AtlasServiceRootItem implements TreeElement, TreeElementWithContextValue, TreeElementWithRetryChildren {
    public readonly id: string;
    public contextValue: string =
        'enableRefreshCommand;enableManageCredentialsCommand;enableLearnMoreCommand;discoveryAtlasServiceRootItem';

    constructor(
        private readonly sessionManager: AtlasSessionManager,
        public readonly parentId: string,
    ) {
        this.id = `${parentId}/${DISCOVERY_PROVIDER_ID}`;
    }

    async getChildren(): Promise<ExtTreeElementBase[]> {
        const session = await this.sessionManager.getSession();

        if (!session) {
            return [this.createSignInNode()];
        }

        // Fetch projects from Atlas
        try {
            const client = new AtlasApiClient(session, this.sessionManager);

            // Lazily fetch user display name if not already stored
            // (Service Accounts don't have user profiles, so skip for them)
            if (!this.sessionManager.getUserDisplayName() && session.type !== 'serviceaccount') {
                void client.getCurrentUser().then(
                    (user) => {
                        const displayName =
                            user.emailAddress || user.username || `${user.firstName} ${user.lastName}`.trim();
                        void this.sessionManager.setUserDisplayName(displayName);
                    },
                    () => {
                        // Non-critical — ignore errors
                    },
                );
            }

            return await this.fetchProjectItems(client);
        } catch (error) {
            if (error instanceof AtlasApiError && (error.statusCode === 401 || error.statusCode === 403)) {
                // The client already attempted a silent token refresh + retry before throwing.
                // Only when the refresh token is completely rejected does the session manager
                // sign out (state === None) — in that case prompt the user to sign in again.
                if (this.sessionManager.state === AtlasSessionState.None) {
                    return [this.createSignInNode()];
                }

                // Transient failure or insufficient permissions — keep the session intact and
                // offer a retry instead of forcing the user to re-authenticate.
                await showAtlasLoadFailure(vscode.l10n.t('Failed to load MongoDB Atlas projects.'), error.message);
                return [this.createRetryNode()];
            }

            const errorMessage = error instanceof Error ? error.message : String(error);
            await showAtlasLoadFailure(vscode.l10n.t('Failed to load MongoDB Atlas projects.'), errorMessage);
            return [this.createRetryNode()];
        }
    }

    /**
     * Fetches projects and organizations from Atlas, returning tree items.
     */
    private async fetchProjectItems(client: AtlasApiClient): Promise<ExtTreeElementBase[]> {
        const [projects, orgs] = await Promise.all([client.listProjects(), client.listOrganizations()]);

        if (projects.length === 0) {
            return [
                createGenericElementWithContext({
                    contextValue: 'info',
                    id: `${this.id}/no-projects`,
                    label: vscode.l10n.t('No projects found'),
                    description: vscode.l10n.t('Create a project in the Atlas console'),
                    iconPath: new vscode.ThemeIcon('info'),
                }),
            ];
        }

        // Build org name lookup for project descriptions
        const orgNameMap = new Map(orgs.map((org) => [org.id, org.name]));

        return projects
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
            .map(
                (project) => new AtlasProjectItem(this.id, project, this.sessionManager, orgNameMap.get(project.orgId)),
            );
    }

    public hasRetryNode(children: TreeElement[] | null | undefined): boolean {
        return (
            children?.some((child) => isTreeElementWithContextValue(child) && child.contextValue === 'error') ?? false
        );
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: vscode.l10n.t('MongoDB Atlas'),
            description: this.getStateDescription(),
            iconPath: new vscode.ThemeIcon('cloud'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    private createSignInNode(): TreeElement & TreeElementWithContextValue {
        return createGenericElementWithContext({
            contextValue: 'error',
            id: `${this.id}/sign-in`,
            label: vscode.l10n.t('Sign in to view MongoDB Atlas clusters'),
            iconPath: new vscode.ThemeIcon('sign-in'),
            commandId: 'vscode-documentdb.command.discoveryView.manageCredentials',
            commandArgs: [this],
        });
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

    private getStateDescription(): string {
        switch (this.sessionManager.state) {
            case AtlasSessionState.Expired:
                return vscode.l10n.t('Session expired');
            case AtlasSessionState.Authenticating:
                return vscode.l10n.t('Authenticating…');
            default:
                return '';
        }
    }
}
