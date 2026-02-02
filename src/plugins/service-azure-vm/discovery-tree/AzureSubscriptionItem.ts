/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureTenant } from '@microsoft/vscode-azext-azureauth';
import { getResourceGroupFromId, uiUtils } from '@microsoft/vscode-azext-azureutils';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { DocumentDBConnectionString } from '../../../documentdb/utils/DocumentDBConnectionString';
import { Views } from '../../../documentdb/Views';
import { DocumentDBExperience } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { sanitizeAzureResourceIdForTreeId } from '../../../tree/azure-views/models/AzureClusterModel';
import { type TreeCluster } from '../../../tree/models/BaseClusterModel';
import { type TreeElement } from '../../../tree/TreeElement';
import { type TreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';
import { createComputeManagementClient, createNetworkManagementClient } from '../../../utils/azureClients';
import { DISCOVERY_PROVIDER_ID } from '../config';
import { AzureVMResourceItem, type VirtualMachineModel } from './vm/AzureVMResourceItem';

export interface AzureSubscriptionModel {
    subscriptionName: string;
    subscription: AzureSubscription;
    subscriptionId: string;
    tenant?: AzureTenant;
}

export class AzureSubscriptionItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public contextValue: string = 'enableRefreshCommand;discovery.azureVMService'; // Context value updated for VMs

    constructor(
        public readonly parentId: string,
        public readonly subscription: AzureSubscriptionModel,
        private readonly journeyCorrelationId: string,
    ) {
        this.id = `${parentId}/${subscription.subscriptionId}`;
    }

    async getChildren(): Promise<TreeElement[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling(
            'azure-vm-discovery.getChildren',
            async (context: IActionContext) => {
                const startTime = Date.now();
                context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
                context.telemetry.properties.view = Views.DiscoveryView;
                context.telemetry.properties.journeyCorrelationId = this.journeyCorrelationId;

                const computeClient = await createComputeManagementClient(context, this.subscription.subscription); // For listing VMs
                const networkClient = await createNetworkManagementClient(context, this.subscription.subscription); // For fetching IP addresses

                const tagName = ext.context.globalState.get<string>('azure-vm-discovery.tag', 'DocumentDB');

                const vms = await uiUtils.listAllIterator(computeClient.virtualMachines.listAll());
                const vmItems: AzureVMResourceItem[] = [];

                for (const vm of vms) {
                    if (vm.tags && vm.tags[tagName] !== undefined && vm.id && vm.name) {
                        let publicIpAddress: string | undefined;
                        let fqdn: string | undefined;

                        if (vm.networkProfile?.networkInterfaces) {
                            for (const nicRef of vm.networkProfile.networkInterfaces) {
                                if (nicRef.id) {
                                    const nicName = nicRef.id.substring(nicRef.id.lastIndexOf('/') + 1);
                                    const rgName = getResourceGroupFromId(nicRef.id);
                                    try {
                                        const nic = await networkClient.networkInterfaces.get(rgName, nicName);
                                        if (nic.ipConfigurations) {
                                            for (const ipConfig of nic.ipConfigurations) {
                                                if (ipConfig.publicIPAddress?.id) {
                                                    const pipName = ipConfig.publicIPAddress.id.substring(
                                                        ipConfig.publicIPAddress.id.lastIndexOf('/') + 1,
                                                    );
                                                    const pipRg = getResourceGroupFromId(ipConfig.publicIPAddress.id);
                                                    const publicIp = await networkClient.publicIPAddresses.get(
                                                        pipRg,
                                                        pipName,
                                                    );
                                                    if (publicIp.ipAddress) {
                                                        publicIpAddress = publicIp.ipAddress;
                                                    }
                                                    if (publicIp.dnsSettings?.fqdn) {
                                                        fqdn = publicIp.dnsSettings.fqdn;
                                                    }
                                                    if (publicIpAddress) break;
                                                }
                                            }
                                        }
                                    } catch (error) {
                                        // Log error or handle NIC/Public IP fetching error, e.g. if NIC/IP was deleted but VM still references it.
                                        context.telemetry.properties.fetchNicError = 'true';
                                        console.warn(`Error fetching NIC details for VM ${vm.name}: ${error}`);
                                    }
                                }
                                if (publicIpAddress) break;
                            }
                        }

                        const host = fqdn || publicIpAddress;

                        const connectionString = new DocumentDBConnectionString('mongodb://localhost:27017/'); // Placeholder host, will be replaced

                        connectionString.hosts = [host + ':27017']; // Set the actual host and default port
                        connectionString.protocol = 'mongodb';

                        // Sanitize Azure Resource ID: replace '/' with '_' for treeId
                        const sanitizedId = sanitizeAzureResourceIdForTreeId(vm.id!);

                        // clusterId must be prefixed with provider ID for uniqueness across plugins
                        const prefixedClusterId = `${DISCOVERY_PROVIDER_ID}_${sanitizedId}`;

                        const vmInfo: TreeCluster<VirtualMachineModel> = {
                            // Core cluster data
                            name: vm.name!,
                            connectionString: connectionString.toString(),
                            dbExperience: DocumentDBExperience,
                            clusterId: prefixedClusterId, // Prefixed with provider ID for uniqueness
                            // Azure-specific data
                            azureResourceId: vm.id!, // Keep original Azure Resource ID for ARM API correlation
                            resourceGroup: getResourceGroupFromId(vm.id!),
                            // VM-specific data
                            vmSize: vm.hardwareProfile?.vmSize,
                            publicIpAddress: publicIpAddress,
                            fqdn: fqdn,
                            // Tree context - treeId includes parent hierarchy for findNodeById to work
                            treeId: `${this.id}/${sanitizedId}`,
                            viewId: Views.DiscoveryView,
                        };

                        ext.outputChannel.trace(
                            `[DiscoveryView/VM] Created cluster model: name="${vmInfo.name}", clusterId="${vmInfo.clusterId}", treeId="${vmInfo.treeId}"`,
                        );

                        vmItems.push(
                            new AzureVMResourceItem(this.journeyCorrelationId, this.subscription.subscription, vmInfo),
                        );
                    }
                }

                // Add enhanced telemetry for discovery
                context.telemetry.measurements.discoveryResourcesCount = vmItems.length;
                context.telemetry.measurements.discoveryLoadTimeMs = Date.now() - startTime;

                return vmItems.sort((a, b) => a.cluster.name.localeCompare(b.cluster.name));
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
