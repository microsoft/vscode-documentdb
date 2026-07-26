/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, type IWizardOptions, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { Disposable } from 'vscode';
import { type NewConnectionWizardContext } from '../../commands/newConnection/NewConnectionWizardContext';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { type DiscoveryProvider } from '../../services/discoveryServices';
import { type TreeElement } from '../../tree/TreeElement';
import { promptAtlasAuthMethod } from './auth/AtlasAuthQuickPick';
import { type AtlasSession, AtlasSessionState } from './auth/AtlasSession';
import { AtlasSessionManager } from './auth/AtlasSessionManager';
import { executeAtlasAuthFlow } from './auth/executeAtlasAuthFlow';
import { DESCRIPTION, DISCOVERY_PROVIDER_ID, ICON_PATH, LABEL, WIZARD_TITLE } from './config';
import { configureAtlasCredentials } from './credentialsManagement/configureAtlasCredentials';
import { AtlasServiceRootItem } from './discovery-tree/AtlasServiceRootItem';
import { AtlasExecuteStep } from './discovery-wizard/AtlasExecuteStep';
import { SelectAtlasClusterStep, SelectAtlasProjectStep } from './discovery-wizard/SelectAtlasSteps';
import { AtlasDiscoveryService } from './discovery/AtlasDiscoveryService';

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
    private readonly discoveryService = new AtlasDiscoveryService();

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
        return new AtlasServiceRootItem(this.discoveryService, parentId);
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

        const changed = await configureAtlasCredentials(context, this.discoveryService, this.sessionManager, node);

        if (changed) {
            // Reveal and expand the root so projects appear without a manual expand.
            void this.revealAtlasRoot();
        }
    }

    /**
     * Reveals and expands the Atlas root node in the discovery tree after a successful sign-in.
     * Non-critical — failures are logged but do not affect the sign-in outcome.
     */
    private async revealAtlasRoot(): Promise<void> {
        try {
            const rootId = `${Views.DiscoveryView}/${DISCOVERY_PROVIDER_ID}`;
            const rootItems = await ext.discoveryBranchDataProvider.getChildren(undefined as never);
            const atlasRoot = rootItems?.find((item) => item.id === rootId);
            if (!atlasRoot) {
                ext.outputChannel.warn('[AtlasDiscovery] Could not reveal Atlas root — root node not found.');
                return;
            }
            await ext.discoveryTreeView.reveal(atlasRoot, { select: false, focus: false, expand: true });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ext.outputChannel.warn(`[AtlasDiscovery] Could not reveal Atlas root: ${message}`);
        }
    }
}
