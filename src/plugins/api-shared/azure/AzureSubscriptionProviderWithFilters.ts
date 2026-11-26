/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    isNotSignedInError,
    VSCodeAzureSubscriptionProvider,
    type AzureAccount,
    type AzureSubscription,
    type AzureTenant,
    type GetAccountsOptions,
    type GetAvailableSubscriptionsOptions,
    type SubscriptionId,
    type TenantIdAndAccount,
} from '@microsoft/vscode-azext-azureauth';
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { meterSilentCatch } from '../../../utils/accumulatingTelemetry';

export async function getUnfilteredAzureTenants(
    provider: VSCodeAzureSubscriptionProvider,
    noCache?: boolean,
): Promise<AzureTenant[]> {
    const options = noCache ? { filter: false, noCache: true } : { filter: false };
    let accounts: AzureAccount[];
    try {
        accounts = await provider.getAccounts(options);
    } catch (error) {
        if (isNotSignedInError(error)) {
            return [];
        }
        throw error;
    }

    const tenants: AzureTenant[] = [];
    for (const account of accounts) {
        try {
            tenants.push(...(await provider.getTenantsForAccount(account, options)));
        } catch (error) {
            if (!isNotSignedInError(error)) {
                throw error;
            }
        }
    }
    return tenants;
}

/**
 * Extends VSCodeAzureSubscriptionProvider to customize tenant and subscription filters
 */
export class AzureSubscriptionProviderWithFilters extends VSCodeAzureSubscriptionProvider {
    private freshListingRequested = false;
    private readonly listingSkips = new AsyncLocalStorage<{
        skippedAccounts: number;
        skippedTenants: number;
    }>();
    private readonly cacheRefreshSubscription: vscode.Disposable;

    constructor() {
        super();
        // The SDK starts its cache invalidation listeners only when subscribed.
        this.cacheRefreshSubscription = this.onRefreshSuggested(() => undefined);
    }

    public override dispose(): void {
        this.cacheRefreshSubscription.dispose();
        super.dispose();
    }

    private getTenantAndSubscriptionFilters(): string[] {
        // Try the Azure Resource Groups config first
        const config = vscode.workspace.getConfiguration('azureResourceGroups');
        let fullSubscriptionIds = config.get<string[]>('selectedSubscriptions');

        // If no configuration found (undefined), try our fallback storage
        if (fullSubscriptionIds === undefined) {
            fullSubscriptionIds = ext.context.globalState.get<string[]>('azure-discovery.selectedSubscriptions', []);
        } else {
            // Sync to our fallback storage if primary storage had data (even if empty array)
            void ext.context.globalState.update('azure-discovery.selectedSubscriptions', fullSubscriptionIds);
        }
        return fullSubscriptionIds;
    }

    public requestFreshListing(): void {
        this.freshListingRequested = true;
    }

    public override getAccounts(options?: GetAccountsOptions): Promise<AzureAccount[]> {
        return super.getAccounts({ ...options, noCache: true });
    }

    public override async getAvailableSubscriptions(
        options?: GetAvailableSubscriptionsOptions,
    ): Promise<AzureSubscription[]> {
        if (this.freshListingRequested) {
            this.freshListingRequested = false;
            options = { ...options, noCache: true };
        }

        const counters = { skippedAccounts: 0, skippedTenants: 0 };
        try {
            const subscriptions = await this.listingSkips.run(counters, () =>
                super.getAvailableSubscriptions(options),
            );
            if (counters.skippedAccounts > 0 || counters.skippedTenants > 0) {
                void callWithTelemetryAndErrorHandling('azureSubscriptions.partialListing', (context) => {
                    context.errorHandling.suppressDisplay = true;
                    context.telemetry.measurements.skippedAccounts = counters.skippedAccounts;
                    context.telemetry.measurements.skippedTenants = counters.skippedTenants;
                });

                const showOutput = vscode.l10n.t('Show Output');
                void Promise.resolve(
                    vscode.window.showWarningMessage(
                        vscode.l10n.t(
                            'Some Azure accounts or tenants could not be listed, so some subscriptions may be missing.',
                        ),
                        showOutput,
                    ),
                )
                    .then((choice) => {
                        if (choice === showOutput) {
                            ext.outputChannel.show();
                        }
                    })
                    .catch(() => {
                        meterSilentCatch('AzureSubscriptionProviderWithFilters_partialListingHint');
                    });
            }
            return subscriptions;
        } catch (error) {
            if (isNotSignedInError(error)) {
                return [];
            }
            throw error;
        }
    }

    protected override errorForAccount(_account: AzureAccount, _message: string, _error: unknown): void {
        const counters = this.listingSkips.getStore();
        if (counters) {
            counters.skippedAccounts++;
        }
        ext.outputChannel.warn(vscode.l10n.t('Skipped an Azure account because its tenants could not be listed.'));
    }

    protected override errorForTenant(_tenant: TenantIdAndAccount, _message: string, _error: unknown): void {
        const counters = this.listingSkips.getStore();
        if (counters) {
            counters.skippedTenants++;
        }
        ext.outputChannel.warn(vscode.l10n.t('Skipped an Azure tenant because its subscriptions could not be listed.'));
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
