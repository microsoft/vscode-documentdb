/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ComputeManagementClient } from '@azure/arm-compute';
import { type NetworkManagementClient } from '@azure/arm-network';
import { uiUtils } from '@microsoft/vscode-azext-azureutils';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { type TreeElement } from '../../../tree/TreeElement';
import { type TreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';
import { createComputeManagementClient, createNetworkManagementClient } from '../../../utils/azureClients';
import { AzureVMResourceItem } from './vm/AzureVMResourceItem';

export interface AzureSubscriptionModel {
    subscriptionName: string;
    subscription: AzureSubscription;
    subscriptionId: string;
}

export class AzureSubscriptionItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public contextValue: string = 'enableRefreshCommand;discovery.azureVMService'; // Context value updated for VMs

    constructor(
        public readonly parentId: string,
        public readonly subscription: AzureSubscriptionModel,
    ) {
        this.id = `${parentId}/${subscription.subscriptionId}`;
    }

    async getChildren(): Promise<TreeElement[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling('getChildren.azureVM', async (context: IActionContext) => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const computeClient: ComputeManagementClient = (await createComputeManagementClient(
                context,
                this.subscription.subscription,
            )) as unknown as ComputeManagementClient;

            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const networkClient: NetworkManagementClient = (await createNetworkManagementClient(
                context,
                this.subscription.subscription,
            )) as unknown as NetworkManagementClient; // For fetching IP addresses

            // Get the tag from fallback storage to filter VMs in the tree
            // This assumes the tree should reflect the last used tag in the wizard for consistency
            const tagName = ext.context.globalState.get<string>('azureVmDiscoveryTag', 'DocumentDB');

            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            const vms = await uiUtils.listAllIterator(computeClient.virtualMachines.listAll());
            const vmItems: AzureVMResourceItem[] = [];

            for (const vm of vms) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
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

                    // The connection string template is created here because the tree item needs it directly.
                    // In a real scenario, this might be slightly different if the wizard is the sole source of truth for new connections.
                    const host = fqdn || publicIpAddress;
                    let connectionStringTemplate = `mongodb://<YOUR_USERNAME>@\${host || '<UNKNOWN_HOST>'}:27017/`;
                    if (!host) {
                        // If no host, the template is less useful but good to have a placeholder
                        connectionStringTemplate = 'mongodb://<YOUR_USERNAME>@<NO_PUBLIC_CONNECTIVITY>:27017/';
                    }

                    const vmInfo: VirtualMachineModel = {
                        id: vm.id!,
                        name: vm.name!,
                        resourceGroup: getResourceGroupFromId(vm.id!),
                        connectionStringTemplate: connectionStringTemplate,
                        vmSize: vm.hardwareProfile?.vmSize,
                        publicIpAddress: publicIpAddress,
                        fqdn: fqdn,
                    };
                    vmItems.push(new AzureVMResourceItem(this.subscription.subscription, vmInfo));
                }
            }
            return vmItems.sort((a, b) => a.vmModel.name.localeCompare(b.vmModel.name));
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
