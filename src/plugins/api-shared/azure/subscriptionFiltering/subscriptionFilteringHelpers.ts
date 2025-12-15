/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import * as vscode from 'vscode';
import { ext } from '../../../../extensionVariables';

/**
 * Subscription filtering functionality is provided by the `VSCodeAzureSubscriptionProvider`
 * from the `vscode-azuretools` library:
 * https://github.com/microsoft/vscode-azuretools/blob/main/auth/src/VSCodeAzureSubscriptionProvider.ts
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
 * The ID of the tenant is being excluded from the ID.
 * The IDs are stored in the format 'tenantId/subscriptionId'.
 * For example: 'tenantId/subscriptionId'.
 * The function returns an array of subscription IDs without the tenant ID.
 * For example: 'subscriptionId'.
 *
 * @returns An array of selected subscription IDs.
 */
export function getSelectedSubscriptionIds(): string[] {
    // Try the Azure Resource Groups config first (primary storage)
    const azureResourcesConfig = vscode.workspace.getConfiguration('azureResourceGroups');
    const primarySubscriptionIds = azureResourcesConfig.get<string[]>('selectedSubscriptions');

    // If no configuration found (undefined), try our fallback storage
    if (primarySubscriptionIds === undefined) {
        const fallbackSubscriptionIds = ext.context.globalState.get<string[]>(
            'azure-discovery.selectedSubscriptions',
            [],
        );
        return fallbackSubscriptionIds.map((id) => id.split('/')[1]);
    }

    // Sync from primary storage to fallback storage (even if empty array)
    // This ensures we maintain a backup copy in case the Azure Resources extension goes down later
    void ext.context.globalState.update('azure-discovery.selectedSubscriptions', primarySubscriptionIds);

    return primarySubscriptionIds.map((id) => id.split('/')[1]);
}

/**
 * Updates the selected subscription IDs in the shared configuration.
 * These have to contain the full subscription ID, which is a combination of the tenant ID and subscription ID.
 * For example: 'tenantId/subscriptionId'.
 */
export async function setSelectedSubscriptionIds(subscriptionIds: string[]): Promise<void> {
    try {
        const azureResourcesConfig = vscode.workspace.getConfiguration('azureResourceGroups');
        await azureResourcesConfig.update('selectedSubscriptions', subscriptionIds, vscode.ConfigurationTarget.Global);
    } catch (error) {
        // Log the error if the primary storage (Azure Resource Groups config) update fails
        console.error('Unable to update Azure Resource Groups configuration, using fallback storage.', error);
    } finally {
        // Always update our fallback storage regardless of primary storage success
        await ext.context.globalState.update('azure-discovery.selectedSubscriptions', subscriptionIds);
    }
}

/**
 * Checks if a tenant is filtered out based on stored tenant filters.
 *
 * Note: The Azure Resource Groups extension stores unselected tenants in their own
 * extension's globalState using context.globalState.get<string[]>('unselectedTenants').
 * Since each extension has its own isolated globalState, we cannot access their data.
 * We replicate their behavior using our own storage so that if Azure Resource Groups
 * ever exposes their unselected tenants list publicly, we can set up synchronization.
 *
 * @param tenantId The tenant ID to check
 * @param accountId The account ID associated with the tenant
 * @returns True if the tenant is filtered out (unchecked), false otherwise
 */
export function isTenantFilteredOut(tenantId: string, accountId: string): boolean {
    const unselectedTenants = ext.context.globalState.get<string[]>('azure-discovery.unselectedTenants', []);
    return unselectedTenants.includes(`${tenantId}/${accountId}`);
}

/**
 * Filters subscriptions based on tenant selection settings.
 * Returns only subscriptions from selected tenants.
 *
 * @param subscriptions All subscriptions returned from the API
 * @returns Filtered subscriptions from selected tenants only
 */
export function getTenantFilteredSubscriptions(subscriptions: AzureSubscription[]): AzureSubscription[] {
    return subscriptions.filter((subscription) => !isTenantFilteredOut(subscription.tenantId, subscription.account.id));
}

/**
 * Adds a tenant to the unselected tenants list.
 * This will filter out the tenant from discovery.
 *
 * Note: We use our own extension's globalState for tenant filtering since the Azure Resource Groups
 * extension's unselected tenants list is not publicly accessible (stored in their own globalState).
 * This replicates their behavior so that if they ever expose their data, we can sync with it.
 *
 * @param tenantId The tenant ID to add to unselected list
 * @param accountId The account ID associated with the tenant
 */
export async function addUnselectedTenant(tenantId: string, accountId: string): Promise<void> {
    const tenantKey = `${tenantId}/${accountId}`;
    const currentUnselectedTenants = ext.context.globalState.get<string[]>('azure-discovery.unselectedTenants', []);

    // Add if not already present
    if (!currentUnselectedTenants.includes(tenantKey)) {
        const updatedUnselectedTenants = [...currentUnselectedTenants, tenantKey];
        await ext.context.globalState.update('azure-discovery.unselectedTenants', updatedUnselectedTenants);
    }
}

/**
 * Removes a tenant from the unselected tenants list.
 * This will make the tenant available for discovery.
 *
 * Note: We use our own extension's globalState for tenant filtering since the Azure Resource Groups
 * extension's unselected tenants list is not publicly accessible (stored in their own globalState).
 * This replicates their behavior so that if they ever expose their data, we can sync with it.
 *
 * @param tenantId The tenant ID to remove from unselected list
 * @param accountId The account ID associated with the tenant
 */
export async function removeUnselectedTenant(tenantId: string, accountId: string): Promise<void> {
    const tenantKey = `${tenantId}/${accountId}`;
    const currentUnselectedTenants = ext.context.globalState.get<string[]>('azure-discovery.unselectedTenants', []);

    // Remove if present
    const updatedUnselectedTenants = currentUnselectedTenants.filter((tenant) => tenant !== tenantKey);
    await ext.context.globalState.update('azure-discovery.unselectedTenants', updatedUnselectedTenants);
}

/**
 * Clears all tenant filtering configuration.
 * This will make all tenants available for discovery.
 *
 * Note: We use our own extension's globalState for tenant filtering since the Azure Resource Groups
 * extension's unselected tenants list is not publicly accessible (stored in their own globalState).
 * This replicates their behavior so that if they ever expose their data, we can sync with it.
 */
export async function clearTenantFiltering(): Promise<void> {
    await ext.context.globalState.update('azure-discovery.unselectedTenants', []);
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
