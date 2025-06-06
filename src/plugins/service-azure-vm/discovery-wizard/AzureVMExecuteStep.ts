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
        const selectedPort = (context.properties[AzureVMContextProperties.SelectedPort] as string) ?? '27017'; // Default to 27017 if not set

        const { publicIpAddress, fqdn } = selectedVM;
        const host = fqdn || publicIpAddress;

        if (!host) {
            // This case should ideally be prevented by the SelectVMStep by not allowing selection or by user being informed.
            throw new Error('Selected VM does not have a public IP address or FQDN for connection.');
        }

        // Constructing a template connection string. User will be prompted for credentials by the resource item.
        const connectionString = new ConnectionString('mongodb://localhost:27017/'); // Placeholder host, will be replaced
        connectionString.hosts = [`${host}:${selectedPort}`]; // Set the actual host and actual port
        connectionString.protocol = 'mongodb';

        const finalConnectionString = connectionString.toString();

        context.valuesToMask.push(finalConnectionString);

        // This is the connection string that will be used to connect to the VM that is the response from the discovery wizard.
        context.connectionString = finalConnectionString;

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
