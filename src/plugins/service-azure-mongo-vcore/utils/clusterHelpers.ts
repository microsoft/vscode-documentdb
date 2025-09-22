/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MongoCluster } from '@azure/arm-mongocluster';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { l10n } from 'vscode';
import { AuthMethodId, isSupportedAuthMethod } from '../../../documentdb/auth/AuthMethod';
import { DocumentDBConnectionString } from '../../../documentdb/utils/DocumentDBConnectionString';
import { type EphemeralClusterCredentials } from '../../../tree/documentdb/ClusterItemBase';
import { createMongoClustersManagementClient } from '../../../utils/azureClients';

/**
 * Retrieve and validate cluster information from Azure for the provided subscription/resource group/cluster name.
 */
export async function getClusterInformationFromAzure(
    context: IActionContext,
    subscription: AzureSubscription,
    resourceGroup: string,
    clusterName: string,
): Promise<MongoCluster> {
    // subscription comes from different azure packages in callers; cast here intentionally
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    const managementClient = await createMongoClustersManagementClient(context, subscription as any);
    const clusterInformation = (await managementClient.mongoClusters.get(
        resourceGroup,
        clusterName,
    )) as unknown as MongoCluster;

    // Validate connection string
    if (!clusterInformation.properties?.connectionString) {
        context.telemetry.properties.error = 'missing-connection-string';
        throw new Error(
            l10n.t('Authentication data (properties.connectionString) is missing for "{cluster}".', {
                cluster: clusterName,
            }),
        );
    }

    // Validate auth configuration
    const clusterAuthConfig = clusterInformation.properties?.authConfig as { allowedModes?: string[] } | undefined;

    if (!clusterAuthConfig?.allowedModes) {
        context.telemetry.properties.error = 'missing-authconfig';
        throw new Error(
            l10n.t('Authentication configuration is missing for "{cluster}".', {
                cluster: clusterName,
            }),
        );
    }

    if (clusterAuthConfig.allowedModes.length === 0) {
        context.telemetry.properties.error = 'authconfig-no-authentication-methods';
        throw new Error(
            l10n.t('No authentication methods available for "{cluster}".', {
                cluster: clusterName,
            }),
        );
    }

    context.valuesToMask.push(clusterInformation.properties.connectionString);
    return clusterInformation;
}

/**
 * Extract and sanitize credentials from a MongoCluster object returned by Azure.
 */
export function extractCredentialsFromCluster(
    context: IActionContext,
    clusterInformation: MongoCluster,
    subscription: AzureSubscription,
): EphemeralClusterCredentials {
    // Ensure connection string and admin username are masked
    if (clusterInformation.properties?.connectionString) {
        context.valuesToMask.push(clusterInformation.properties.connectionString);
    }
    if (clusterInformation.properties?.administrator?.userName) {
        context.valuesToMask.push(clusterInformation.properties.administrator.userName);
    }

    // Sanitize connection string returned from Azure (contains placeholders)
    const parsedCS = new DocumentDBConnectionString(clusterInformation.properties!.connectionString!);
    parsedCS.username = '';
    parsedCS.password = '';

    // Prepare credentials object.
    const credentials: EphemeralClusterCredentials = {
        connectionString: parsedCS.toString(),
        availableAuthMethods: [],
        // Auth configs - populate native auth if we have username
        nativeAuthConfig: clusterInformation.properties?.administrator?.userName
            ? {
                  connectionUser: clusterInformation.properties.administrator.userName,
                  connectionPassword: '', // Password will be collected during authentication
              }
            : undefined,
    };

    const allowedModes = clusterInformation.properties?.authConfig?.allowedModes ?? [];
    context.telemetry.properties.receivedAuthMethods = allowedModes.join(',');
    context.telemetry.properties.receivedAuthMethodsCount = allowedModes.length.toString();

    credentials.availableAuthMethods = allowedModes.filter(isSupportedAuthMethod);

    const unknownMethodIds = allowedModes.filter((methodId) => !isSupportedAuthMethod(methodId));
    context.telemetry.properties.unknownAuthMethods = unknownMethodIds.join(',');

    if (credentials.availableAuthMethods.includes(AuthMethodId.MicrosoftEntraID)) {
        credentials.entraIdConfig = {
            tenantId: subscription.tenantId,
            subscriptionId: subscription.subscriptionId,
        };
    }

    // Add telemetry properties from subscription
    context.telemetry.properties.isCustomCloud = subscription.isCustomCloud.toString();

    return credentials;
}
