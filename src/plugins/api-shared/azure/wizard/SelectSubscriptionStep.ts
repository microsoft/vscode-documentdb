/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { AzureWizardPromptStep, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { Uri, window, type MessageItem, type QuickPickItem } from 'vscode';
import { type NewConnectionWizardContext } from '../../../../commands/newConnection/NewConnectionWizardContext';
import { ext } from '../../../../extensionVariables';
import { getDuplicateSubscriptions } from '../subscriptionFiltering';
import { AzureContextProperties } from './AzureContextProperties';

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
                .showInformationMessage(l10n.t('You are not signed in to Azure. Sign in and retry.'), signIn)
                .then((input) => {
                    if (input === signIn) {
                        void subscriptionProvider.signIn();
                    }
                });

            throw new UserCancelledError(l10n.t('User is not signed in to Azure.'));
        }

        // Store subscriptions outside the async function so we can access them later
        let subscriptions!: Awaited<ReturnType<typeof subscriptionProvider.getSubscriptions>>;

        // Create async function to provide better loading UX and debugging experience
        const getSubscriptionQuickPickItems = async (): Promise<(QuickPickItem & { id: string })[]> => {
            subscriptions = await subscriptionProvider.getSubscriptions(false);

            // This information is extracted to improve the UX, that's why there are fallbacks to 'undefined'
            // Note to future maintainers: we used to run getSubscriptions and getTenants "in parallel", however
            // this lead to incorrect responses from getSubscriptions. We didn't investigate
            const tenantPromise = subscriptionProvider.getTenants().catch(() => undefined);
            const timeoutPromise = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 5000));
            const knownTenants = await Promise.race([tenantPromise, timeoutPromise]);

            // Build tenant display name lookup for better UX
            const tenantDisplayNames = new Map<string, string>();

            if (knownTenants) {
                for (const tenant of knownTenants) {
                    if (tenant.tenantId && tenant.displayName) {
                        tenantDisplayNames.set(tenant.tenantId, tenant.displayName);
                    }
                }
            }

            // Use duplicate detection logic from subscriptionFiltering
            const duplicates = getDuplicateSubscriptions(subscriptions);

            return subscriptions
                .map((subscription) => {
                    const tenantName = tenantDisplayNames.get(subscription.tenantId);

                    // Handle duplicate subscription names by adding account label
                    const label = duplicates.includes(subscription)
                        ? `${subscription.name} (${subscription.account?.label})`
                        : subscription.name;

                    // Build description with tenant information
                    const description = tenantName
                        ? `${subscription.subscriptionId} (${tenantName})`
                        : subscription.subscriptionId;

                    return {
                        id: subscription.subscriptionId,
                        label,
                        description,
                        iconPath: this.iconPath,
                        alwaysShow: true,
                    };
                })
                .sort((a, b) => a.label.localeCompare(b.label));
        };

        const selectedItem = await context.ui.showQuickPick(getSubscriptionQuickPickItems(), {
            stepName: 'selectSubscription',
            placeHolder: l10n.t('Choose a subscription…'),
            loadingPlaceHolder: l10n.t('Loading subscriptions…'),
            enableGrouping: false,
            matchOnDescription: true,
            suppressPersistence: true,
        });

        // Use the subscriptions we already loaded (no second API call needed)
        context.properties[AzureContextProperties.SelectedSubscription] = subscriptions.find(
            (subscription) => subscription.subscriptionId === selectedItem.id,
        );
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
