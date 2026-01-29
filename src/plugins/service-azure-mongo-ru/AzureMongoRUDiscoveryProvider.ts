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
import { configureAzureSubscriptionFilter } from '../api-shared/azure/subscriptionFiltering/configureAzureSubscriptionFilter';
import { AzureContextProperties } from '../api-shared/azure/wizard/AzureContextProperties';
import { SelectSubscriptionStep } from '../api-shared/azure/wizard/SelectSubscriptionStep';
import { DESCRIPTION, DISCOVERY_PROVIDER_ID, ICON_PATH, LABEL, WIZARD_TITLE } from './config';
import { AzureMongoRUServiceRootItem } from './discovery-tree/AzureMongoRUServiceRootItem';
import { AzureMongoRUExecuteStep } from './discovery-wizard/AzureMongoRUExecuteStep';
import { SelectRUClusterStep } from './discovery-wizard/SelectRUClusterStep';

export class AzureMongoRUDiscoveryProvider extends Disposable implements DiscoveryProvider {
    id = DISCOVERY_PROVIDER_ID;
    label = LABEL;
    description = DESCRIPTION;
    iconPath = ICON_PATH;

    azureSubscriptionProvider: AzureSubscriptionProviderWithFilters;

    constructor() {
        super(() => {
            this.azureSubscriptionProvider.dispose();
        });

        this.azureSubscriptionProvider = new AzureSubscriptionProviderWithFilters();
    }

    /**
     * Determines if this provider owns the given clusterId.
     *
     * RU (Cosmos DB for MongoDB) accounts have Azure Resource IDs like:
     *   /subscriptions/.../providers/Microsoft.DocumentDB/databaseAccounts/...
     *
     * After sanitization (replacing '/' with '_'):
     *   _subscriptions_..._providers_Microsoft.DocumentDB_databaseAccounts_...
     */
    ownsClusterId(clusterId: string): boolean {
        return clusterId.includes('_databaseAccounts_');
    }

    getDiscoveryTreeRootItem(parentId: string): TreeElement {
        return new AzureMongoRUServiceRootItem(this.azureSubscriptionProvider, parentId);
    }

    getDiscoveryWizard(context: NewConnectionWizardContext): IWizardOptions<NewConnectionWizardContext> {
        context.properties[AzureContextProperties.AzureSubscriptionProvider] = this.azureSubscriptionProvider;

        return {
            title: WIZARD_TITLE,
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
        context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
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
