/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSCodeAzureSubscriptionProvider, type SubscriptionId, type TenantId } from '@microsoft/vscode-azext-azureauth';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';

/**
 * Extends VSCodeAzureSubscriptionProvider to customize tenant and subscription filters
 */
export class AzureSubscriptionProviderWithFilters extends VSCodeAzureSubscriptionProvider {
    constructor(logger?: vscode.LogOutputChannel) {
        super(logger);
    }

    /**
     * Override the getTenantFilters method to provide custom tenant filtering
     * Uses the same logic as in the original implementation but with fallback storage support
     */
    protected override async getTenantFilters(): Promise<TenantId[]> {
        // Try the Azure Resource Groups config first
        const config = vscode.workspace.getConfiguration('azureResourceGroups');
        const fullSubscriptionIds = config.get<string[]>('selectedSubscriptions', []);

        // If nothing found there, try our fallback storage
        if (fullSubscriptionIds.length === 0) {
            const fallbackIds = ext.context.globalState.get<string[]>('azure-discovery.selectedSubscriptions', []);
            return fallbackIds.map((id) => id.split('/')[0]); // Return tenant IDs
        }

        // Sync to our fallback storage if primary storage had data
        void ext.context.globalState.update('azure-discovery.selectedSubscriptions', fullSubscriptionIds);

        // Extract the tenant IDs from the full IDs (tenantId/subscriptionId)
        return fullSubscriptionIds.map((id) => id.split('/')[0]);
    }

    /**
     * Override the getSubscriptionFilters method to provide custom subscription filtering
     * Uses the same logic as in the original implementation but with fallback storage support
     */
    protected override async getSubscriptionFilters(): Promise<SubscriptionId[]> {
        // Try the Azure Resource Groups config first
        const config = vscode.workspace.getConfiguration('azureResourceGroups');
        const fullSubscriptionIds = config.get<string[]>('selectedSubscriptions', []);

        // If nothing found there, try our fallback storage
        if (fullSubscriptionIds.length === 0) {
            const fallbackIds = ext.context.globalState.get<string[]>('azure-discovery.selectedSubscriptions', []);
            return fallbackIds.map((id) => id.split('/')[1]); // Return subscription IDs
        }

        // Sync to our fallback storage if primary storage had data
        void ext.context.globalState.update('azure-discovery.selectedSubscriptions', fullSubscriptionIds);

        // Extract the subscription IDs from the full IDs (tenantId/subscriptionId)
        return fullSubscriptionIds.map((id) => id.split('/')[1]);
    }
}
