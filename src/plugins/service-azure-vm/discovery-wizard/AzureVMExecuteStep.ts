/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';

import { type VirtualMachine } from '@azure/arm-compute'; // For typing the selected VM
import ConnectionString from 'mongodb-connection-string-url';
import { AzureVMContextProperties } from '../AzureVMDiscoveryProvider';

export class AzureVMExecuteStep extends AzureWizardExecuteStep<NewConnectionWizardContext> {
    public priority: number = -1;

    public async execute(context: NewConnectionWizardContext): Promise<void> {
        const selectedVM = context.properties[AzureVMContextProperties.SelectedVM] as VirtualMachine & {
            publicIpAddress?: string;
            fqdn?: string;
        };
        if (!selectedVM) {
            throw new Error('Selected VM is not set.');
        }
        const { publicIpAddress, fqdn } = selectedVM;
        const host = fqdn || publicIpAddress;
        if (!host) {
            // This case should ideally be prevented by the SelectVMStep by not allowing selection or by user being informed.
            throw new Error('Selected VM does not have a public IP address or FQDN for connection.');
        }
        // Constructing a template connection string. User will be prompted for credentials by the resource item.
        const connectionString = new ConnectionString('mongodb://<YOUR_USERNAME>@localhost:27017/'); // Placeholder host, will be replaced
        connectionString.hosts = [host + ':27017']; // Set the actual host and default port
        connectionString.username = '<YOUR_USERNAME>'; // Placeholder for username
        connectionString.password = undefined; // Password will be prompted for
        connectionString.protocol = 'mongodb';

        const finalConnectionString = connectionString.toString();
        context.valuesToMask.push(finalConnectionString); // Mask the template string as well
        context.connectionString = finalConnectionString;

        // Store VM details needed by the AzureVMResourceItem, e.g., VM id, name, and the generated connection string template
        // These will be retrieved by the resource item later.
        // For now, the connection string itself is the main piece of info to pass.
        // Additional VM info can be added to context.properties if AzureVMResourceItem needs them directly.
        context.customProperties.azureVMInfo = {
            // Using customProperties to avoid collision with wizard context props
            vmId: selectedVM.id,
            vmName: selectedVM.name,
            connectionStringTemplate: finalConnectionString, // Storing for the resource item
            vmSize: selectedVM.hardwareProfile?.vmSize,
            publicIpAddress: publicIpAddress,
            fqdn: fqdn,
        };

        // Clean-up wizard context properties
        context.properties[AzureVMContextProperties.SelectedSubscription] = undefined;
        context.properties[AzureVMContextProperties.SelectedVM] = undefined;
        context.properties[AzureVMContextProperties.AzureSubscriptionProvider] = undefined;
        context.properties[AzureVMContextProperties.SelectedTag] = undefined;
    }

    public shouldExecute(): boolean {
        return true;
    }
}
