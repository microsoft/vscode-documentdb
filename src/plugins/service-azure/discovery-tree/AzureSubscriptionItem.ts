/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupFromId, uiUtils } from '@microsoft/vscode-azext-azureutils';
import { callWithTelemetryAndErrorHandling, nonNullProp, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { MongoClustersExperience } from '../../../AzureDBExperiences';
import { ext } from '../../../extensionVariables';
import { type TreeElement } from '../../../tree/TreeElement';
import { type TreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';
import { type ClusterModel } from '../../../tree/documentdb/ClusterModel';
import { createResourceManagementClient } from '../../../utils/azureClients';
import { DocumentDBResourceItem } from './documentdb/DocumentDBResourceItem';

export interface AzureSubscriptionModel {
    subscriptionName: string;
    subscription: AzureSubscription;
    subscriptionId: string;
}

export class AzureSubscriptionItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public contextValue: string = 'discovery.azureService';

    constructor(
        public readonly parentId: string,
        public readonly subscription: AzureSubscriptionModel,
    ) {
        this.id = `${parentId}/${subscription.subscriptionId}`;
    }

    async getChildren(): Promise<TreeElement[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
            const client = await createResourceManagementClient(context, this.subscription.subscription);

            const accounts = await uiUtils.listAllIterator(
                client.resources.list({ filter: "resourceType eq 'Microsoft.DocumentDB/mongoClusters'" }),
            );

            return accounts
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                .map((account) => {
                    const resourceId = nonNullProp(account, 'id');

                    const clusterInfo: ClusterModel = {
                        ...account,
                        resourceGroup: getResourceGroupFromId(resourceId),
                        dbExperience: MongoClustersExperience,
                    } as ClusterModel;

                    return new DocumentDBResourceItem(this.subscription.subscription, clusterInfo);
                });
        });
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.subscription.subscriptionName,
            tooltip: `Subscription ID: ${this.subscription.subscriptionId}`,
            iconPath: vscode.Uri.joinPath(
                ext.context.extensionUri,
                'node_modules',
                '@microsoft',
                'vscode-azext-azureutils',
                'resources',
                'azureSubscription.svg',
            ),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
