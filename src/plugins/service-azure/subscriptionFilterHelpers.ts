/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureSubscription, type SubscriptionId, type TenantId } from '@microsoft/vscode-azext-azureauth';
import * as vscode from 'vscode';

/**
 * Gets the subscription filters that are configured in `azureResourceGroups.selectedSubscriptions`.
 *
 * @returns A list of subscription IDs that are configured in `azureResourceGroups.selectedSubscriptions`.
 */
export function getSelectedSubscriptionIds(): SubscriptionId[] {
    const config = vscode.workspace.getConfiguration('azureResourceGroups');
    const fullSubscriptionIds = config.get<string[]>('selectedSubscriptions', []);
    return fullSubscriptionIds.map((id) => id.split('/')[1]);
}

/**
 * Gets the tenant filters that are configured in `azureResourceGroups.selectedSubscriptions`.
 *
 * @returns A list of tenant IDs that are configured in `azureResourceGroups.selectedSubscriptions`.
 */
export function getSelectedTenantIds(): TenantId[] {
    const config = vscode.workspace.getConfiguration('azureResourceGroups');
    const fullSubscriptionIds = config.get<string[]>('selectedSubscriptions', []);
    return fullSubscriptionIds.map((id) => id.split('/')[0]);
}

/**
 * Updates the list of selected subscription IDs in VS Code settings.
 * @param tenantAndSubscriptionIds Array of strings in 'tenantId/subscriptionId' format.
 */
export async function setSelectedSubscriptionIds(tenantAndSubscriptionIds: string[]): Promise<void> {
    const config = vscode.workspace.getConfiguration('azureResourceGroups');
    await config.update('selectedSubscriptions', tenantAndSubscriptionIds, vscode.ConfigurationTarget.Global);
}

/**
 * Handles potential duplicate subscription names by appending the account label.
 */
export function getDuplicateSubscriptions(subscriptions: AzureSubscription[]): AzureSubscription[] {
    const lookup = subscriptions.reduce(
        (accumulator, sub) => {
            accumulator[sub.subscriptionId] = (accumulator[sub.subscriptionId] || 0) + 1;
            return accumulator;
        },
        {} as Record<string, number>,
    );

    return subscriptions.filter((sub) => lookup[sub.subscriptionId] > 1);
}
