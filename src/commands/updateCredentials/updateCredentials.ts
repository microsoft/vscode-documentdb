/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { AuthMethodId, authMethodFromString, authMethodsFromString } from '../../documentdb/auth/AuthMethod';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { AzureDomains, hasDomainSuffix } from '../../documentdb/utils/connectionStringHelpers';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { ext } from '../../extensionVariables';
import { ConnectionStorageService, ConnectionType, isConnection } from '../../services/connectionStorageService';
import { type DocumentDBClusterItem } from '../../tree/connections-view/DocumentDBClusterItem';
import { PromptAuthMethodStep } from '../updateCredentials/PromptAuthMethodStep';
import { ExecuteStep } from './ExecuteStep';
import { PromptPasswordStep } from './PromptPasswordStep';
import { PromptReconnectStep } from './PromptReconnectStep';
import { PromptTenantStep } from './PromptTenantStep';
import { PromptUserNameStep } from './PromptUserNameStep';
import { ReconnectStep } from './ReconnectStep';
import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';

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

    // Offer a reconnect option when either the user has an active session
    // (cached client) or the node is in an error state (e.g. triggered from the
    // error recovery node after a previous connection failure).
    const offerReconnect =
        ClustersClient.exists(node.cluster.clusterId) ||
        (node.id ? ext.connectionsBranchDataProvider.hasNodeErrorState(node.id) : false);

    const wizardContext: UpdateCredentialsWizardContext = {
        ...context,
        nativeAuthConfig: connectionCredentials?.secrets.nativeAuthConfig,
        entraIdAuthConfig: connectionCredentials?.secrets.entraIdAuthConfig,
        availableAuthenticationMethods: authMethodsFromString(supportedAuthMethods),
        selectedAuthenticationMethod: authMethodFromString(connectionCredentials?.properties.selectedAuthMethod),
        isEmulator: Boolean(node.cluster.emulatorConfiguration?.isEmulator),
        storageId: node.storageId,
        clusterId: node.cluster.clusterId,
        offerReconnect,
        shouldReconnect: false,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Update cluster credentials'),
        promptSteps: [
            new PromptAuthMethodStep(),
            new PromptTenantStep(),
            new PromptUserNameStep(),
            new PromptPasswordStep(),
            new PromptReconnectStep(),
        ],
        executeSteps: [new ExecuteStep(), new ReconnectStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();
}
