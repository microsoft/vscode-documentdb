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
 * The ID of the tenant is being excluced from the ID.
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
    const primarySubscriptionIds = azureResourcesConfig.get<string[]>('selectedSubscriptions', []);

    // If nothing found in primary storage, try our fallback storage
    if (primarySubscriptionIds.length === 0) {
        const fallbackSubscriptionIds = ext.context.globalState.get<string[]>(
            'azure-discovery.selectedSubscriptions',
            [],
        );
        return fallbackSubscriptionIds.map((id) => id.split('/')[1]);
    }

    // Sync to our fallback storage if primary storage had data
    // This ensures we maintain a copy if Azure Resources extension is later removed
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
    const filteredSubscriptions = subscriptions.filter(
        (subscription) => !isTenantFilteredOut(subscription.tenantId, subscription.account.id),
    );

    // If filtering would result in an empty list, return all subscriptions as a fallback
    return filteredSubscriptions.length > 0 ? filteredSubscriptions : subscriptions;
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

/**
 * Configures the Azure subscription filter.
 */
export async function configureAzureSubscriptionFilter(
    context: IActionContext,
    azureSubscriptionProvider: VSCodeAzureSubscriptionProvider,
): Promise<void> {
    const startTime = Date.now();
    context.telemetry.properties.subscriptionFilteringAction = 'configure';

    /**
     * Ensure the user is signed in to Azure
     */

    if (!(await azureSubscriptionProvider.isSignedIn())) {
        context.telemetry.properties.subscriptionFilteringResult = 'Failed';
        context.telemetry.properties.subscriptionFilteringError = 'NotSignedIn';
        const signIn: vscode.MessageItem = { title: l10n.t('Sign In') };
        void vscode.window
            .showInformationMessage(l10n.t('You are not signed in to Azure. Sign in and retry.'), signIn)
            .then(async (input) => {
                if (input === signIn) {
                    await azureSubscriptionProvider.signIn();
                    ext.discoveryBranchDataProvider.refresh();
                }
            });

        // return so that the signIn flow can be completed before continuing
        return;
    }

    const selectedSubscriptionIds = getSelectedSubscriptionIds();

    // it's an async function so that the wizard when shown can show the 'loading' state
    const subscriptionQuickPickItems: () => Promise<IAzureQuickPickItem<AzureSubscription>[]> = async () => {
        const subscriptionLoadStartTime = Date.now();
        const allSubscriptions = await azureSubscriptionProvider.getSubscriptions(false); // Get all unfiltered subscriptions
        const duplicates = getDuplicateSubscriptions(allSubscriptions);

        // Add telemetry for subscription loading
        context.telemetry.measurements.totalSubscriptionsAvailable = allSubscriptions.length;
        context.telemetry.measurements.duplicateSubscriptionsCount = duplicates.length;
        context.telemetry.measurements.subscriptionLoadingTimeMs = Date.now() - subscriptionLoadStartTime;

        // Get tenant information for better UX (similar to SelectSubscriptionStep)
        const tenantPromise = azureSubscriptionProvider.getTenants().catch(() => undefined);
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

        // Add telemetry for tenant information
        context.telemetry.measurements.tenantsWithSubscriptionsCount = tenantDisplayNames.size;

        return allSubscriptions
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

        // Add telemetry for subscription selection
        const totalAvailable = context.telemetry.measurements.totalSubscriptionsAvailable || 0;
        context.telemetry.measurements.subscriptionsSelected = picks.length;
        context.telemetry.measurements.subscriptionsFiltered = totalAvailable - picks.length;
        context.telemetry.properties.allSubscriptionsSelected = (picks.length === totalAvailable).toString();
        context.telemetry.properties.subscriptionFilteringResult = 'Succeeded';
    } else {
        context.telemetry.properties.subscriptionFilteringResult = 'Canceled';
    }

    // Add completion timing
    context.telemetry.measurements.subscriptionFilteringDurationMs = Date.now() - startTime;
}
