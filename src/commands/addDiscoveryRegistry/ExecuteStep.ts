/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { DiscoveryService } from '../../services/discoveryServices';
import { type AddRegistryWizardContext } from './AddRegistryWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<AddRegistryWizardContext> {
    public priority: number = 100;

    public async execute(context: AddRegistryWizardContext): Promise<void> {
        const discoveryProviderId = context.discoveryProviderId!;

        const activeDiscoveryProviderIds = ext.context.globalState.get<string[]>('activeDiscoveryProviderIds', []);

        // Guard against duplicate registration.
        if (activeDiscoveryProviderIds.includes(discoveryProviderId)) {
            context.telemetry.properties.discoveryProviderId = discoveryProviderId;
            context.telemetry.measurements.activeDiscoveryProviders = activeDiscoveryProviderIds.length;
            return;
        }

        const provider = DiscoveryService.getProvider(discoveryProviderId);
        if (provider?.configureCredentialsOnActivation && provider.configureCredentials) {
            // Run credentials setup BEFORE persisting the active state so that a
            // cancellation or failure leaves the provider fully inactive.
            // UserCancelledError and unexpected errors propagate naturally here.
            await provider.configureCredentials(context);

            // Only persist after successful setup.
            activeDiscoveryProviderIds.push(discoveryProviderId);
            await ext.context.globalState.update('activeDiscoveryProviderIds', activeDiscoveryProviderIds);

            context.telemetry.properties.discoveryProviderId = discoveryProviderId;
            context.telemetry.measurements.activeDiscoveryProviders = activeDiscoveryProviderIds.length;

            // Refresh after persistence so the newly active provider appears in the tree.
            ext.discoveryBranchDataProvider.refresh();
            return;
        }

        // Standard path: persist immediately, then refresh the discovery tree.
        activeDiscoveryProviderIds.push(discoveryProviderId);
        await ext.context.globalState.update('activeDiscoveryProviderIds', activeDiscoveryProviderIds);

        context.telemetry.properties.discoveryProviderId = discoveryProviderId;
        context.telemetry.measurements.activeDiscoveryProviders = activeDiscoveryProviderIds.length;

        // Refresh the discovery branch data provider to show the newly added provider.
        ext.discoveryBranchDataProvider.refresh();
    }

    public shouldExecute(context: AddRegistryWizardContext): boolean {
        return !!context.discoveryProviderId;
    }
}
