/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { type AddRegistryWizardContext } from './AddRegistryWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<AddRegistryWizardContext> {
    public priority: number = 100;

    public async execute(context: AddRegistryWizardContext): Promise<void> {
        // Add the selected discovery provider to the global state
        const activeDiscoveryProviderIds = ext.context.globalState.get<string[]>('activeDiscoveryProviderIds', []);
        activeDiscoveryProviderIds.push(context.discoveryProviderId!);
        await ext.context.globalState.update('activeDiscoveryProviderIds', activeDiscoveryProviderIds);

        // Refresh the discovery branch data provider to show the newly added provider
        ext.discoveryBranchDataProvider.refresh();
    }

    public shouldExecute(context: AddRegistryWizardContext): boolean {
        return !!context.discoveryProviderId;
    }
}
