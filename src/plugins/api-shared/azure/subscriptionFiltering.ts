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
 * @param tenantId The tenant ID to check
 * @param accountId The account ID associated with the tenant
 * @returns True if the tenant is filtered out (unchecked), false otherwise
 */
export function isTenantFilteredOut(tenantId: string, accountId: string): boolean {
    // Try the Azure Resource Groups config first (primary storage)
    const azureResourcesConfig = vscode.workspace.getConfiguration('azureResourceGroups');
    const primaryUnselectedTenants = azureResourcesConfig.get<string[]>('unselectedTenants', []);

    // If nothing found in primary storage, try our fallback storage
    if (primaryUnselectedTenants.length === 0) {
        const fallbackUnselectedTenants = ext.context.globalState.get<string[]>(
            'azure-discovery.unselectedTenants',
            [],
        );
        return fallbackUnselectedTenants.includes(`${tenantId}/${accountId}`);
    }

    return primaryUnselectedTenants.includes(`${tenantId}/${accountId}`);
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
 * @param tenantId The tenant ID to add to unselected list
 * @param accountId The account ID associated with the tenant
 */
export async function addUnselectedTenant(tenantId: string, accountId: string): Promise<void> {
    const tenantKey = `${tenantId}/${accountId}`;

    // Get current unselected tenants from both storage locations
    const azureResourcesConfig = vscode.workspace.getConfiguration('azureResourceGroups');
    const primaryUnselectedTenants = azureResourcesConfig.get<string[]>('unselectedTenants', []);
    const fallbackUnselectedTenants = ext.context.globalState.get<string[]>('azure-discovery.unselectedTenants', []);

    // Use primary storage if available, otherwise fallback storage
    const currentUnselectedTenants =
        primaryUnselectedTenants.length > 0 ? primaryUnselectedTenants : fallbackUnselectedTenants;

    // Add if not already present
    if (!currentUnselectedTenants.includes(tenantKey)) {
        const updatedUnselectedTenants = [...currentUnselectedTenants, tenantKey];

        try {
            await azureResourcesConfig.update(
                'unselectedTenants',
                updatedUnselectedTenants,
                vscode.ConfigurationTarget.Global,
            );
        } catch (error) {
            console.error(
                'Unable to update primary storage (Azure Resource Groups tenant configuration), using fallback storage.',
                error,
            );
        } finally {
            // Always update our fallback storage regardless of primary storage success
            await ext.context.globalState.update('azure-discovery.unselectedTenants', updatedUnselectedTenants);
        }
    }
}

/**
 * Removes a tenant from the unselected tenants list.
 * This will make the tenant available for discovery.
 *
 * @param tenantId The tenant ID to remove from unselected list
 * @param accountId The account ID associated with the tenant
 */
export async function removeUnselectedTenant(tenantId: string, accountId: string): Promise<void> {
    const tenantKey = `${tenantId}/${accountId}`;

    // Get current unselected tenants from both storage locations
    const azureResourcesConfig = vscode.workspace.getConfiguration('azureResourceGroups');
    const primaryUnselectedTenants = azureResourcesConfig.get<string[]>('unselectedTenants', []);
    const fallbackUnselectedTenants = ext.context.globalState.get<string[]>('azure-discovery.unselectedTenants', []);

    // Use primary storage if available, otherwise fallback storage
    const currentUnselectedTenants =
        primaryUnselectedTenants.length > 0 ? primaryUnselectedTenants : fallbackUnselectedTenants;

    // Remove if present
    const updatedUnselectedTenants = currentUnselectedTenants.filter((tenant) => tenant !== tenantKey);

    try {
        await azureResourcesConfig.update(
            'unselectedTenants',
            updatedUnselectedTenants,
            vscode.ConfigurationTarget.Global,
        );
    } catch (error) {
        console.error(
            'Unable to update primary storage (Azure Resource Groups tenant configuration), using fallback storage.',
            error,
        );
    } finally {
        // Always update our fallback storage regardless of primary storage success
        await ext.context.globalState.update('azure-discovery.unselectedTenants', updatedUnselectedTenants);
    }
}

/**
 * Updates the unselected tenants list based on selected tenant IDs.
 * This syncs with the Azure Resource Groups extension which stores unselected tenants.
 *
 * @param selectedTenantKeys Array of selected tenant IDs in 'tenantId/accountId' format
 * @param allTenantKeys All available tenant/account combinations in 'tenantId/accountId' format
 */
export async function setSelectedTenantIds(selectedTenantKeys: string[], allTenantKeys: string[]): Promise<void> {
    // Calculate unselected tenants (inverse logic to match Azure Resource Groups)
    const unselectedTenants = allTenantKeys.filter((tenant) => !selectedTenantKeys.includes(tenant));

    try {
        const azureResourcesConfig = vscode.workspace.getConfiguration('azureResourceGroups');
        await azureResourcesConfig.update('unselectedTenants', unselectedTenants, vscode.ConfigurationTarget.Global);
    } catch (error) {
        // Log the error if the primary storage (Azure Resource Groups config) update fails
        console.error(
            'Unable to update primary storage (Azure Resource Groups tenant configuration), using fallback storage.',
            error,
        );
    } finally {
        // Always update our fallback storage regardless of primary storage success
        await ext.context.globalState.update('azure-discovery.unselectedTenants', unselectedTenants);
    }
}

/**
 * Clears all tenant filtering configuration.
 * This will make all tenants available for discovery.
 */
export async function clearTenantFiltering(): Promise<void> {
    try {
        const azureResourcesConfig = vscode.workspace.getConfiguration('azureResourceGroups');
        await azureResourcesConfig.update('unselectedTenants', [], vscode.ConfigurationTarget.Global);
    } catch (error) {
        console.error(
            'Unable to update primary storage (Azure Resource Groups tenant configuration), using fallback storage.',
            error,
        );
    } finally {
        // Always update our fallback storage regardless of primary storage success
        await ext.context.globalState.update('azure-discovery.unselectedTenants', []);
    }
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
