/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import { AzureWizardPromptStep, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../../../extensionVariables';
import { type FilteringWizardContext } from './FilteringWizardContext';
import { getDuplicateSubscriptions, getSelectedSubscriptionIds } from './subscriptionFiltering';

export class FilterSubscriptionSubStep extends AzureWizardPromptStep<FilteringWizardContext> {
    public async prompt(context: FilteringWizardContext): Promise<void> {
        const selectedSubscriptionIds = getSelectedSubscriptionIds();
        const allSubscriptions = context.allSubscriptions || [];
        const selectedTenants = context.selectedTenants || [];

        // Filter subscriptions to only show those from selected tenants
        const selectedTenantIds = new Set(selectedTenants.map((tenant) => tenant.tenantId));
        const availableSubscriptions = allSubscriptions.filter((subscription) => {
            // If no tenants selected (single tenant flow), show all subscriptions
            if (selectedTenantIds.size === 0) {
                return true;
            }
            // Otherwise, only show subscriptions from selected tenants
            return selectedTenantIds.has(subscription.tenantId);
        });

        // Add telemetry for subscription filtering
        context.telemetry.measurements.subscriptionsAfterTenantFiltering = availableSubscriptions.length;

        if (availableSubscriptions.length === 0) {
            void vscode.window.showWarningMessage(
                l10n.t(
                    'No subscriptions found for the selected tenants. Please adjust your tenant selection or check your Azure permissions.',
                ),
            );
            return;
        }

        // Build tenant display name lookup from preloaded tenant data
        const tenantDisplayNames = new Map<string, string>();
        const availableTenants = context.availableTenants || [];
        for (const tenant of availableTenants) {
            if (tenant.tenantId && tenant.displayName) {
                tenantDisplayNames.set(tenant.tenantId, tenant.displayName);
            }
        }

        // Use duplicate detection logic
        const duplicates = getDuplicateSubscriptions(availableSubscriptions);

        // Create subscription quick pick items (data is preloaded, no async needed)
        const subscriptionItems: IAzureQuickPickItem<AzureSubscription>[] = availableSubscriptions
            .map((subscription) => {
                const tenantName = tenantDisplayNames.get(subscription.tenantId);

                // Build description with tenant information
                const description = tenantName
                    ? `${subscription.subscriptionId} (${tenantName})`
                    : subscription.subscriptionId;

                return <IAzureQuickPickItem<AzureSubscription>>{
                    label: duplicates.includes(subscription)
                        ? subscription.name + ` (${subscription.account?.label})`
                        : subscription.name,
                    description,
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
                };
            })
            .sort((a, b) => a.label.localeCompare(b.label));

        const selectedItems = await context.ui.showQuickPick(subscriptionItems, {
            stepName: 'filterSubscriptions',
            canPickMany: true,
            placeHolder: l10n.t('Select subscriptions to include in service discovery'),
            isPickSelected: (item: IAzureQuickPickItem<AzureSubscription>) =>
                selectedSubscriptionIds.includes(item.data.subscriptionId),
        });

        const selectedSubscriptions = selectedItems.map((item) => item.data);

        // Add telemetry for subscription selection
        const selectedCount = selectedItems.length;
        const unselectedCount = subscriptionItems.length - selectedCount;

        context.telemetry.measurements.subscriptionsSelected = selectedCount;
        context.telemetry.measurements.subscriptionsUnselected = unselectedCount;

        // Store the selected subscriptions in context for the execute step
        context.selectedSubscriptions = selectedSubscriptions;

        // Show warning if nothing selected
        if (selectedSubscriptions.length === 0) {
            void vscode.window.showWarningMessage(
                l10n.t('No subscriptions selected. Service discovery will not show any resources.'),
            );
        }
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
