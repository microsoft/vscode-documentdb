/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, nonNullValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import ConnectionString from 'mongodb-connection-string-url';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { Views } from '../../documentdb/Views';
import { type DocumentDBClusterItem } from '../../tree/connections-view/DocumentDBClusterItem';
import { refreshView } from '../refreshView/refreshView';
import { ExecuteStep } from './ExecuteStep';
import { PromptPasswordStep } from './PromptPasswordStep';
import { PromptUserNameStep } from './PromptUserNameStep';
import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';

export async function updateCredentials(context: IActionContext, node: DocumentDBClusterItem): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    // access credentials assigned to the selected cluster
    const connectionString = new ConnectionString(nonNullValue(node.cluster.connectionString));
    const username: string | undefined = connectionString.username;
    const password: string | undefined = connectionString.password;

    const wizardContext: UpdateCredentialsWizardContext = {
        ...context,
        username: username,
        password: password,
        isEmulator: Boolean(node.cluster.emulatorConfiguration?.isEmulator),
        storageId: node.id,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Update cluster credentials'),
        promptSteps: [new PromptUserNameStep(), new PromptPasswordStep()],
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
