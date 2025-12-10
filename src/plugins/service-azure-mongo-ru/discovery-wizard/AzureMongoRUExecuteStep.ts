/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupFromId } from '@microsoft/vscode-azext-azureutils';
import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';

import { type GenericResource } from '@azure/arm-resources';
import { type AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { AzureContextProperties } from '../../api-shared/azure/wizard/AzureContextProperties';
import { DISCOVERY_PROVIDER_ID } from '../config';
import { extractCredentialsFromRUAccount } from '../utils/ruClusterHelpers';

export class AzureMongoRUExecuteStep extends AzureWizardExecuteStep<NewConnectionWizardContext> {
    public priority: number = -1;

    public async execute(context: NewConnectionWizardContext): Promise<void> {
        if (context.properties[AzureContextProperties.SelectedSubscription] === undefined) {
            throw new Error('SelectedSubscription is not set.');
        }
        if (context.properties[AzureContextProperties.SelectedCluster] === undefined) {
            throw new Error('SelectedCluster is not set.');
        }

        context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;

        const subscription = context.properties[
            AzureContextProperties.SelectedSubscription
        ] as unknown as AzureSubscription;

        const cluster = context.properties[AzureContextProperties.SelectedCluster] as unknown as GenericResource;

        const resourceGroup = getResourceGroupFromId(cluster.id!);

        const credentials = await extractCredentialsFromRUAccount(context, subscription, resourceGroup, cluster.name!);

        context.connectionString = credentials.connectionString;
        context.nativeAuthConfig = credentials.nativeAuthConfig;
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
