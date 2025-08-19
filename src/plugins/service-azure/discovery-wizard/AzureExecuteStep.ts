/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';

import { type MongoCluster } from '@azure/arm-mongocluster';
import { type GenericResource } from '@azure/arm-resources';
import { type AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { getResourceGroupFromId } from '@microsoft/vscode-azext-azureutils';
import { l10n } from 'vscode';
import { isSupportedAuthMethod } from '../../../documentdb/auth/AuthMethod';
import { DocumentDBConnectionString } from '../../../documentdb/utils/DocumentDBConnectionString';
import { type ClusterCredentials } from '../../../tree/documentdb/ClusterItemBase';
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

        const subscription = context.properties[
            AzureContextProperties.SelectedSubscription
        ] as unknown as AzureSubscription;

        const cluster = context.properties[AzureContextProperties.SelectedCluster] as unknown as GenericResource;

        const clusterInformation = await this.getClusterInformation(cluster, subscription, context);
        const credentials = this.extractCredentials(context, clusterInformation);

        context.connectionString = credentials.connectionString;
        context.username = credentials.connectionUser;
        context.password = credentials.connectionPassword;
        context.availableAuthenticationMethods = credentials.availableAuthMethods;

        // clean-up
        context.properties[AzureContextProperties.SelectedSubscription] = undefined;
        context.properties[AzureContextProperties.SelectedCluster] = undefined;
        context.properties[AzureContextProperties.AzureSubscriptionProvider] = undefined;
    }

    /**
     * Extracts and processes credentials from cluster information.
     * @param context The action context for telemetry and masking.
     * @param clusterInformation The MongoCluster object containing cluster details.
     * @returns A ClusterCredentials object.
     */
    private extractCredentials(context: IActionContext, clusterInformation: MongoCluster): ClusterCredentials {
        // Ensure connection string and admin username are masked
        if (clusterInformation.properties?.connectionString) {
            context.valuesToMask.push(clusterInformation.properties.connectionString);
        }
        if (clusterInformation.properties?.administrator?.userName) {
            context.valuesToMask.push(clusterInformation.properties.administrator.userName);
        }

        // we need to sanitize the data sent from azure, it contains placeholders for the username and the password
        const parsedCS = new DocumentDBConnectionString(clusterInformation.properties!.connectionString!);
        parsedCS.username = '';
        parsedCS.password = '';

        // Prepare credentials object.
        const credentials: ClusterCredentials = {
            connectionString: parsedCS.toString(),
            connectionUser: clusterInformation.properties?.administrator?.userName,
            availableAuthMethods: [],
        };

        const allowedModes = clusterInformation.properties?.authConfig?.allowedModes ?? [];
        context.telemetry.properties.receivedAuthMethods = allowedModes.join(',');

        for (const method of allowedModes) {
            if (isSupportedAuthMethod(method)) {
                credentials.availableAuthMethods.push(method);
            } else {
                context.telemetry.properties.warning = 'unknown-authmethod';
                console.warn(`Unknown auth method from Azure SDK: ${method}`);
            }
        }

        return credentials;
    }

    /**
     * Retrieves and validates cluster information from Azure.
     */
    private async getClusterInformation(
        cluster: GenericResource,
        subscription: AzureSubscription,
        context: IActionContext,
    ): Promise<MongoCluster> {
        const managementClient = await createMongoClustersManagementClient(context, subscription);
        const clusterInformation = (await managementClient.mongoClusters.get(
            getResourceGroupFromId(cluster.id!),
            cluster.name!,
        )) as unknown as MongoCluster;

        // Validate connection string
        if (!clusterInformation.properties?.connectionString) {
            context.telemetry.properties.error = 'missing-connection-string';
            throw new Error(
                l10n.t('Authentication data (properties.connectionString) is missing for "{cluster}".', {
                    cluster: cluster.name!,
                }),
            );
        }

        // Validate auth configuration
        const clusterAuthConfig = clusterInformation.properties?.authConfig as { allowedModes?: string[] } | undefined;

        if (!clusterAuthConfig?.allowedModes) {
            context.telemetry.properties.error = 'missing-authconfig';
            throw new Error(
                l10n.t('Authentication configuration is missing for "{cluster}".', {
                    cluster: cluster.name,
                }),
            );
        }

        if (clusterAuthConfig.allowedModes.length === 0) {
            context.telemetry.properties.error = 'authconfig-no-authentication-methods';
            throw new Error(
                l10n.t('No authentication methods available for "{cluster}".', {
                    cluster: cluster.name,
                }),
            );
        }

        context.valuesToMask.push(clusterInformation.properties.connectionString);
        return clusterInformation;
    }

    public shouldExecute(): boolean {
        return true;
    }
}
