/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { getClusterInformationFromAzure } from '../plugins/service-azure-mongo-vcore/utils/clusterHelpers';
import { createCosmosDBManagementClient } from '../utils/azureClients';

export interface AzureResourceReadRequest {
    readonly kind: 'vcore' | 'ru';
    readonly resourceGroup: string;
    readonly name: string;
}

/** Reads the resource from ARM. Returns the name as ARM returns it (the casing the tree shows). */
export async function readAzureResource(
    context: IActionContext,
    subscription: AzureSubscription,
    request: AzureResourceReadRequest,
): Promise<{ readonly name: string }> {
    try {
        if (request.kind === 'vcore') {
            const cluster = await getClusterInformationFromAzure(
                context,
                subscription,
                request.resourceGroup,
                request.name,
            );
            return { name: cluster.name || request.name };
        }

        const client = await createCosmosDBManagementClient(context, subscription);
        const account = await client.databaseAccounts.get(request.resourceGroup, request.name);
        if (account.kind?.toLowerCase() !== 'mongodb') {
            throw new Error(vscode.l10n.t('This Azure Cosmos DB account does not use the MongoDB API.'));
        }
        return { name: account.name || request.name };
    } catch (error: unknown) {
        if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
            if (error.code === 'ResourceNotFound' || error.code === 'ResourceGroupNotFound') {
                throw new Error(
                    vscode.l10n.t(
                        'The Azure resource {0} was not found in subscription {1}.',
                        request.name,
                        subscription.name,
                    ),
                );
            }
            if (error.code === 'AuthorizationFailed') {
                throw new Error(vscode.l10n.t('Your Azure account cannot read the Azure resource {0}.', request.name));
            }
        }
        throw error;
    }
}
