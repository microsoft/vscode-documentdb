/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzureWizardExecuteStep,
    callWithTelemetryAndErrorHandling,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';

import { type GenericResource } from '@azure/arm-resources';
import { type AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { getResourceGroupFromId } from '@microsoft/vscode-azext-azureutils';
import ConnectionString from 'mongodb-connection-string-url';
import { createMongoClustersManagementClient } from '../../../utils/azureClients';
import { AzureContextProperties } from '../AzureDiscoveryProvider';

export class AzureExecuteStep extends AzureWizardExecuteStep<NewConnectionWizardContext> {
    public priority: number = -1;

    public async execute(context: NewConnectionWizardContext): Promise<void> {
        if (context.properties[AzureContextProperties.SelectedSubscription] === undefined) {
            throw new Error('SelectedSubscription is not set.');
        }
        if (context.properties[AzureContextProperties.SelectedCluster] === undefined) {
            throw new Error('SelectedCluster is not set.');
        }

        const connectionString = await this.getConnectionString(context);
        if (!connectionString) {
            throw new Error('Failed to discover the connection string.');
        }

        context.connectionString = connectionString;
    }

    async getConnectionString(wizardContext: NewConnectionWizardContext): Promise<string | undefined> {
        return callWithTelemetryAndErrorHandling(
            'cosmosDB.mongoClusters.getConnectionString',
            async (context: IActionContext) => {
                const subscription = wizardContext.properties[
                    AzureContextProperties.SelectedSubscription
                ] as unknown as AzureSubscription;
                const cluster = wizardContext.properties[
                    AzureContextProperties.SelectedCluster
                ] as unknown as GenericResource;

                // Create a client to interact with the MongoDB vCore management API and read the cluster details
                const managementClient = await createMongoClustersManagementClient(context, subscription);

                const clusterInformation = await managementClient.mongoClusters.get(
                    getResourceGroupFromId(cluster.id!),
                    cluster.name!,
                );

                if (!clusterInformation.connectionString) {
                    return undefined;
                }

                context.valuesToMask.push(clusterInformation.connectionString);
                const connectionString = new ConnectionString(clusterInformation.connectionString as string);

                if (clusterInformation.administratorLogin) {
                    context.valuesToMask.push(clusterInformation.administratorLogin);
                    connectionString.username = clusterInformation.administratorLogin;
                }

                connectionString.password = '';

                return connectionString.toString();
            },
        );
    }

    public shouldExecute(): boolean {
        return true;
    }
}
