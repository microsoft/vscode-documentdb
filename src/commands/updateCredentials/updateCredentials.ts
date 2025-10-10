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
import { ConnectionStorageService, ConnectionType } from '../../services/connectionStorageService';
import { type DocumentDBClusterItem } from '../../tree/connections-view/DocumentDBClusterItem';
import { refreshView } from '../refreshView/refreshView';
import { PromptAuthMethodStep } from '../updateCredentials/PromptAuthMethodStep';
import { ExecuteStep } from './ExecuteStep';
import { PromptPasswordStep } from './PromptPasswordStep';
import { PromptTenantStep } from './PromptTenantStep';
import { PromptUserNameStep } from './PromptUserNameStep';
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

    const connectionCredentials = await ConnectionStorageService.get(node.storageId, resourceType);
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

    const wizardContext: UpdateCredentialsWizardContext = {
        ...context,
        nativeAuthConfig: connectionCredentials?.secrets.nativeAuthConfig,
        entraIdAuthConfig: connectionCredentials?.secrets.entraIdAuthConfig,
        availableAuthenticationMethods: authMethodsFromString(supportedAuthMethods),
        selectedAuthenticationMethod: authMethodFromString(connectionCredentials?.properties.selectedAuthMethod),
        isEmulator: Boolean(node.cluster.emulatorConfiguration?.isEmulator),
        storageId: node.storageId,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Update cluster credentials'),
        promptSteps: [
            new PromptAuthMethodStep(),
            new PromptTenantStep(),
            new PromptUserNameStep(),
            new PromptPasswordStep(),
        ],
        executeSteps: [new ExecuteStep()],
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();

    /**
     * TODO: This is a temporary solution to refresh the view after updating the credentials.
     *
     * To be honest, this should not be needed. It happens now because the credentials
     * are updated in the storage, but the view is not refreshed. And the node caches
     * the connection string.
     *
     * The better solution would be, in general, to not cache the connection string at all.
     * And only access it from the storage when needed. This would be a better and more
     * secure solution.
     *
     * On top, the existing connection should be closed and a new one should be created.
     * Imagine that the username is changed so the permissions would change but noone notices.
     * That's why the connection has to be closed and a new one created.
     * And what about tabs opened with the old connection? They should be closed too.
     * This is a bigger change and should be done in a separate PR.
     * So for now, we just refresh the view to make sure the new credentials are used.
     */
    await ClustersClient.deleteClient(node.cluster.id);
    CredentialCache.deleteCredentials(node.cluster.id);
    await refreshView(context, Views.ConnectionsView);
}
