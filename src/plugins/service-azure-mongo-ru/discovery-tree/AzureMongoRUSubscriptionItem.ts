/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureTenant } from '@microsoft/vscode-azext-azureauth';
import { getResourceGroupFromId, uiUtils } from '@microsoft/vscode-azext-azureutils';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { CosmosDBMongoRUExperience } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { type TreeElement } from '../../../tree/TreeElement';
import { type TreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';
import { type ClusterModel } from '../../../tree/documentdb/ClusterModel';
import { createCosmosDBManagementClient } from '../../../utils/azureClients';
import { nonNullProp } from '../../../utils/nonNull';
import { MongoRUResourceItem } from './documentdb/MongoRUResourceItem';

export interface AzureSubscriptionModel {
    subscriptionName: string;
    subscription: AzureSubscription;
    subscriptionId: string;
    tenant?: AzureTenant;
}

export class AzureMongoRUSubscriptionItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public contextValue: string = 'enableRefreshCommand;azureMongoRUSubscription';

    constructor(
        public readonly parentId: string,
        public readonly subscription: AzureSubscriptionModel,
    ) {
        this.id = `${parentId}/${subscription.subscriptionId}`;
    }

    async getChildren(): Promise<TreeElement[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling(
            'azure-mongo-ru-discovery.getChildren',
            async (context: IActionContext) => {
                context.telemetry.properties.discoveryProvider = 'azure-mongo-ru-discovery';

                const managementClient = await createCosmosDBManagementClient(context, this.subscription.subscription);
                const allAccounts = await uiUtils.listAllIterator(managementClient.databaseAccounts.list());
                const accounts = allAccounts.filter((account) => account.kind === 'MongoDB');

                return accounts
                    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                    .map((account) => {
                        const resourceId = nonNullProp(account, 'id', 'account.id', 'AzureMongoRUSubscriptionItem.ts');

                        const clusterInfo: ClusterModel = {
                            ...account,
                            resourceGroup: getResourceGroupFromId(resourceId),
                            dbExperience: CosmosDBMongoRUExperience,
                        } as ClusterModel;

                        return new MongoRUResourceItem(this.subscription.subscription, clusterInfo);
                    });
            },
        );
    }

    public getTreeItem(): vscode.TreeItem {
        const tooltipParts: string[] = [vscode.l10n.t('Subscription ID: {0}', this.subscription.subscriptionId), ''];

        const tenantName = this.subscription.tenant?.displayName;
        if (tenantName) {
            tooltipParts.push(vscode.l10n.t('Tenant Name: {0}', tenantName));
        }

        const tenantId = this.subscription.subscription.tenantId;
        if (tenantId) {
            tooltipParts.push(vscode.l10n.t('Tenant ID: {0}', tenantId));
        }

        const tooltip: string = tooltipParts.join('\n');

        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.subscription.subscriptionName,
            tooltip,
            iconPath: vscode.Uri.joinPath(
                ext.context.extensionUri,
                'resources',
                'from_node_modules',
                '@microsoft',
                'vscode-azext-azureutils',
                'resources',
                'azureSubscription.svg',
            ),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
