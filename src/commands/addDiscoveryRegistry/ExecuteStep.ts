/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { getHiddenDiscoveryProviderIds, showDiscoveryProvider } from '../../services/discoveryProviderVisibility';
import { DiscoveryService } from '../../services/discoveryServices';
import { type AddRegistryWizardContext } from './AddRegistryWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<AddRegistryWizardContext> {
    public priority: number = 100;

    public async execute(context: AddRegistryWizardContext): Promise<void> {
        const discoveryProviderId = context.discoveryProviderId!;

        const hiddenDiscoveryProviderIds = await getHiddenDiscoveryProviderIds();

        // Guard against duplicate show requests.
        if (!hiddenDiscoveryProviderIds.includes(discoveryProviderId)) {
            context.telemetry.properties.discoveryProviderId = discoveryProviderId;
            context.telemetry.measurements.hiddenDiscoveryProviders = hiddenDiscoveryProviderIds.length;
            return;
        }

        const provider = DiscoveryService.getProvider(discoveryProviderId);
        if (provider?.configureCredentialsOnActivation && provider.configureCredentials) {
            // Run credentials setup BEFORE showing the provider so that a
            // cancellation or failure leaves the provider hidden.
            // UserCancelledError and unexpected errors propagate naturally here.
            await provider.configureCredentials(context);

            // Only show the provider after successful setup.
            const updatedHiddenProviderIds = await showDiscoveryProvider(discoveryProviderId);

            context.telemetry.properties.discoveryProviderId = discoveryProviderId;
            context.telemetry.measurements.hiddenDiscoveryProviders = updatedHiddenProviderIds.length;

            // Refresh after persistence so the newly visible provider appears in the tree.
            ext.discoveryBranchDataProvider.refresh();
            return;
        }

        // Standard path: show immediately, then refresh the discovery tree.
        const updatedHiddenProviderIds = await showDiscoveryProvider(discoveryProviderId);

        context.telemetry.properties.discoveryProviderId = discoveryProviderId;
        context.telemetry.measurements.hiddenDiscoveryProviders = updatedHiddenProviderIds.length;

        // Refresh the discovery branch data provider to show the newly added provider.
        ext.discoveryBranchDataProvider.refresh();
    }

    public shouldExecute(context: AddRegistryWizardContext): boolean {
        return !!context.discoveryProviderId;
    }
}
