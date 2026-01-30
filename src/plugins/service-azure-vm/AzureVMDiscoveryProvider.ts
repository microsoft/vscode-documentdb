/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, type IWizardOptions } from '@microsoft/vscode-azext-utils';
import { Disposable } from 'vscode';
import { type NewConnectionWizardContext } from '../../commands/newConnection/NewConnectionWizardContext';
import { ext } from '../../extensionVariables';
import { type DiscoveryProvider } from '../../services/discoveryServices';
import { type TreeElement } from '../../tree/TreeElement';
import { AzureSubscriptionProviderWithFilters } from '../api-shared/azure/AzureSubscriptionProviderWithFilters';
import { SelectSubscriptionStep } from '../api-shared/azure/wizard/SelectSubscriptionStep';
import { DESCRIPTION, DISCOVERY_PROVIDER_ID, ICON_PATH, LABEL, WIZARD_TITLE } from './config';
import { AzureServiceRootItem } from './discovery-tree/AzureServiceRootItem';
import { configureVmFilter } from './discovery-tree/configureVmFilterWizard';
import { AzureVMExecuteStep } from './discovery-wizard/AzureVMExecuteStep';
import { SelectPortStep } from './discovery-wizard/SelectPortStep';
import { SelectTagStep } from './discovery-wizard/SelectTagStep';
import { SelectVMStep } from './discovery-wizard/SelectVMStep';

export enum AzureVMContextProperties {
    AzureSubscriptionProvider = 'azureSubscriptionProvider',
    SelectedSubscription = 'selectedSubscription',
    SelectedTag = 'selectedTag',
    SelectedVM = 'selectedVM',
    SelectedPort = 'selectedPort',
    AzureVMResourceItemDetails = 'azureVMResourceItem',
}

export class AzureVMDiscoveryProvider extends Disposable implements DiscoveryProvider {
    id = DISCOVERY_PROVIDER_ID;
    label = LABEL;
    description = DESCRIPTION;
    iconPath = ICON_PATH;

    azureSubscriptionProvider: AzureSubscriptionProviderWithFilters;

    constructor() {
        super(() => {
            //this.onDidChangeTreeDataEmitter.dispose();
            this.azureSubscriptionProvider.dispose();
        });

        this.azureSubscriptionProvider = new AzureSubscriptionProviderWithFilters();
    }

    getDiscoveryTreeRootItem(parentId: string): TreeElement {
        // For now, reusing AzureServiceRootItem. This might need to be a new AzureVMServiceRootItem if tree structure diverges significantly.
        return new AzureServiceRootItem(this.azureSubscriptionProvider, parentId);
    }

    getDiscoveryWizard(context: NewConnectionWizardContext): IWizardOptions<NewConnectionWizardContext> {
        context.properties[AzureVMContextProperties.AzureSubscriptionProvider] = this.azureSubscriptionProvider;

        return {
            title: WIZARD_TITLE,
            promptSteps: [new SelectSubscriptionStep(), new SelectTagStep(), new SelectVMStep(), new SelectPortStep()],
            executeSteps: [new AzureVMExecuteStep()],
            showLoadingPrompt: true,
        };
    }

    getLearnMoreUrl(): string | undefined {
        return 'https://aka.ms/vscode-documentdb-discovery-providers-azure-vms';
    }

    async configureTreeItemFilter(context: IActionContext, node: TreeElement): Promise<void> {
        if (node instanceof AzureServiceRootItem) {
            await configureVmFilter(context, this.azureSubscriptionProvider);
            ext.discoveryBranchDataProvider.refresh(node);
        }
    }

    async configureCredentials(context: IActionContext, node?: TreeElement): Promise<void> {
        // Add telemetry for credential configuration activation
        context.telemetry.properties.credentialConfigActivated = 'true';
        context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
        context.telemetry.properties.nodeProvided = node ? 'true' : 'false';

        if (!node || node instanceof AzureServiceRootItem) {
            // Use the new Azure credentials configuration wizard
            const { configureAzureCredentials } = await import('../api-shared/azure/credentialsManagement');
            await configureAzureCredentials(context, this.azureSubscriptionProvider, node);

            if (node) {
                // Tree context: refresh specific node
                ext.discoveryBranchDataProvider.refresh(node);
            } else {
                // Wizard context: refresh entire discovery tree
                ext.discoveryBranchDataProvider.refresh();
            }
        }
    }
}
