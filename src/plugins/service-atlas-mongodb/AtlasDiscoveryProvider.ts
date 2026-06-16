/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, type IWizardOptions, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { Disposable, l10n, QuickPickItemKind, window } from 'vscode';
import { type NewConnectionWizardContext } from '../../commands/newConnection/NewConnectionWizardContext';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { type DiscoveryProvider } from '../../services/discoveryServices';
import { type TreeElement } from '../../tree/TreeElement';
import { AtlasApiClient } from './api/AtlasApiClient';
import { executeApiKeyFlow } from './auth/AtlasApiKeyFlow';
import { promptAtlasAuthMethod } from './auth/AtlasAuthQuickPick';
import { executeOAuthDeviceFlow } from './auth/AtlasOAuthDeviceFlow';
import { type AtlasSession, AtlasSessionState } from './auth/AtlasSession';
import { AtlasSessionManager } from './auth/AtlasSessionManager';
import { DESCRIPTION, DISCOVERY_PROVIDER_ID, ICON_PATH, LABEL, WIZARD_TITLE } from './config';
import { AtlasServiceRootItem } from './discovery-tree/AtlasServiceRootItem';
import { AtlasExecuteStep } from './discovery-wizard/AtlasExecuteStep';
import { SelectAtlasClusterStep, SelectAtlasProjectStep } from './discovery-wizard/SelectAtlasSteps';

/**
 * Discovery provider for MongoDB Atlas.
 * Registers as a plugin in the Service Discovery tree view, enabling users
 * to browse their Atlas Projects → Clusters hierarchy.
 */
export class AtlasDiscoveryProvider extends Disposable implements DiscoveryProvider {
    id = DISCOVERY_PROVIDER_ID;
    label = LABEL;
    description = DESCRIPTION;
    iconPath = ICON_PATH;

    private readonly sessionManager: AtlasSessionManager;

    constructor() {
        const sessionManager = new AtlasSessionManager(ext.secretStorage, ext.context.globalState);

        super(() => {
            // Cleanup on dispose
            // this.sessionManager.signOut();
        });

        this.sessionManager = sessionManager;

        // Listen for session changes to refresh the tree
        this.sessionManager.onDidChangeSession((state) => {
            // Clear cached error nodes so the tree re-fetches children
            const rootId = `${Views.DiscoveryView}/${DISCOVERY_PROVIDER_ID}`;
            if (state === AtlasSessionState.Active || state === AtlasSessionState.None) {
                ext.discoveryBranchDataProvider.resetNodeErrorState(rootId);
            }
            ext.discoveryBranchDataProvider.refresh();
        });
    }

    getDiscoveryTreeRootItem(parentId: string): TreeElement {
        return new AtlasServiceRootItem(this.sessionManager, parentId);
    }

    async getDiscoveryWizard(context: NewConnectionWizardContext): Promise<IWizardOptions<NewConnectionWizardContext>> {
        let session = await this.sessionManager.getSession();
        if (!session) {
            session = await this.promptSignInForWizard(context);
        }

        context.properties['atlas.session'] = session;

        return {
            title: WIZARD_TITLE,
            promptSteps: [new SelectAtlasProjectStep(), new SelectAtlasClusterStep()],
            executeSteps: [new AtlasExecuteStep()],
            showLoadingPrompt: true,
        };
    }

    /**
     * Prompts the user to authenticate to Atlas during the new-connection wizard and returns the
     * resulting session. Throws {@link UserCancelledError} if the user dismisses the auth-method
     * prompt, and returns undefined if authentication was attempted but did not succeed.
     */
    private async promptSignInForWizard(context: NewConnectionWizardContext): Promise<AtlasSession | undefined> {
        const authMethod = await promptAtlasAuthMethod();
        if (!authMethod) {
            throw new UserCancelledError();
        }

        const success =
            authMethod === 'oauth'
                ? await executeOAuthDeviceFlow(this.sessionManager)
                : await executeApiKeyFlow(this.sessionManager);

        if (!success) {
            return undefined;
        }

        context.telemetry.properties.authMethod = authMethod;
        context.telemetry.properties.authSuccess = 'true';

        return this.sessionManager.getSession();
    }

    getLearnMoreUrl(): string | undefined {
        return 'https://www.mongodb.com/docs/atlas/api/';
    }

    async configureTreeItemFilter(context: IActionContext, node: TreeElement): Promise<void> {
        if (!(node instanceof AtlasServiceRootItem)) {
            return;
        }

        context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;

        const session = await this.sessionManager.getSession();
        if (!session) {
            void window.showWarningMessage(l10n.t('Please sign in to Atlas first.'));
            return;
        }

        const client = new AtlasApiClient(session);
        let projects = await client.listProjects();

        if (projects.length === 0) {
            void window.showInformationMessage(l10n.t('No projects found in your Atlas account.'));
            return;
        }

        // Scope to the selected organization if one is active
        const selectedOrgId = this.sessionManager.getSelectedOrgId();
        if (selectedOrgId) {
            projects = projects.filter((project) => project.orgId === selectedOrgId);
            if (projects.length === 0) {
                void window.showInformationMessage(l10n.t('No projects found for the selected organization.'));
                return;
            }
        }

        const currentSelection = this.sessionManager.getSelectedProjectIds();

        const items = projects
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
            .map((project) => ({
                label: project.name,
                description: project.id,
                picked: currentSelection === undefined || currentSelection.includes(project.id),
                projectId: project.id,
            }));

        const selected = await window.showQuickPick(items, {
            canPickMany: true,
            placeHolder: l10n.t('Select projects to display (deselect to hide)'),
            title: l10n.t('Filter Atlas Projects'),
        });

        if (selected === undefined) {
            return; // User cancelled
        }

        // If all are selected, store undefined (show all)
        const selectedIds = selected.map((item) => item.projectId);
        const allSelected = selectedIds.length === projects.length;
        await this.sessionManager.setSelectedProjectIds(allSelected ? undefined : selectedIds);

        context.telemetry.properties.filterAction = allSelected ? 'showAll' : 'filtered';

        ext.discoveryBranchDataProvider.refresh(node);
    }

    async configureCredentials(context: IActionContext, node?: TreeElement): Promise<void> {
        context.telemetry.properties.credentialConfigActivated = 'true';
        context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;

        // If already authenticated, show user identity with sign out option
        if (this.sessionManager.state === AtlasSessionState.Active) {
            const displayName = this.sessionManager.getUserDisplayName() ?? l10n.t('Atlas Account');
            const signOut = l10n.t('Sign Out');
            const exit = l10n.t('Exit');

            const choice = await window.showQuickPick(
                [
                    {
                        label: `$(account) ${displayName}`,
                        description: l10n.t('Currently signed in'),
                    },
                    { label: '', kind: QuickPickItemKind.Separator },
                    {
                        label: `$(sign-out) ${signOut}`,
                    },
                    {
                        label: `$(close) ${exit}`,
                    },
                ],
                {
                    placeHolder: l10n.t('Signed in to Atlas as {0}', displayName),
                },
            );

            if (!choice || choice.label.includes(exit)) {
                return; // User cancelled or chose Exit
            }

            if (choice.label.includes(signOut)) {
                await this.sessionManager.signOut();
                context.telemetry.properties.action = 'signOut';
                if (node) {
                    ext.discoveryBranchDataProvider.refresh(node);
                } else {
                    ext.discoveryBranchDataProvider.refresh();
                }
                return;
            }

            // User selected their account — show organizations
            await this.showOrganizations(context);
            return;
        }

        // Not authenticated — prompt for auth method
        await this.authenticateAndFetchUserInfo(context, node);
    }

    /**
     * Shows accessible organizations for the authenticated user.
     * Selecting an organization filters the tree to show only that org's projects.
     */
    private async showOrganizations(context: IActionContext): Promise<void> {
        const session = await this.sessionManager.getSession();
        if (!session) {
            return;
        }

        try {
            const client = new AtlasApiClient(session);
            const orgs = await client.listOrganizations();

            if (orgs.length === 0) {
                void window.showInformationMessage(l10n.t('No organizations found for this account.'));
                return;
            }

            const currentOrgId = this.sessionManager.getSelectedOrgId();
            const showAllLabel = l10n.t('Show All');

            const items = [
                {
                    label: `$(list-flat) ${showAllLabel}`,
                    orgId: undefined as string | undefined,
                    description: currentOrgId === undefined ? l10n.t('Currently active') : undefined,
                },
                { label: '', kind: QuickPickItemKind.Separator, orgId: undefined as string | undefined },
                ...orgs
                    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
                    .map((org) => ({
                        label: org.name,
                        orgId: org.id as string | undefined,
                        description: currentOrgId === org.id ? l10n.t('Currently active') : undefined,
                    })),
            ];

            const selected = await window.showQuickPick(items, {
                placeHolder: l10n.t('Select an organization to show its projects'),
                title: l10n.t('Organizations'),
            });

            if (selected === undefined) {
                return; // User cancelled
            }

            await this.sessionManager.setSelectedOrgId(selected.orgId);
            // Clear project filter when switching orgs
            await this.sessionManager.setSelectedProjectIds(undefined);

            context.telemetry.properties.action = 'selectOrganization';
            context.telemetry.properties.filterAction = selected.orgId === undefined ? 'showAll' : 'filtered';

            ext.discoveryBranchDataProvider.refresh();
        } catch {
            void window.showErrorMessage(l10n.t('Failed to fetch organizations.'));
        }
    }

    /**
     * Runs the authentication flow and fetches user info on success.
     */
    private async authenticateAndFetchUserInfo(context: IActionContext, node?: TreeElement): Promise<void> {
        const authMethod = await promptAtlasAuthMethod();
        if (!authMethod) {
            return; // User cancelled
        }

        let success: boolean;
        if (authMethod === 'oauth') {
            success = await executeOAuthDeviceFlow(this.sessionManager);
        } else {
            success = await executeApiKeyFlow(this.sessionManager);
        }

        if (success) {
            context.telemetry.properties.authMethod = authMethod;
            context.telemetry.properties.authSuccess = 'true';

            // Fetch and store user display name
            await this.fetchAndStoreUserInfo();

            // Clear the cached error state so the tree re-fetches children
            if (node?.id) {
                ext.discoveryBranchDataProvider.resetNodeErrorState(node.id);
            }
        }

        if (node) {
            ext.discoveryBranchDataProvider.refresh(node);
        } else {
            ext.discoveryBranchDataProvider.refresh();
        }
    }

    /**
     * Fetches the current user's info from Atlas and stores the display name.
     */
    private async fetchAndStoreUserInfo(): Promise<void> {
        try {
            const session = await this.sessionManager.getSession();
            if (!session) {
                return;
            }

            const client = new AtlasApiClient(session);
            const user = await client.getCurrentUser();
            const displayName = user.emailAddress || user.username || `${user.firstName} ${user.lastName}`.trim();
            await this.sessionManager.setUserDisplayName(displayName);
        } catch {
            // Non-critical — UI will fall back to "Atlas Account"
        }
    }
}
