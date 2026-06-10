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
import { executeApiKeyFlow } from '../auth/AtlasApiKeyFlow';
import { promptAtlasAuthMethod } from '../auth/AtlasAuthQuickPick';
import { executeOAuthDeviceFlow } from '../auth/AtlasOAuthDeviceFlow';
import { AtlasSessionState } from '../auth/AtlasSession';
import { type AtlasSessionManager } from '../auth/AtlasSessionManager';
import { DISCOVERY_PROVIDER_ID } from '../config';
import { AtlasProjectItem } from './AtlasProjectItem';

/**
 * Root tree item for the Atlas MongoDB discovery provider.
 * Handles authentication gating — on expand, ensures a valid session exists
 * before fetching and displaying projects.
 */
export class AtlasServiceRootItem implements TreeElement, TreeElementWithContextValue, TreeElementWithRetryChildren {
    public readonly id: string;
    public contextValue: string =
        'enableRefreshCommand;enableManageCredentialsCommand;enableFilterCommand;enableLearnMoreCommand;discoveryAtlasServiceRootItem';

    constructor(
        private readonly sessionManager: AtlasSessionManager,
        public readonly parentId: string,
    ) {
        this.id = `${parentId}/${DISCOVERY_PROVIDER_ID}`;
    }

    async getChildren(): Promise<ExtTreeElementBase[]> {
        // Attempt to get or establish a session
        let session = await this.sessionManager.getSession();

        if (!session) {
            // No session — prompt user to authenticate
            const authenticated = await this.promptAuthentication();
            if (!authenticated) {
                return [this.createSignInNode()];
            }
            session = await this.sessionManager.getSession();
        }

        if (!session) {
            return [this.createSignInNode()];
        }

        // Fetch projects from Atlas
        try {
            const client = new AtlasApiClient(session);

            // Lazily fetch user display name if not already stored
            if (!this.sessionManager.getUserDisplayName()) {
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
                // Attempt token refresh for OAuth sessions before giving up
                const refreshedSession = await this.sessionManager.tryRefreshIfOAuth();
                if (refreshedSession) {
                    try {
                        return await this.fetchProjectItems(new AtlasApiClient(refreshedSession));
                    } catch {
                        // Refresh succeeded but still got an error — fall through
                    }
                }

                if (error.statusCode === 401) {
                    await this.sessionManager.signOut();
                    return [this.createSignInNode()];
                }

                // 403 — genuinely lacks permissions
                return [this.createErrorNode(error.message)];
            }

            const errorMessage = error instanceof Error ? error.message : String(error);
            return [this.createErrorNode(errorMessage)];
        }
    }

    /**
     * Fetches projects and organizations from Atlas, returning tree items.
     * Applies org filter (from Manage Credentials → Organizations) and/or
     * project filter (from the Filter icon) if configured.
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

        // Apply organization filter (set via Manage Credentials → Organizations)
        const selectedOrgId = this.sessionManager.getSelectedOrgId();
        let filteredProjects = selectedOrgId === undefined
            ? projects
            : projects.filter((project) => project.orgId === selectedOrgId);

        // Apply project filter (set via Filter icon)
        const selectedProjectIds = this.sessionManager.getSelectedProjectIds();
        if (selectedProjectIds !== undefined) {
            filteredProjects = filteredProjects.filter((project) => selectedProjectIds.includes(project.id));
        }

        if (filteredProjects.length === 0) {
            const message = selectedOrgId
                ? vscode.l10n.t('No projects found for the selected organization')
                : vscode.l10n.t('All projects are hidden by filter');
            return [
                createGenericElementWithContext({
                    contextValue: 'info',
                    id: `${this.id}/all-filtered`,
                    label: message,
                    description: vscode.l10n.t('Use the filter button to adjust'),
                    iconPath: new vscode.ThemeIcon('filter'),
                }),
            ];
        }

        // Build org name lookup for project descriptions
        const orgNameMap = new Map(orgs.map((org) => [org.id, org.name]));

        return filteredProjects
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
            .map((project) => new AtlasProjectItem(this.id, project, this.sessionManager, orgNameMap.get(project.orgId)));
    }

    public hasRetryNode(children: TreeElement[] | null | undefined): boolean {
        return (
            children?.some((child) => isTreeElementWithContextValue(child) && child.contextValue === 'error') ?? false
        );
    }

    public getTreeItem(): vscode.TreeItem {
        const stateIcon = this.getStateIcon();
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: vscode.l10n.t('Atlas MongoDB'),
            iconPath: stateIcon,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    /**
     * Prompts user for authentication method and executes the chosen flow.
     */
    private async promptAuthentication(): Promise<boolean> {
        const authMethod = await promptAtlasAuthMethod();

        if (!authMethod) {
            return false; // User cancelled
        }

        if (authMethod === 'oauth') {
            return executeOAuthDeviceFlow(this.sessionManager);
        } else {
            return executeApiKeyFlow(this.sessionManager);
        }
    }

    private createSignInNode(): TreeElement & TreeElementWithContextValue {
        return createGenericElementWithContext({
            contextValue: 'error',
            id: `${this.id}/sign-in`,
            label: vscode.l10n.t('Sign in to view Atlas clusters'),
            iconPath: new vscode.ThemeIcon('sign-in'),
            commandId: 'vscode-documentdb.command.discoveryView.manageCredentials',
            commandArgs: [this],
        });
    }

    private createErrorNode(message: string): TreeElement & TreeElementWithContextValue {
        return createGenericElementWithContext({
            contextValue: 'error',
            id: `${this.id}/error`,
            label: message,
            iconPath: new vscode.ThemeIcon('error'),
            commandId: 'vscode-documentdb.command.internal.retry',
            commandArgs: [this],
        });
    }

    private getStateIcon(): vscode.ThemeIcon {
        switch (this.sessionManager.state) {
            case AtlasSessionState.Active:
                return new vscode.ThemeIcon('cloud');
            case AtlasSessionState.Expired:
                return new vscode.ThemeIcon('warning');
            case AtlasSessionState.Authenticating:
                return new vscode.ThemeIcon('loading~spin');
            default:
                return new vscode.ThemeIcon('cloud');
        }
    }
}
