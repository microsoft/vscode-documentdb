/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ComputeManagementClient, type VirtualMachine } from '@azure/arm-compute';
import { type NetworkManagementClient } from '@azure/arm-network'; // Added NetworkManagementClient type
import { getResourceGroupFromId, uiUtils } from '@microsoft/vscode-azext-azureutils';
import { AzureWizardPromptStep, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { ThemeIcon } from 'vscode';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';
import { createComputeManagementClient, createNetworkManagementClient } from '../../../utils/azureClients';
import { AzureVMContextProperties } from '../AzureVMDiscoveryProvider';

export class SelectVMStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    iconPath = new ThemeIcon('vm'); // Using a generic VM icon

    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        if (context.properties[AzureVMContextProperties.SelectedSubscription] === undefined) {
            throw new Error('SelectedSubscription is not set.');
        }
        if (context.properties[AzureVMContextProperties.SelectedTag] === undefined) {
            throw new Error('SelectedTag is not set.');
        }
        const subscription = context.properties[
            AzureVMContextProperties.SelectedSubscription
        ] as unknown as AzureSubscription;

        const tagName = context.properties[AzureVMContextProperties.SelectedTag] as string;

        // Create management clients with error handling
        let computeClient: ComputeManagementClient;
        let networkClient: NetworkManagementClient;

        try {
            // Use type assertions to ensure type safety
            computeClient = (await createComputeManagementClient(context, subscription)) as ComputeManagementClient;
            networkClient = (await createNetworkManagementClient(context, subscription)) as NetworkManagementClient;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(l10n.t('Failed to create Azure management clients: {0}', errorMessage));
        }

        if (!computeClient || !networkClient) {
            throw new Error(l10n.t('Failed to initialize Azure management clients'));
        }

        // Create async function to provide better loading UX and debugging experience
        const getVMQuickPickItems = async (): Promise<
            IAzureQuickPickItem<VirtualMachine & { publicIpAddress?: string; fqdn?: string }>[]
        > => {
            // Using ComputeManagementClient to list VMs
            const allVms = await uiUtils.listAllIterator(computeClient.virtualMachines.listAll());

            const taggedVms: IAzureQuickPickItem<VirtualMachine & { publicIpAddress?: string; fqdn?: string }>[] = [];

            for (const vm of allVms) {
                if (vm.tags && vm.tags[tagName] !== undefined) {
                    let publicIpAddress: string | undefined;
                    let fqdn: string | undefined;

                    if (vm.networkProfile?.networkInterfaces) {
                        for (const nicRef of vm.networkProfile.networkInterfaces) {
                            if (nicRef.id) {
                                const nicName = nicRef.id.substring(nicRef.id.lastIndexOf('/') + 1);
                                const rgName = getResourceGroupFromId(nicRef.id);
                                const nic = await networkClient.networkInterfaces.get(rgName, nicName);
                                if (nic.ipConfigurations) {
                                    for (const ipConfig of nic.ipConfigurations) {
                                        if (ipConfig.publicIPAddress?.id) {
                                            const pipName = ipConfig.publicIPAddress.id.substring(
                                                ipConfig.publicIPAddress.id.lastIndexOf('/') + 1,
                                            );
                                            const pipRg = getResourceGroupFromId(ipConfig.publicIPAddress.id);
                                            const publicIp = await networkClient.publicIPAddresses.get(pipRg, pipName);
                                            if (publicIp.ipAddress) {
                                                publicIpAddress = publicIp.ipAddress;
                                            }
                                            if (publicIp.dnsSettings?.fqdn) {
                                                fqdn = publicIp.dnsSettings.fqdn;
                                            }
                                            // Stop if we found a public IP for this VM
                                            if (publicIpAddress) break;
                                        }
                                    }
                                }
                            }
                            if (publicIpAddress) break; // Stop checking NICs if IP found
                        }
                    }

                    const label = vm.name!;
                    let description = '';
                    let detail = `VM Size: ${vm.hardwareProfile?.vmSize}`; // Add VM Size to detail

                    if (publicIpAddress || fqdn) {
                        description = fqdn ? fqdn : publicIpAddress!;
                        detail += fqdn ? ` (IP: ${publicIpAddress || 'N/A'})` : '';
                    } else {
                        description = l10n.t('No public connectivity');
                        detail += l10n.t(', No public IP or FQDN found.');
                    }

                    taggedVms.push({
                        label,
                        description,
                        detail,
                        data: { ...vm, publicIpAddress, fqdn },
                        iconPath: this.iconPath,
                        alwaysShow: true,
                    });
                }
            }

            if (taggedVms.length === 0) {
                context.errorHandling.suppressReportIssue = true; // No need to report an issue if no VMs are found
                throw new Error(
                    l10n.t(`No Azure VMs found with tag "{tagName}" in subscription "{subscriptionName}".`, {
                        tagName,
                        subscriptionName: subscription.name,
                    }),
                );
            }

            return taggedVms.sort((a, b) => a.label.localeCompare(b.label));
        };

        const selectedVMItem = await context.ui.showQuickPick(getVMQuickPickItems(), {
            stepName: 'selectVM',
            placeHolder: l10n.t('Choose a Virtual Machine…'),
            loadingPlaceHolder: l10n.t('Loading Virtual Machines…'),
            enableGrouping: true,
            matchOnDescription: true,
            suppressPersistence: true,
        });

        context.properties[AzureVMContextProperties.SelectedVM] = selectedVMItem.data;
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
