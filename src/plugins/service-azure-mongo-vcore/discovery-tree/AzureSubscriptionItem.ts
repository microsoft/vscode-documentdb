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
import { Views } from '../../../documentdb/Views';
import { ext } from '../../../extensionVariables';
import { type TreeElement } from '../../../tree/TreeElement';
import { type TreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';
import {
    type AzureClusterModel,
    sanitizeAzureResourceIdForTreeId,
} from '../../../tree/azure-views/models/AzureClusterModel';
import { type TreeCluster } from '../../../tree/models/BaseClusterModel';
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
        private readonly journeyCorrelationId: string,
    ) {
        this.id = `${parentId}/${subscription.subscriptionId}`;
    }

    async getChildren(): Promise<TreeElement[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling(
            'azure-discovery.getChildren',
            async (context: IActionContext) => {
                const startTime = Date.now();
                context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
                context.telemetry.properties.journeyCorrelationId = this.journeyCorrelationId;

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

                        // Sanitize Azure Resource ID: replace '/' with '_' for treeId
                        // This ensures treeId never contains '/' (simplifies path handling)
                        const sanitizedId = sanitizeAzureResourceIdForTreeId(resourceId);

                        // clusterId must be prefixed with provider ID for uniqueness across plugins
                        const prefixedClusterId = `${DISCOVERY_PROVIDER_ID}_${sanitizedId}`;

                        const clusterInfo: TreeCluster<AzureClusterModel> = {
                            // Core cluster data
                            name: account.name ?? 'Unknown',
                            connectionString: undefined, // Loaded lazily when connecting
                            dbExperience: DocumentDBExperience,
                            clusterId: prefixedClusterId, // Prefixed with provider ID for uniqueness
                            // Azure-specific data
                            azureResourceId: resourceId, // Keep original Azure Resource ID for ARM API correlation
                            resourceGroup: getResourceGroupFromId(resourceId),
                            // Tree context - treeId includes parent hierarchy for findNodeById to work
                            treeId: `${this.id}/${sanitizedId}`,
                            viewId: Views.DiscoveryView,
                        };

                        ext.outputChannel.trace(
                            `[DiscoveryView/vCore] Created cluster model: name="${clusterInfo.name}", clusterId="${clusterInfo.clusterId}", treeId="${clusterInfo.treeId}"`,
                        );

                        return new DocumentDBResourceItem(
                            this.journeyCorrelationId,
                            this.subscription.subscription,
                            clusterInfo,
                        );
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
