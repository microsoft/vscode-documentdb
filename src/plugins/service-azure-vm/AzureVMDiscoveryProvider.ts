/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, type IWizardOptions } from '@microsoft/vscode-azext-utils';
import { Disposable, l10n, ThemeIcon } from 'vscode';
import { type NewConnectionWizardContext } from '../../commands/newConnection/NewConnectionWizardContext';
import { ext } from '../../extensionVariables';
import { type DiscoveryProvider } from '../../services/discoveryServices';
import { type TreeElement } from '../../tree/TreeElement';
import { AzureServiceRootItem } from './discovery-tree/AzureServiceRootItem';
import { AzureSubscriptionProviderWithFilters } from './discovery-tree/AzureSubscriptionProviderWithFilters';
import { configureVmFilter } from './discovery-tree/configureVmFilterWizard';
import { AzureVMExecuteStep } from './discovery-wizard/AzureVMExecuteStep';
import { SelectSubscriptionStep } from './discovery-wizard/SelectSubscriptionStep';
import { SelectTagStep } from './discovery-wizard/SelectTagStep';
import { SelectVMStep } from './discovery-wizard/SelectVMStep';

export enum AzureVMContextProperties {
    AzureSubscriptionProvider = 'azureSubscriptionProvider',
    SelectedSubscription = 'selectedSubscription',
    SelectedTag = 'selectedTag',
    SelectedVM = 'selectedVM',
    AzureVMResourceItemDetails = 'azureVMResourceItem',
}

export class AzureVMDiscoveryProvider extends Disposable implements DiscoveryProvider {
    id = 'azure-vm-discovery';
    label = l10n.t('Azure VMs (DocumentDB)');
    description = l10n.t('Azure VM Service Discovery');
    iconPath = new ThemeIcon('vm'); // Using a generic VM icon

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
            title: l10n.t('Azure VM Service Discovery'),
            promptSteps: [new SelectSubscriptionStep(), new SelectTagStep(), new SelectVMStep()],
            executeSteps: [new AzureVMExecuteStep()],
            showLoadingPrompt: true,
        };
    }

    async configureTreeItemFilter(context: IActionContext, node: TreeElement): Promise<void> {
        if (node instanceof AzureServiceRootItem) {
            await configureVmFilter(context, this.azureSubscriptionProvider);
            ext.discoveryBranchDataProvider.refresh(node);
        }
    }
}
