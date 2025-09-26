/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureTenant } from '@microsoft/vscode-azext-azureauth';
import { AzureWizardPromptStep, type IWizardOptions } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { type QuickPickItem } from 'vscode';
import { type FilteringWizardContext } from './FilteringWizardContext';
import { FilterSubscriptionSubStep } from './FilterSubscriptionSubStep';
import { FilterTenantSubStep } from './FilterTenantSubStep';
import { isTenantFilteredOut } from './subscriptionFiltering';

/**
 * Custom error to signal that initialization has completed and wizard should proceed to subwizard
 */
class InitializationCompleteError extends Error {
    constructor(message: string = 'Filtering initialization completed successfully') {
        super(message);
        this.name = 'InitializationCompleteError';
    }
}

/**
 * Initialize filtering data and determine the appropriate subwizard flow based on tenant count
 */
export class InitializeFilteringStep extends AzureWizardPromptStep<FilteringWizardContext> {
    public async prompt(context: FilteringWizardContext): Promise<void> {
        try {
            // Use QuickPick with loading state for unified UX
            await context.ui.showQuickPick(this.initializeFilteringData(context), {
                loadingPlaceHolder: l10n.t('Loading tenants and subscription data...'),
                suppressPersistence: true,
            });
        } catch (error) {
            if (error instanceof InitializationCompleteError) {
                // Initialization completed - this is expected behavior
                // The exception signals that initialization is done and we should proceed to subwizard
                // Note: This was the only way to make the quick pick terminate. We're using it
                // to maintain a UX-unified behavior to control the visibility of the tenant-selection step.
                // Wizard steps upport "shouldPrompt" function and that'd be the preferred path, however
                // while "shouldPrompt" is processed, no UI is being shown. This is a bad UX.
                return; // Proceed to getSubWizard
            }
            // Re-throw any other errors
            throw error;
        }
    }

    private async initializeFilteringData(context: FilteringWizardContext): Promise<QuickPickItem[]> {
        const azureSubscriptionProvider = context.azureSubscriptionProvider;

        const tenantLoadStartTime = Date.now();
        context.availableTenants = await azureSubscriptionProvider.getTenants();
        context.telemetry.measurements.tenantLoadTimeMs = Date.now() - tenantLoadStartTime;
        context.telemetry.measurements.tenantsCount = context.availableTenants.length;

        const subscriptionLoadStartTime = Date.now();
        context.allSubscriptions = await azureSubscriptionProvider.getSubscriptions(false);
        context.telemetry.measurements.subscriptionLoadTimeMs = Date.now() - subscriptionLoadStartTime;
        context.telemetry.measurements.allSubscriptionsCount = context.allSubscriptions.length;

        // Initialize selectedTenants based on current filtering state (only if not already set from going back)
        if (!context.selectedTenants) {
            context.selectedTenants = this.getSelectedTenantsFromSettings(context.availableTenants);
        }

        // Determine the flow based on tenant count, but let's look at the actual subscriptions,
        // so that in case of a tenant without subscriptions, we don't bother the user with these.
        const uniqueTenants = this.getUniqueTenants(context.allSubscriptions);
        context.telemetry.properties.tenantCountFromSubscriptions = uniqueTenants.length.toString();

        if (uniqueTenants.length > 1) {
            context.telemetry.properties.filteringFlow = 'multiTenant';
        } else {
            context.telemetry.properties.filteringFlow = 'singleTenant';
        }

        // Throw exception to signal initialization completion and auto-proceed to subwizard
        throw new InitializationCompleteError('Tenant and subscription initialization completed');
    }

    private getUniqueTenants(subscriptions: AzureSubscription[]): string[] {
        const tenantIds = new Set<string>();
        for (const subscription of subscriptions) {
            if (subscription.tenantId) {
                tenantIds.add(subscription.tenantId);
            }
        }
        return Array.from(tenantIds);
    }

    private getSelectedTenantsFromSettings(availableTenants: AzureTenant[]): AzureTenant[] {
        // Initialize selectedTenants based on current filtering state
        // Include tenants that are NOT filtered out (i.e., currently selected)
        return availableTenants.filter((tenant) => {
            if (tenant.tenantId && tenant.account?.id) {
                // Tenant is selected if it's NOT filtered out
                return !isTenantFilteredOut(tenant.tenantId, tenant.account.id);
            }
            // Default to selected if no tenant ID or account ID
            return true;
        });
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    public async getSubWizard(context: FilteringWizardContext): Promise<IWizardOptions<FilteringWizardContext>> {
        if (context.telemetry.properties.filteringFlow === 'multiTenant') {
            // Multi-tenant: show both tenant and subscription filtering
            return {
                title: l10n.t('Configure Tenant & Subscription Filters'),
                promptSteps: [new FilterTenantSubStep(), new FilterSubscriptionSubStep()],
            };
        } else {
            // Single tenant: skip directly to subscription filtering
            return {
                title: l10n.t('Configure Subscription Filter'),
                promptSteps: [new FilterSubscriptionSubStep()],
            };
        }
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
