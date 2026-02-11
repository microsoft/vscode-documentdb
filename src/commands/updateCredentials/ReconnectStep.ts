/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { ext } from '../../extensionVariables';
import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';

export class ReconnectStep extends AzureWizardExecuteStep<UpdateCredentialsWizardContext> {
    public priority: number = 200;

    public async execute(context: UpdateCredentialsWizardContext): Promise<void> {
        await ClustersClient.deleteClient(context.clusterId);
        CredentialCache.deleteCredentials(context.clusterId);
        ext.connectionsBranchDataProvider.refresh();

        context.telemetry.properties.reconnected = 'true';
    }

    public shouldExecute(context: UpdateCredentialsWizardContext): boolean {
        return context.shouldReconnect;
    }
}
