/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import {
    AuthMethodId,
    authMethodFromString,
    authMethodsFromString,
    getAuthMethodFamily,
} from '../../documentdb/auth/AuthMethod';
import { evaluateEntraDestinationFromSettings } from '../../documentdb/auth/entraDestinationSettings';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { Views } from '../../documentdb/Views';
import { SelectEntraTokenSourceStep } from '../../documentdb/wizards/authenticate/SelectEntraTokenSourceStep';
import { ext } from '../../extensionVariables';
import { ConnectionStorageService, isConnection } from '../../services/connectionStorageService';
import { type DocumentDBClusterItem } from '../../tree/connections-view/DocumentDBClusterItem';
import { resolveStorageZone } from '../../tree/connections-view/models/ConnectionClusterModel';
import { refreshView } from '../refreshView/refreshView';
import { offerShellDisconnect, saveConnectionEdit } from '../saveConnectionEdit';
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
    const clusterId = node.cluster.clusterId;
    const epoch = ClustersClient.getEpoch(clusterId);
    const recoveringRejection = ClustersClient.getLatchReason(clusterId) === 'credentialsRejected';
    const isRecoveryCurrent = recoveringRejection
        ? (): boolean => ClustersClient.getEpoch(clusterId) === epoch
        : undefined;
    // The failed attempt these credentials replace; the reconnect's `connect.startup` names it in
    // `previousFailedStartupCorrelationId`, so it shows whether the new credentials worked.
    const failedStartupCorrelationId = ClustersClient.getLastFailedStartupCorrelationId(node.cluster.clusterId);
    if (failedStartupCorrelationId) {
        context.telemetry.properties.failedStartupCorrelationId = failedStartupCorrelationId;
    }

    // access credentials assigned to the selected cluster

    // Note to future maintainers: the node.cluster might be out of date
    // as the object is cached in the tree view, and in the 'retry/error' nodes
    // that's why we need to get the fresh one each time.
    const resourceType = resolveStorageZone(node.cluster);

    const storedItem = await ConnectionStorageService.get(node.storageId, resourceType);
    if (isRecoveryCurrent?.() === false) {
        return;
    }
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
        isRecoveryCurrent,
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
    if (isRecoveryCurrent?.() === false) {
        return;
    }
    const changed = await saveConnectionEdit(
        node,
        async (isCurrent) => {
            wizardContext.isRecoveryCurrent = isCurrent;
            await wizard.execute();
            return wizardContext.credentialsSaved === true;
        },
        {
            canStart: isRecoveryCurrent,
            publishCredentials: (updated): void => {
                if (!updated || !isConnection(updated)) {
                    return;
                }
                const authMethod = authMethodFromString(updated.properties.selectedAuthMethod);
                const native = updated.secrets.nativeAuthConfig;
                if (
                    !authMethod ||
                    (authMethod === AuthMethodId.NativeAuth && (!native?.connectionUser || !native.connectionPassword))
                ) {
                    return;
                }
                CredentialCache.setAuthCredentials(
                    clusterId,
                    authMethod,
                    new DocumentDBConnectionString(updated.secrets.connectionString).toString(),
                    native?.connectionUser && native.connectionPassword ? native : undefined,
                    node.cluster.emulatorConfiguration,
                    updated.secrets.entraIdAuthConfig,
                    updated.secrets.managedIdentityAuthConfig,
                );
            },
        },
    );

    // When the node is in an error state, only clear it if the user chose to reconnect.
    // Clearing the error state triggers a fresh connection attempt on refresh.
    if (changed && wizardContext.credentialsSaved && node.id && wizardContext.isErrorState) {
        if (wizardContext.reconnectAfterError) {
            ext.connectionsBranchDataProvider.resetNodeErrorState(node.id);
            context.telemetry.properties.reconnected = 'true';
        }
    }

    await refreshView(context, Views.ConnectionsView);
    if (changed) {
        await offerShellDisconnect(node);
    }
}
