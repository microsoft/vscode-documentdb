/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ComputeManagementClient } from '@azure/arm-compute'; // Modified import
import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { type NetworkManagementClient } from '@azure/arm-network'; // Add this import
import { type ResourceManagementClient } from '@azure/arm-resources';
import { createAzureClient, type AzExtClientContext } from '@microsoft/vscode-azext-azureutils';
import { createSubscriptionContext, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';

// Lazy-load @azure packages to improve startup performance.
// NOTE: The client is the only import that matters, the rest of the types disappear when compiled to JavaScript

export async function createResourceManagementClient(
    context: IActionContext,
    subscription: AzureSubscription,
): Promise<ResourceManagementClient> {
    const subContext = createSubscriptionContext(subscription);
    return createAzureClient([context, subContext], (await import('@azure/arm-resources')).ResourceManagementClient);
}

export async function createCosmosDBClient(context: AzExtClientContext): Promise<CosmosDBManagementClient> {
    return createAzureClient(context, (await import('@azure/arm-cosmosdb')).CosmosDBManagementClient);
}

export async function createCosmosDBManagementClient(
    context: IActionContext,
    subscription: AzureSubscription,
): Promise<CosmosDBManagementClient> {
    const subContext = createSubscriptionContext(subscription);
    return createAzureClient([context, subContext], (await import('@azure/arm-cosmosdb')).CosmosDBManagementClient);
}

export async function createMongoClustersManagementClient(
    context: IActionContext,
    subscription: AzureSubscription,
): Promise<CosmosDBManagementClient> {
    const subContext = createSubscriptionContext(subscription);
    return createAzureClient([context, subContext], (await import('@azure/arm-cosmosdb')).CosmosDBManagementClient);
}

export async function createComputeManagementClient(
    context: IActionContext,
    subscription: AzureSubscription,
): Promise<ComputeManagementClient> {
    const subContext = createSubscriptionContext(subscription);
    return createAzureClient([context, subContext], (await import('@azure/arm-compute')).ComputeManagementClient);
}

export async function createNetworkManagementClient(
    context: IActionContext,
    subscription: AzureSubscription,
): Promise<NetworkManagementClient> {
    const subContext = createSubscriptionContext(subscription);
    return createAzureClient([context, subContext], (await import('@azure/arm-network')).NetworkManagementClient);
}
