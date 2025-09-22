/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';

import { type GenericResource } from '@azure/arm-resources';
import { type AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { getResourceGroupFromId } from '@microsoft/vscode-azext-azureutils';
import { AzureContextProperties } from '../../api-shared/azure/wizard/AzureContextProperties';
import { extractCredentialsFromCluster, getClusterInformationFromAzure } from '../utils/clusterHelpers';

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

        const clusterInformation = await getClusterInformationFromAzure(
            context,
            subscription,
            getResourceGroupFromId(cluster.id!),
            cluster.name!,
        );

        const credentials = extractCredentialsFromCluster(context, clusterInformation, subscription);

        context.connectionString = credentials.connectionString;
        context.nativeAuth = credentials.nativeAuthConfig;
        context.entraIdAuth = credentials.entraIdConfig;
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
     * @returns An EphemeralClusterCredentials object for service discovery scenarios.
     */
    // getClusterInformation and extractCredentials moved to shared helpers

    public shouldExecute(): boolean {
        return true;
    }
}
