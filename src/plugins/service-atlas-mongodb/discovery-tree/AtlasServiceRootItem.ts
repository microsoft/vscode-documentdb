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
import { promptAtlasAuthMethod } from '../auth/AtlasAuthQuickPick';
import { AtlasSessionState } from '../auth/AtlasSession';
import { type AtlasSessionManager } from '../auth/AtlasSessionManager';
import { executeAtlasAuthFlow } from '../auth/executeAtlasAuthFlow';
import { DISCOVERY_PROVIDER_ID } from '../config';
import { AtlasProjectItem } from './AtlasProjectItem';

/**
 * Root tree item for the MongoDB Atlas discovery provider.
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
            // A sign-in was just cancelled — the resulting refresh should show the sign-in
            // node rather than immediately re-opening the auth prompt.
            if (this.sessionManager.consumeSuppressAutoPrompt()) {
                return [this.createSignInNode()];
            }

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
                await this.showLoadFailure(error.message);
                return [this.createRetryNode()];
            }

            const errorMessage = error instanceof Error ? error.message : String(error);
            await this.showLoadFailure(errorMessage);
            return [this.createRetryNode()];
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
        let filteredProjects =
            selectedOrgId === undefined ? projects : projects.filter((project) => project.orgId === selectedOrgId);

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

    /**
     * Prompts user for authentication method and executes the chosen flow.
     */
    private async promptAuthentication(): Promise<boolean> {
        const authMethod = await promptAtlasAuthMethod();

        if (!authMethod) {
            return false; // User cancelled
        }

        return executeAtlasAuthFlow(authMethod, this.sessionManager);
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

    private async showLoadFailure(errorMessage: string): Promise<void> {
        await vscode.window.showErrorMessage(vscode.l10n.t('Failed to load MongoDB Atlas projects.'), {
            modal: true,
            detail:
                vscode.l10n.t('Revisit credentials and filters, then try again.') +
                '\n\n' +
                vscode.l10n.t('Error: {0}', errorMessage),
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
