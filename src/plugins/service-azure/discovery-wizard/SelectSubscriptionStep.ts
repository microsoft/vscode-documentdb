/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { AzureWizardPromptStep, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { Uri, window, type MessageItem, type QuickPickItem } from 'vscode';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';
import { ext } from '../../../extensionVariables';
import { AzureContextProperties } from '../AzureDiscoveryProvider';

export class SelectSubscriptionStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    iconPath = Uri.joinPath(
        ext.context.extensionUri,
        'resources',
        'from_node_modules',
        '@microsoft',
        'vscode-azext-azureutils',
        'resources',
        'azureSubscription.svg',
    );

    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        if (
            context.properties[AzureContextProperties.AzureSubscriptionProvider] === undefined ||
            !(
                context.properties[AzureContextProperties.AzureSubscriptionProvider] instanceof
                VSCodeAzureSubscriptionProvider
            )
        ) {
            throw new Error('ServiceDiscoveryProvider is not set or is not of the correct type.');
        }

        const subscriptionProvider = context.properties[
            AzureContextProperties.AzureSubscriptionProvider
        ] as VSCodeAzureSubscriptionProvider;

        /**
         * This is an important step to ensure that the user is signed in to Azure before listing subscriptions.
         */
        if (!(await subscriptionProvider.isSignedIn())) {
            const signIn: MessageItem = { title: l10n.t('Sign In') };
            void window
                .showInformationMessage(l10n.t('You are not signed in to Azure. Sign in to continue.'), signIn)
                .then((input) => {
                    if (input === signIn) {
                        void subscriptionProvider.signIn();
                    }
                });

            throw new UserCancelledError(l10n.t('User is not signed in to Azure.'));
        }

        const subscriptions = await subscriptionProvider.getSubscriptions(false);

        const promptItems: (QuickPickItem & { id: string })[] = subscriptions
            .map((subscription) => ({
                id: subscription.subscriptionId,
                label: subscription.name,
                description: subscription.subscriptionId,
                iconPath: this.iconPath,

                alwaysShow: true,
            }))
            // Sort alphabetically
            .sort((a, b) => a.label.localeCompare(b.label));

        const selectedItem = await context.ui.showQuickPick([...promptItems], {
            stepName: 'selectSubscription',
            placeHolder: l10n.t('Choose a subscription…'),
            loadingPlaceHolder: l10n.t('Loading subscriptions…'),
            enableGrouping: true,
            matchOnDescription: true,
            suppressPersistence: true,
        });

        context.properties[AzureContextProperties.SelectedSubscription] = subscriptions.find(
            (subscription) => subscription.subscriptionId === selectedItem.id,
        );
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
