/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupFromId } from '@microsoft/vscode-azext-azureutils';
import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';

import { type GenericResource } from '@azure/arm-resources';
import { type AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { AzureContextProperties } from '../../service-azure/AzureDiscoveryProvider';
import { extractCredentialsFromRUAccount, getRUClusterInformationFromAzure } from '../utils/ruClusterHelpers';

export class AzureMongoRUExecuteStep extends AzureWizardExecuteStep<NewConnectionWizardContext> {
    public priority: number = -1;

    public async execute(context: NewConnectionWizardContext): Promise<void> {
        if (context.properties[AzureContextProperties.SelectedSubscription] === undefined) {
            throw new Error('SelectedSubscription is not set.');
        }
        if (context.properties[AzureContextProperties.SelectedCluster] === undefined) {
            throw new Error('SelectedCluster is not set.');
        }

        context.telemetry.properties.discoveryProvider = 'azure-mongo-ru-discovery';

        const subscription = context.properties[
            AzureContextProperties.SelectedSubscription
        ] as unknown as AzureSubscription;

        const cluster = context.properties[AzureContextProperties.SelectedCluster] as unknown as GenericResource;

        const resourceGroup = getResourceGroupFromId(cluster.id!);
        
        const accountInformation = await getRUClusterInformationFromAzure(
            context,
            subscription,
            resourceGroup,
            cluster.name!,
        );

        const credentials = await extractCredentialsFromRUAccount(context, accountInformation);

        context.connectionString = credentials.connectionString;
        context.username = credentials.connectionUser;
        context.password = credentials.connectionPassword;
        context.availableAuthenticationMethods = credentials.availableAuthMethods;

        // clean-up
        context.properties[AzureContextProperties.SelectedSubscription] = undefined;
        context.properties[AzureContextProperties.SelectedCluster] = undefined;
        context.properties[AzureContextProperties.AzureSubscriptionProvider] = undefined;
    }

    public shouldExecute(): boolean {
        return true;
    }
}