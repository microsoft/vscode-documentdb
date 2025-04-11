/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { type IWizardOptions } from '@microsoft/vscode-azext-utils';
import { Disposable, l10n, ThemeIcon } from 'vscode';
import { type NewConnectionWizardContext } from '../../commands/newConnection/NewConnectionWizardContext';
import { type ServiceDiscoveryProvider } from '../../services/serviceDiscoveryServices';
import { AzureExecuteStep } from './discovery-wizard/AzureExecuteStep';
import { SelectClusterStep } from './discovery-wizard/SelectClusterStep';
import { SelectSubscriptionStep } from './discovery-wizard/SelectSubscriptionStep';

export enum AzureContextProperties {
    ServiceDiscoveryProvider = 'serviceDiscoveryProvider',
    SelectedSubscription = 'selectedSubscription',
    SelectedCluster = 'selectedCluster',
}

export class AzureDiscoveryProvider extends Disposable implements ServiceDiscoveryProvider {
    id = 'azure-discovery';
    label = 'Azure';
    description = 'Azure Service Discovery';
    iconPath = new ThemeIcon('azure');

    azureSubscriptionProvider: VSCodeAzureSubscriptionProvider;

    constructor() {
        super(() => {
            //this.onDidChangeTreeDataEmitter.dispose();
            this.azureSubscriptionProvider.dispose();
        });

        this.azureSubscriptionProvider = new VSCodeAzureSubscriptionProvider();
    }

    getDiscoveryWizard(context: NewConnectionWizardContext): IWizardOptions<NewConnectionWizardContext> {
        /**
         * 1. List subscriptions (apply a filter), add an option to configure the filter
         * 2. List clusters in the selected subscription
         */

        context.properties[AzureContextProperties.ServiceDiscoveryProvider] = this.azureSubscriptionProvider;

        return {
            title: l10n.t('Azure Service Discovery'),
            promptSteps: [new SelectSubscriptionStep(), new SelectClusterStep()],
            executeSteps: [new AzureExecuteStep()],
            showLoadingPrompt: true,
        };
    }
}
