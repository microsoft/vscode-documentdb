/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureSubscription, type VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { type IActionContext, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { l10n } from 'vscode';
import { ext } from '../../../extensionVariables';

/**
 * Subscription filtering functionality is provided by the `VSCodeAzureSubscriptionProvider`
 * from the `vscode-azuretools` library:
 * https://github.com/tnaum-ms/vscode-azuretools/blob/main/auth/src/VSCodeAzureSubscriptionProvider.ts
 *
 * Although the provider supports filtering subscriptions internally, it does not include built-in
 * UI or configuration logic to manage these filters directly.
 *
 * Instead, the `vscode-azuretools` library relies on filter settings stored by another extension,
 * `vscode-azureresourcegroups`. Specifically, it uses a hardcoded configuration key:
 * - Configuration section: 'azureResourceGroups'
 * - Configuration property: 'subscriptions'
 *
 * To avoid introducing a direct dependency on the `vscode-azureresourcegroups` extension,
 * we replicate the filter logic here by accessing the same configuration keys. This approach
 * ensures consistency and compatibility, as users of Azure Service Discovery are likely also
 * using the Azure Resource Groups extension.
 */

/**
 * Returns the currently selected subscription IDs from the shared configuration.
 */
export function getSelectedSubscriptionIds(): string[] {
    const config = vscode.workspace.getConfiguration('azureResourceGroups');
    return config.get<string[]>('subscriptions') || [];
}

/**
 * Updates the selected subscription IDs in the shared configuration.
 */
export async function setSelectedSubscriptionIds(subscriptionIds: string[]): Promise<void> {
    const config = vscode.workspace.getConfiguration('azureResourceGroups');
    await config.update('subscriptions', subscriptionIds, vscode.ConfigurationTarget.Global);
}

/**
 * Identifies subscriptions with duplicate names.
 */
export function getDuplicateSubscriptions(subscriptions: AzureSubscription[]): AzureSubscription[] {
    const names = new Map<string, number>();
    const duplicates: AzureSubscription[] = [];

    for (const subscription of subscriptions) {
        const count = (names.get(subscription.name) || 0) + 1;
        names.set(subscription.name, count);
        if (count > 1) {
            duplicates.push(subscription);
        }
    }

    return subscriptions.filter((s) => names.get(s.name)! > 1);
}

/**
 * Configures the Azure subscription filter.
 */
export async function configureAzureSubscriptionFilter(
    context: IActionContext,
    azureSubscriptionProvider: VSCodeAzureSubscriptionProvider,
): Promise<void> {
    /**
     * Ensure the user is signed in to Azure
     */
    if (!(await azureSubscriptionProvider.isSignedIn())) {
        const signIn: vscode.MessageItem = { title: l10n.t('Sign In') };
        void vscode.window
            .showInformationMessage(l10n.t('You are not signed in to Azure. Sign in to continue.'), signIn)
            .then((input) => {
                if (input === signIn) {
                    void azureSubscriptionProvider.signIn();
                }
            });

        // return so that the signIn flow can be completed before continuing
        return;
    }

    const selectedSubscriptionIds = getSelectedSubscriptionIds();

    // it's an async function so that the wizard when shown can show the 'loading' state
    const subscriptionQuickPickItems: () => Promise<IAzureQuickPickItem<AzureSubscription>[]> = async () => {
        const allSubscriptions = await azureSubscriptionProvider.getSubscriptions(false); // Get all unfiltered subscriptions
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
                selectedSubscriptionIds.includes((pick as IAzureQuickPickItem<AzureSubscription>).data.subscriptionId)
            );
        },
    });

    if (picks) {
        // Update the setting with the new selection
        const newSelectedIds = picks.map((pick) => `${pick.data.tenantId}/${pick.data.subscriptionId}`);
        await setSelectedSubscriptionIds(newSelectedIds);
    }
}
