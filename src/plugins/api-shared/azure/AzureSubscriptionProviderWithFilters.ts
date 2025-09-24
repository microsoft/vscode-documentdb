/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    VSCodeAzureSubscriptionProvider,
    type AzureSubscription,
    type GetSubscriptionsFilter,
    type SubscriptionId,
} from '@microsoft/vscode-azext-azureauth';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { getTenantFilteredSubscriptions } from './subscriptionFiltering';

/**
 * Extends VSCodeAzureSubscriptionProvider to customize tenant and subscription filters
 */
export class AzureSubscriptionProviderWithFilters extends VSCodeAzureSubscriptionProvider {
    constructor(logger?: vscode.LogOutputChannel) {
        super(logger);
    }

    private getTenantAndSubscriptionFilters(): string[] {
        // Try the Azure Resource Groups config first
        const config = vscode.workspace.getConfiguration('azureResourceGroups');
        let fullSubscriptionIds = config.get<string[]>('selectedSubscriptions', []);

        // If nothing found there, try our fallback storage
        if (fullSubscriptionIds.length === 0) {
            fullSubscriptionIds = ext.context.globalState.get<string[]>('azure-discovery.selectedSubscriptions', []);
        } else {
            // Sync to our fallback storage if primary storage had data
            void ext.context.globalState.update('azure-discovery.selectedSubscriptions', fullSubscriptionIds);
        }
        return fullSubscriptionIds;
    }

    /**
     * Gets subscriptions from the Azure subscription provider and applies tenant filtering.
     * Tenant filtering is always applied regardless of the subscription filter parameter.
     *
     * @param filter Whether to apply subscription filtering or a custom filter
     * @returns Filtered list of subscriptions with tenant filtering applied
     */
    public override async getSubscriptions(filter?: boolean | GetSubscriptionsFilter): Promise<AzureSubscription[]> {
        // Get subscriptions from the base provider with the original filter parameter
        const subscriptions = await super.getSubscriptions(filter);

        // Always apply tenant filtering regardless of the filter parameter
        return getTenantFilteredSubscriptions(subscriptions);
    }

    /**
     * Override the getSubscriptionFilters method to provide custom subscription filtering
     * Uses the same logic as in the original implementation but with fallback storage support
     */
    protected override async getSubscriptionFilters(): Promise<SubscriptionId[]> {
        const fullSubscriptionIds = this.getTenantAndSubscriptionFilters();
        // Extract the subscription IDs from the full IDs (tenantId/subscriptionId)
        return Promise.resolve(fullSubscriptionIds.map((id) => id.split('/')[1]));
    }
}
