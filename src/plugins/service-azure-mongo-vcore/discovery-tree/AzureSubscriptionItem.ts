/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureTenant } from '@microsoft/vscode-azext-azureauth';
import { getResourceGroupFromId, uiUtils } from '@microsoft/vscode-azext-azureutils';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { DocumentDBExperience } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { type TreeElement } from '../../../tree/TreeElement';
import { type TreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';
import { type ClusterModel } from '../../../tree/documentdb/ClusterModel';
import { createResourceManagementClient } from '../../../utils/azureClients';
import { nonNullProp } from '../../../utils/nonNull';
import { DISCOVERY_PROVIDER_ID } from '../config';
import { DocumentDBResourceItem } from './documentdb/DocumentDBResourceItem';

export interface AzureSubscriptionModel {
    subscriptionName: string;
    subscription: AzureSubscription;
    subscriptionId: string;
    tenant?: AzureTenant;
}

export class AzureSubscriptionItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public contextValue: string = 'enableRefreshCommand;discovery.azureService';

    constructor(
        public readonly parentId: string,
        public readonly subscription: AzureSubscriptionModel,
    ) {
        this.id = `${parentId}/${subscription.subscriptionId}`;
    }

    async getChildren(): Promise<TreeElement[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling(
            'azure-discovery.getChildren',
            async (context: IActionContext) => {
                const startTime = Date.now();
                context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;

                const client = await createResourceManagementClient(context, this.subscription.subscription);

                const accounts = await uiUtils.listAllIterator(
                    client.resources.list({ filter: "resourceType eq 'Microsoft.DocumentDB/mongoClusters'" }),
                );

                // Add enhanced telemetry for discovery
                context.telemetry.measurements.discoveryResourcesCount = accounts.length;
                context.telemetry.measurements.discoveryLoadTimeMs = Date.now() - startTime;

                return accounts
                    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                    .map((account) => {
                        const resourceId = nonNullProp(account, 'id', 'account.id', 'AzureSubscriptionItem.ts');

                        const clusterInfo: ClusterModel = {
                            ...account,
                            resourceGroup: getResourceGroupFromId(resourceId),
                            dbExperience: DocumentDBExperience,
                        } as ClusterModel;

                        return new DocumentDBResourceItem(this.subscription.subscription, clusterInfo);
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
