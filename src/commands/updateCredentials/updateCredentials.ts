/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import {
    AuthMethodId,
    authMethodFromString,
    authMethodsFromString,
    getAuthMethodFamily,
} from '../../documentdb/auth/AuthMethod';
import { evaluateEntraDestinationFromSettings } from '../../documentdb/auth/entraDestinationSettings';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { getRegisteredShellTerminals } from '../../documentdb/shell/ShellTerminalLinkProvider';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { Views } from '../../documentdb/Views';
import { SelectEntraTokenSourceStep } from '../../documentdb/wizards/authenticate/SelectEntraTokenSourceStep';
import { ext } from '../../extensionVariables';
import { ConnectionStorageService, isConnection } from '../../services/connectionStorageService';
import { type DocumentDBClusterItem } from '../../tree/connections-view/DocumentDBClusterItem';
import { resolveStorageZone } from '../../tree/connections-view/models/ConnectionClusterModel';
import { shutdownEvaluator } from '../playground/executePlaygroundCode';
import { refreshView } from '../refreshView/refreshView';
import { PromptAuthMethodStep } from '../updateCredentials/PromptAuthMethodStep';
import { ExecuteStep } from './ExecuteStep';
import { PromptPasswordStep } from './PromptPasswordStep';
import { PromptReconnectStepForErrorNodes } from './PromptReconnectStepForErrorNodes';
import { PromptTenantStep } from './PromptTenantStep';
import { PromptUserNameStep } from './PromptUserNameStep';
import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';

/**
 * Updates the authentication credentials for a cluster connection.
 *
 * Architecture:
 * 1. Loads stored credentials and determines available authentication methods
 * 2. Runs wizard to collect new credentials from user:
 *    - PromptAuthMethodStep: Select authentication method
 *    - SelectEntraTokenSourceStep: Select account sign-in or a managed identity (if needed)
 *    - PromptTenantStep: Enter tenant ID for account sign-in (if needed)
 *    - PromptUserNameStep: Enter username (if needed)
 *    - PromptPasswordStep: Enter password (if needed)
 *    - PromptReconnectStepForErrorNodes: Ask to reconnect (only for error nodes)
 * 3. ExecuteStep: Saves updated credentials to storage
 * 4. Post-wizard: Refreshes cached credentials, drops the client and playground worker,
 *    warns about open shells, and optionally resets error state for reconnection
 *
 * For error recovery nodes, prompts whether to reconnect immediately. If user chooses
 * not to reconnect, the error state is preserved and the node remains as an error node.
 */
export async function updateCredentials(context: IActionContext, node: DocumentDBClusterItem): Promise<void> {
    context.telemetry.properties.authFlowOrigin = 'updateCredentials';
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    // access credentials assigned to the selected cluster

    // Note to future maintainers: the node.cluster might be out of date
    // as the object is cached in the tree view, and in the 'retry/error' nodes
    // that's why we need to get the fresh one each time.
    const resourceType = resolveStorageZone(node.cluster);

    const storedItem = await ConnectionStorageService.get(node.storageId, resourceType);
    // Type guard ensures we have connection properties (not a folder)
    const connectionCredentials = storedItem && isConnection(storedItem) ? storedItem : undefined;
    const connectionString = connectionCredentials?.secrets?.connectionString || '';
    context.valuesToMask.push(connectionString);

    const entraDestinationAllowed = evaluateEntraDestinationFromSettings(connectionString).allowed;
    const supportedAuthMethods = authMethodsFromString(connectionCredentials?.properties.availableAuthMethods).filter(
        (method) => entraDestinationAllowed || getAuthMethodFamily(method) !== AuthMethodId.MicrosoftEntraID,
    );
    if (entraDestinationAllowed) {
        if (!supportedAuthMethods.includes(AuthMethodId.MicrosoftEntraID)) {
            supportedAuthMethods.push(AuthMethodId.MicrosoftEntraID);
        }
        if (!supportedAuthMethods.includes(AuthMethodId.ManagedIdentity)) {
            supportedAuthMethods.push(AuthMethodId.ManagedIdentity);
        }
        if (!supportedAuthMethods.includes(AuthMethodId.NativeAuth)) {
            supportedAuthMethods.push(AuthMethodId.NativeAuth);
        }
    }

    const isErrorState = node.id ? ext.connectionsBranchDataProvider.hasNodeErrorState(node.id) : false;

    context.telemetry.properties.calledFrom = isErrorState ? 'errorNode' : 'contextMenu';

    const selectedMethod = authMethodFromString(connectionCredentials?.properties.selectedAuthMethod);
    const wizardContext: UpdateCredentialsWizardContext = {
        ...context,
        connectionString,
        nativeAuthConfig: connectionCredentials?.secrets.nativeAuthConfig,
        entraIdAuthConfig: connectionCredentials?.secrets.entraIdAuthConfig,
        managedIdentityAuthConfig: connectionCredentials?.secrets.managedIdentityAuthConfig,
        availableAuthenticationMethods: authMethodsFromString(supportedAuthMethods),
        selectedAuthenticationMethod:
            selectedMethod &&
            (entraDestinationAllowed || getAuthMethodFamily(selectedMethod) !== AuthMethodId.MicrosoftEntraID)
                ? selectedMethod
                : undefined,
        isEmulator: Boolean(node.cluster.emulatorConfiguration?.isEmulator),
        storageZone: resolveStorageZone(node.cluster),
        storageId: node.storageId,
        isErrorState,
        reconnectAfterError: false,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Update cluster credentials'),
        promptSteps: [
            new PromptAuthMethodStep(),
            new SelectEntraTokenSourceStep<UpdateCredentialsWizardContext>(
                (wizardContext) => wizardContext.selectedAuthenticationMethod,
                (wizardContext, method) => {
                    wizardContext.selectedAuthenticationMethod = method;
                },
            ),
            new PromptTenantStep(),
            new PromptUserNameStep(),
            new PromptPasswordStep(),
            new PromptReconnectStepForErrorNodes(),
        ],
        executeSteps: [new ExecuteStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();

    await ClustersClient.deleteClient(node.cluster.clusterId);

    const updatedStoredItem = await ConnectionStorageService.get(node.storageId, resourceType);
    const updatedConnection = updatedStoredItem && isConnection(updatedStoredItem) ? updatedStoredItem : undefined;
    const authMethod = authMethodFromString(updatedConnection?.properties.selectedAuthMethod);
    const username = updatedConnection?.secrets.nativeAuthConfig?.connectionUser;
    const password = updatedConnection?.secrets.nativeAuthConfig?.connectionPassword;
    if (updatedConnection && authMethod && !(authMethod === AuthMethodId.NativeAuth && (!username || !password))) {
        const connectionString = new DocumentDBConnectionString(updatedConnection.secrets.connectionString);

        CredentialCache.setAuthCredentials(
            node.cluster.clusterId,
            authMethod,
            connectionString.toString(),
            username && password ? { connectionUser: username, connectionPassword: password } : undefined,
            node.cluster.emulatorConfiguration,
            updatedConnection.secrets.entraIdAuthConfig,
            updatedConnection.secrets.managedIdentityAuthConfig,
        );
    } else {
        // Clear stale credentials so the tree can prompt from storage.
        CredentialCache.deleteCredentials(node.cluster.clusterId);
    }

    shutdownEvaluator(node.cluster.clusterId);

    if (getRegisteredShellTerminals().some(({ info }) => info.clusterId === node.cluster.clusterId)) {
        void vscode.window.showInformationMessage(
            l10n.t(
                "Credentials updated. New connections will use them. Open shells for '{cluster}' keep their current connection until you close them.",
                { cluster: node.cluster.name },
            ),
            { modal: true },
        );
    }

    // When the node is in an error state, only clear it if the user chose to reconnect.
    // Clearing the error state triggers a fresh connection attempt on refresh.
    if (node.id && wizardContext.isErrorState) {
        if (wizardContext.reconnectAfterError) {
            ext.connectionsBranchDataProvider.resetNodeErrorState(node.id);
            context.telemetry.properties.reconnected = 'true';
        }
    }

    await refreshView(context, Views.ConnectionsView);
}
