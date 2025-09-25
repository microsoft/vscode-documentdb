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
import { SelectSubscriptionStep } from '../api-shared/azure/wizard/SelectSubscriptionStep';
import { AzureMongoRUServiceRootItem } from './discovery-tree/AzureMongoRUServiceRootItem';
import { AzureMongoRUExecuteStep } from './discovery-wizard/AzureMongoRUExecuteStep';
import { SelectRUClusterStep } from './discovery-wizard/SelectRUClusterStep';

export class AzureMongoRUDiscoveryProvider extends Disposable implements DiscoveryProvider {
    id = 'azure-mongo-ru-discovery';
    label = l10n.t('Azure Cosmos DB for MongoDB (RU)');
    description = l10n.t('Azure Service Discovery for MongoDB RU');
    iconPath = new ThemeIcon('azure');

    azureSubscriptionProvider: AzureSubscriptionProviderWithFilters;

    constructor() {
        super(() => {
            this.azureSubscriptionProvider.dispose();
        });

        this.azureSubscriptionProvider = new AzureSubscriptionProviderWithFilters();
    }

    getDiscoveryTreeRootItem(parentId: string): TreeElement {
        return new AzureMongoRUServiceRootItem(this.azureSubscriptionProvider, parentId);
    }

    getDiscoveryWizard(context: NewConnectionWizardContext): IWizardOptions<NewConnectionWizardContext> {
        context.properties[AzureContextProperties.AzureSubscriptionProvider] = this.azureSubscriptionProvider;

        return {
            title: l10n.t('Azure Service Discovery'),
            promptSteps: [new SelectSubscriptionStep(), new SelectRUClusterStep()],
            executeSteps: [new AzureMongoRUExecuteStep()],
            showLoadingPrompt: true,
        };
    }

    getLearnMoreUrl(): string | undefined {
        return 'https://aka.ms/vscode-documentdb-discovery-providers-azure-ru';
    }

    async configureTreeItemFilter(context: IActionContext, node: TreeElement): Promise<void> {
        if (node instanceof AzureMongoRUServiceRootItem) {
            await configureAzureSubscriptionFilter(context, this.azureSubscriptionProvider);
            ext.discoveryBranchDataProvider.refresh(node);
        }
    }

    async configureCredentials(context: IActionContext, node?: TreeElement): Promise<void> {
        // Add telemetry for credential configuration activation
        context.telemetry.properties.credentialConfigActivated = 'true';
        context.telemetry.properties.discoveryProviderId = this.id;
        context.telemetry.properties.nodeProvided = node ? 'true' : 'false';

        if (!node || node instanceof AzureMongoRUServiceRootItem) {
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
