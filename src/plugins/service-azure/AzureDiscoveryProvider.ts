/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSCodeAzureSubscriptionProvider, type AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { type IActionContext, type IAzureQuickPickItem, type IWizardOptions } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { Disposable, l10n, ThemeIcon } from 'vscode';
import { type NewConnectionWizardContext } from '../../commands/newConnection/NewConnectionWizardContext';
import { ext } from '../../extensionVariables';
import { type DiscoveryProvider } from '../../services/discoveryServices';
import { type TreeElement } from '../../tree/TreeElement';
import { AzureServiceRootItem } from './discovery-tree/AzureServiceRootItem';
import { AzureExecuteStep } from './discovery-wizard/AzureExecuteStep';
import { SelectClusterStep } from './discovery-wizard/SelectClusterStep';
import { SelectSubscriptionStep } from './discovery-wizard/SelectSubscriptionStep';
import {
    getDuplicateSubscriptions,
    getSelectedSubscriptionIds,
    setSelectedSubscriptionIds,
} from './subscriptionFilterHelpers';

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

    async configureTreeItemFilter(context: IActionContext, node: TreeElement): Promise<void> {
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

        /**
         * This is an important step to ensure that the user is signed in to Azure
         */
        if (!(await this.azureSubscriptionProvider.isSignedIn())) {
            const signIn: vscode.MessageItem = { title: l10n.t('Sign In') };
            void vscode.window
                .showInformationMessage(l10n.t('You are not signed in to Azure. Sign in to continue.'), signIn)
                .then((input) => {
                    if (input === signIn) {
                        void this.azureSubscriptionProvider.signIn();
                    }
                });

            // return so that the signIn flow can be completed before continuing
            return;
        }

        const selectedSubscriptionIds = getSelectedSubscriptionIds();

        // it's an async funciton so that the wizard when shown can show the 'loading' state
        const subscriptionQuickPickItems: () => Promise<IAzureQuickPickItem<AzureSubscription>[]> = async () => {
            const allSubscriptions = await this.azureSubscriptionProvider.getSubscriptions(false); // Get all unfiltered subscriptions
            const duplicates = getDuplicateSubscriptions(allSubscriptions);

            return allSubscriptions
                .map(
                    (subscription) =>
                        <IAzureQuickPickItem<AzureSubscription>>{
                            label: duplicates.includes(subscription)
                                ? subscription.name + ` (${subscription.account?.label})`
                                : subscription.name,
                            description: subscription.subscriptionId,
                            data: subscription,
                            group: subscription.account.label,
                            iconPath: vscode.Uri.joinPath(
                                ext.context.extensionUri,
                                'resources',
                                'from_node_modules',
                                '@microsoft',
                                'vscode-azext-azureutils',
                                'resources',
                                'azureSubscription.svg',
                            ),
                        },
                )
                .sort((a, b) => a.label.localeCompare(b.label));
        };

        const picks = await context.ui.showQuickPick(subscriptionQuickPickItems(), {
            canPickMany: true,
            placeHolder: l10n.t('Select Subscriptions'),
            isPickSelected: (pick) => {
                return (
                    selectedSubscriptionIds.length === 0 ||
                    selectedSubscriptionIds.includes(
                        (pick as IAzureQuickPickItem<AzureSubscription>).data.subscriptionId,
                    )
                );
            },
        });

        if (picks) {
            // Update the setting with the new selection
            const newSelectedIds = picks.map((pick) => `${pick.data.tenantId}/${pick.data.subscriptionId}`);
            await setSelectedSubscriptionIds(newSelectedIds);

            ext.discoveryBranchDataProvider.refresh(node);
        }
    }
}
