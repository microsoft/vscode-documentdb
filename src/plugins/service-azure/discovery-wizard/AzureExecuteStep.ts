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
import { DocumentDBConnectionString } from '../../../documentdb/utils/DocumentDBConnectionString';
import { Views } from '../../../documentdb/Views';
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

        context.valuesToMask.push(connectionString);
        context.connectionString = connectionString;

        // clean-up
        context.properties[AzureContextProperties.SelectedSubscription] = undefined;
        context.properties[AzureContextProperties.SelectedCluster] = undefined;
        context.properties[AzureContextProperties.AzureSubscriptionProvider] = undefined;
    }

    async getConnectionString(wizardContext: NewConnectionWizardContext): Promise<string | undefined> {
        return callWithTelemetryAndErrorHandling('getConnectionString', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.DiscoveryView;
            context.telemetry.properties.discoveryProvider = 'azure-discovery';

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

            if (!clusterInformation.properties?.connectionString) {
                return undefined;
            }

            context.valuesToMask.push(clusterInformation.properties?.connectionString);
            const connectionString = new DocumentDBConnectionString(
                clusterInformation.properties?.connectionString as string,
            );

            if (clusterInformation.properties?.administrator?.userName) {
                context.valuesToMask.push(clusterInformation.properties?.administrator?.userName);
                connectionString.username = clusterInformation.properties?.administrator?.userName;
            }

            /**
             * The connection string returned from Azure does not include the actual password.
             * Instead, it contains a placeholder. We explicitly set the password to an empty string here.
             */
            connectionString.password = '';

            return connectionString.toString();
        });
    }

    public shouldExecute(): boolean {
        return true;
    }
}
