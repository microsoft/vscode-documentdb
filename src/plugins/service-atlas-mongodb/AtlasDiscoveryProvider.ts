/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, type IWizardOptions, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { Disposable, l10n, window } from 'vscode';
import { type NewConnectionWizardContext } from '../../commands/newConnection/NewConnectionWizardContext';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { type DiscoveryProvider } from '../../services/discoveryServices';
import { type TreeElement } from '../../tree/TreeElement';
import { AtlasApiClient } from './api/AtlasApiClient';
import { promptAtlasAuthMethod } from './auth/AtlasAuthQuickPick';
import { type AtlasSession, AtlasSessionState } from './auth/AtlasSession';
import { AtlasSessionManager } from './auth/AtlasSessionManager';
import { executeAtlasAuthFlow } from './auth/executeAtlasAuthFlow';
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
            promptSteps: [
                new SelectAtlasProjectStep(this.sessionManager),
                new SelectAtlasClusterStep(this.sessionManager),
            ],
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

        const success = await executeAtlasAuthFlow(authMethod, this.sessionManager);

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

    async configureCredentials(context: IActionContext, node?: TreeElement): Promise<void> {
        context.telemetry.properties.credentialConfigActivated = 'true';
        context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;

        // If already authenticated, show user identity with credential actions.
        if (this.sessionManager.state === AtlasSessionState.Active) {
            const displayName = this.sessionManager.getUserDisplayName() ?? l10n.t('Atlas Account');
            const updateCredentials = l10n.t('Update credentials');
            const signOut = l10n.t('Sign Out');
            const exit = l10n.t('Exit');

            const choice = await window.showQuickPick(
                [
                    {
                        label: `$(key) ${updateCredentials}`,
                    },
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

            if (choice.label.includes(updateCredentials)) {
                await this.authenticateAndFetchUserInfo(context, node);
                return;
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
        }

        // Not authenticated — prompt for auth method
        await this.authenticateAndFetchUserInfo(context, node);
    }

    /**
     * Runs the authentication flow and fetches user info on success.
     */
    private async authenticateAndFetchUserInfo(context: IActionContext, node?: TreeElement): Promise<void> {
        const authMethod = await promptAtlasAuthMethod();
        if (!authMethod) {
            return; // User cancelled
        }

        const success = await executeAtlasAuthFlow(authMethod, this.sessionManager);

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

            const client = new AtlasApiClient(session, this.sessionManager);
            const user = await client.getCurrentUser();
            const displayName = user.emailAddress || user.username || `${user.firstName} ${user.lastName}`.trim();
            await this.sessionManager.setUserDisplayName(displayName);
        } catch {
            // Non-critical — UI will fall back to "Atlas Account"
        }
    }
}
