/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { AuthMethodId, authMethodFromString, authMethodsFromString } from '../../documentdb/auth/AuthMethod';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { AzureDomains, hasDomainSuffix } from '../../documentdb/utils/connectionStringHelpers';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { ConnectionStorageService, ConnectionType, isConnection } from '../../services/connectionStorageService';
import { type DocumentDBClusterItem } from '../../tree/connections-view/DocumentDBClusterItem';
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
 *    - PromptTenantStep: Enter tenant ID (if needed)
 *    - PromptUserNameStep: Enter username (if needed)
 *    - PromptPasswordStep: Enter password (if needed)
 *    - PromptReconnectStepForErrorNodes: Ask to reconnect (only for error nodes)
 * 3. ExecuteStep: Saves updated credentials to storage
 * 4. Post-wizard: Clears cache and optionally resets error state for reconnection
 *
 * For error recovery nodes, prompts whether to reconnect immediately. If user chooses
 * not to reconnect, the error state is preserved and the node remains as an error node.
 */
export async function updateCredentials(context: IActionContext, node: DocumentDBClusterItem): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    // access credentials assigned to the selected cluster

    // Note to future maintainers: the node.cluster might be out of date
    // as the object is cached in the tree view, and in the 'retry/error' nodes
    // that's why we need to get the fresh one each time.
    const resourceType = node.cluster.emulatorConfiguration?.isEmulator
        ? ConnectionType.Emulators
        : ConnectionType.Clusters;

    const storedItem = await ConnectionStorageService.get(node.storageId, resourceType);
    // Type guard ensures we have connection properties (not a folder)
    const connectionCredentials = storedItem && isConnection(storedItem) ? storedItem : undefined;
    const connectionString = connectionCredentials?.secrets?.connectionString || '';
    context.valuesToMask.push(connectionString);

    const parsedCS = new DocumentDBConnectionString(connectionCredentials?.secrets.connectionString ?? '');
    const supportedAuthMethods = [...(connectionCredentials?.properties.availableAuthMethods ?? [])];

    if (hasDomainSuffix(AzureDomains.vCore, ...parsedCS.hosts)) {
        if (!supportedAuthMethods.includes(AuthMethodId.MicrosoftEntraID)) {
            supportedAuthMethods.push(AuthMethodId.MicrosoftEntraID);
        }
        if (!supportedAuthMethods.includes(AuthMethodId.NativeAuth)) {
            supportedAuthMethods.push(AuthMethodId.NativeAuth);
        }
    }

    const isErrorState = node.id ? ext.connectionsBranchDataProvider.hasNodeErrorState(node.id) : false;

    const wizardContext: UpdateCredentialsWizardContext = {
        ...context,
        nativeAuthConfig: connectionCredentials?.secrets.nativeAuthConfig,
        entraIdAuthConfig: connectionCredentials?.secrets.entraIdAuthConfig,
        availableAuthenticationMethods: authMethodsFromString(supportedAuthMethods),
        selectedAuthenticationMethod: authMethodFromString(connectionCredentials?.properties.selectedAuthMethod),
        isEmulator: Boolean(node.cluster.emulatorConfiguration?.isEmulator),
        storageId: node.storageId,
        isErrorState,
        reconnectAfterError: false,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Update cluster credentials'),
        promptSteps: [
            new PromptAuthMethodStep(),
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

    // Invalidate cached client/credentials so the tree picks up the new values.
    await ClustersClient.deleteClient(node.cluster.clusterId);
    CredentialCache.deleteCredentials(node.cluster.clusterId);

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
