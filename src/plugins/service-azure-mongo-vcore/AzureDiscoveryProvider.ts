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
import { AzureSubscriptionProviderWithFilters } from '../api-shared/azure/AzureSubscriptionProviderWithFilters';
import { configureAzureSubscriptionFilter } from '../api-shared/azure/subscriptionFiltering';
import { AzureContextProperties } from '../api-shared/azure/wizard/AzureContextProperties';
import { SelectSubscriptionStep } from '../service-azure-vm/discovery-wizard/SelectSubscriptionStep';
import { AzureServiceRootItem } from './discovery-tree/AzureServiceRootItem';
import { AzureExecuteStep } from './discovery-wizard/AzureExecuteStep';
import { SelectClusterStep } from './discovery-wizard/SelectClusterStep';

export class AzureDiscoveryProvider extends Disposable implements DiscoveryProvider {
    id = 'azure-mongo-vcore-discovery';
    label = l10n.t('Azure Cosmos DB for MongoDB (vCore)');
    description = l10n.t('Azure Service Discovery');
    iconPath = new ThemeIcon('azure');

    azureSubscriptionProvider: AzureSubscriptionProviderWithFilters;

    constructor() {
        super(() => {
            //this.onDidChangeTreeDataEmitter.dispose();
            this.azureSubscriptionProvider.dispose();
        });

        this.azureSubscriptionProvider = new AzureSubscriptionProviderWithFilters();
    }

    getDiscoveryTreeRootItem(parentId: string): TreeElement {
        return new AzureServiceRootItem(this.azureSubscriptionProvider, parentId);
    }

    getDiscoveryWizard(context: NewConnectionWizardContext): IWizardOptions<NewConnectionWizardContext> {
        /**
         * 1. List subscriptions (apply a filter), add an option to configure the filter
         * 2. List clusters in the selected subscription
         */

        context.properties[AzureContextProperties.AzureSubscriptionProvider] = this.azureSubscriptionProvider;

        return {
            title: l10n.t('Azure Service Discovery'),
            promptSteps: [new SelectSubscriptionStep(), new SelectClusterStep()],
            executeSteps: [new AzureExecuteStep()],
            showLoadingPrompt: true,
        };
    }

    getLearnMoreUrl(): string | undefined {
        return 'https://aka.ms/vscode-documentdb-discovery-providers-azure-vcore';
    }

    async configureTreeItemFilter(context: IActionContext, node: TreeElement): Promise<void> {
        if (node instanceof AzureServiceRootItem) {
            await configureAzureSubscriptionFilter(context, this.azureSubscriptionProvider);
            ext.discoveryBranchDataProvider.refresh(node);
        }
    }
}
