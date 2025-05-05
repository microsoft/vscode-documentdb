/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { type IWizardOptions } from '@microsoft/vscode-azext-utils';
import { Disposable, l10n, ThemeIcon } from 'vscode';
import { type NewConnectionWizardContext } from '../../commands/newConnection/NewConnectionWizardContext';
import { type DiscoveryProvider } from '../../services/discoveryServices';
import { type TreeElement } from '../../tree/TreeElement';
import { AzureServiceRootItem } from './discovery-tree/AzureServiceRootItem';
import { AzureExecuteStep } from './discovery-wizard/AzureExecuteStep';
import { SelectClusterStep } from './discovery-wizard/SelectClusterStep';
import { SelectSubscriptionStep } from './discovery-wizard/SelectSubscriptionStep';

export enum AzureContextProperties {
    AzureSubscriptionProvider = 'azureSubscriptionProvider',
    SelectedSubscription = 'selectedSubscription',
    SelectedCluster = 'selectedCluster',
}

export class AzureDiscoveryProvider extends Disposable implements DiscoveryProvider {
    id = 'azure-discovery';
    label = l10n.t('Azure Cosmos DB for MongoDB (vCore)');
    description = l10n.t('Azure Service Discovery');
    iconPath = new ThemeIcon('azure');

    azureSubscriptionProvider: VSCodeAzureSubscriptionProvider;

    constructor() {
        super(() => {
            //this.onDidChangeTreeDataEmitter.dispose();
            this.azureSubscriptionProvider.dispose();
        });

        this.azureSubscriptionProvider = new VSCodeAzureSubscriptionProvider();
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

    configureTreeItemFilter(_node: TreeElement): Promise<void> {
        /**
         * The subscription filtering functionality is provided by the `VSCodeAzureSubscriptionProvider`
         * from the `vscode-azuretools` library:
         * https://github.com/tnaum-ms/vscode-azuretools/blob/main/auth/src/VSCodeAzureSubscriptionProvider.ts
         *
         * While the provider supports filtering subscriptions, there is no built-in code or UI
         * to configure the filter.
         *
         * Interestingly, the `vscode-azuretools` library relies on filter settings stored by
         * the `vscode-azureresourcegroups` extension, with the filter name hardcoded.
         *
         * To avoid adding a direct dependency on `vscode-azureresourcegroups`, we can replicate
         * the filter logic here. Alternatively, we could implement our own filter storage, but
         * since users of Azure Service Discovery are likely also using Azure Resource Groups,
         * we can safely reuse the same filter storage as `vscode-azureresourcegroups`.
         */
    }
}
