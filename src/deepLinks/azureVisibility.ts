/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureSubscription } from '@microsoft/vscode-azext-azureauth';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import {
    isTenantFilteredOut,
    removeUnselectedTenant,
    setSelectedSubscriptionIds,
} from '../plugins/api-shared/azure/subscriptionFiltering/subscriptionFilteringHelpers';
import { getHiddenDiscoveryProviderIds, showDiscoveryProvider } from '../services/discoveryProviderVisibility';

export interface VisibilityChanges {
    readonly showProvider: boolean;
    readonly unfilterTenant: boolean;
    readonly addSubscription: boolean;
}

/** Side-effect free: works out which filters hide the subscription's resources. */
export async function computeVisibilityChanges(
    providerId: string,
    subscription: AzureSubscription,
): Promise<VisibilityChanges> {
    const hiddenProviderIds = await getHiddenDiscoveryProviderIds();
    const selectedSubscriptions = readSelectedSubscriptions();
    const changes: VisibilityChanges = {
        showProvider: hiddenProviderIds.includes(providerId),
        unfilterTenant: isTenantFilteredOut(subscription.tenantId, subscription.account.id),
        addSubscription:
            selectedSubscriptions.length > 0 &&
            !selectedSubscriptions.some(
                (id): boolean => id.split('/')[1]?.toLowerCase() === subscription.subscriptionId.toLowerCase(),
            ),
    };
    ext.outputChannel.trace(
        `[DeepLink] Visibility changes: showProvider=${changes.showProvider} unfilterTenant=${changes.unfilterTenant} addSubscription=${changes.addSubscription}`,
    );
    return changes;
}

export function hasVisibilityChanges(changes: VisibilityChanges): boolean {
    return changes.showProvider || changes.unfilterTenant || changes.addSubscription;
}

/** Performs the changes computed by computeVisibilityChanges. */
export async function applyVisibilityChanges(
    providerId: string,
    subscription: AzureSubscription,
    changes: VisibilityChanges,
): Promise<void> {
    let changed = false;
    if (changes.showProvider) {
        await showDiscoveryProvider(providerId);
        ext.outputChannel.trace('[DeepLink] Discovery provider shown');
        changed = true;
    }
    if (changes.unfilterTenant) {
        await removeUnselectedTenant(subscription.tenantId, subscription.account.id);
        ext.outputChannel.trace('[DeepLink] Tenant unfiltered');
        changed = true;
    }
    if (changes.addSubscription) {
        const selectedSubscriptions = readSelectedSubscriptions();
        if (selectedSubscriptions.length > 0) {
            await setSelectedSubscriptionIds([
                ...selectedSubscriptions,
                `${subscription.tenantId}/${subscription.subscriptionId}`,
            ]);
            ext.outputChannel.trace('[DeepLink] Subscription added to filter');
            changed = true;
        }
    }
    if (changed) {
        ext.discoveryBranchDataProvider.refresh();
        ext.outputChannel.trace('[DeepLink] Discovery view refreshed');
    }
}

function readSelectedSubscriptions(): string[] {
    const config = vscode.workspace.getConfiguration('azureResourceGroups');
    const selectedSubscriptions = config.get<string[]>('selectedSubscriptions');
    if (selectedSubscriptions === undefined) {
        return ext.context.globalState.get<string[]>('azure-discovery.selectedSubscriptions', []);
    }
    // Unlike the existing filtering readers, computing changes must not sync the fallback storage.
    return selectedSubscriptions;
}
