/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../../../extensionVariables';
import { type FilteringWizardContext } from './FilteringWizardContext';
import {
    addUnselectedTenant,
    removeUnselectedTenant,
    setSelectedSubscriptionIds,
} from './subscriptionFilteringHelpers';

export class ExecuteStep extends AzureWizardExecuteStep<FilteringWizardContext> {
    public priority: number = 100;

    public async execute(context: FilteringWizardContext): Promise<void> {
        const executeStartTime = Date.now();

        ext.outputChannel.appendLine(l10n.t('Applying Azure discovery filters...'));

        // Apply tenant filtering if tenants were selected
        if (context.selectedTenants && context.availableTenants && context.availableTenants.length > 0) {
            await this.applyTenantFiltering(context);
        }

        // Apply subscription filtering if subscriptions were selected
        if (context.selectedSubscriptions && context.selectedSubscriptions.length > 0) {
            await this.applySubscriptionFiltering(context);
        }

        ext.outputChannel.appendLine(l10n.t('Refreshing Azure discovery tree...'));
        ext.discoveryBranchDataProvider.refresh();

        ext.outputChannel.appendLine(l10n.t('Azure discovery filters applied successfully.'));

        // Add completion telemetry
        context.telemetry.measurements.filteringExecutionTimeMs = Date.now() - executeStartTime;
        context.telemetry.properties.filteringExecutionResult = 'Succeeded';
    }

    private async applyTenantFiltering(context: FilteringWizardContext): Promise<void> {
        const selectedTenants = context.selectedTenants || [];
        const allTenants = context.availableTenants || [];

        ext.outputChannel.appendLine(l10n.t('Configuring tenant filtering...'));

        // Get all unique account IDs from subscriptions to apply tenant filtering per account
        const accountIds = new Set<string>();
        if (context.allSubscriptions) {
            for (const subscription of context.allSubscriptions) {
                if (subscription.account?.id) {
                    accountIds.add(subscription.account.id);
                }
            }
        }

        const selectedTenantIds = new Set(selectedTenants.map((tenant) => tenant.tenantId || ''));

        // Add telemetry for tenant filtering
        context.telemetry.measurements.tenantFilteringCount = allTenants.length;
        context.telemetry.measurements.selectedFinalTenantsCount = selectedTenants.length;
        context.telemetry.properties.filteringActionType = 'tenantFiltering';

        // Apply tenant filtering for each account
        for (const accountId of accountIds) {
            // Process each tenant - add to unselected if not selected, remove from unselected if selected
            for (const tenant of allTenants) {
                const tenantId = tenant.tenantId || '';
                if (selectedTenantIds.has(tenantId)) {
                    // Tenant is selected, so remove it from unselected list (make it available)
                    await removeUnselectedTenant(tenantId, accountId);
                } else {
                    // Tenant is not selected, so add it to unselected list (filter it out)
                    await addUnselectedTenant(tenantId, accountId);
                }
            }
        }

        ext.outputChannel.appendLine(
            l10n.t('Successfully configured tenant filtering. Selected {0} tenant(s)', selectedTenants.length),
        );

        if (selectedTenants.length > 0) {
            const tenantNames = selectedTenants.map(
                (tenant) => tenant.displayName || tenant.tenantId || l10n.t('Unknown tenant'),
            );
            ext.outputChannel.appendLine(l10n.t('Selected tenants: {0}', tenantNames.join(', ')));
        } else {
            ext.outputChannel.appendLine(
                l10n.t('No tenants selected. Azure discovery will be filtered to exclude all tenant results.'),
            );
        }
    }

    private async applySubscriptionFiltering(context: FilteringWizardContext): Promise<void> {
        const selectedSubscriptions = context.selectedSubscriptions || [];

        ext.outputChannel.appendLine(l10n.t('Configuring subscription filtering...'));

        // Convert subscriptions to the format expected by setSelectedSubscriptionIds
        const selectedIds = selectedSubscriptions.map(
            (subscription) => `${subscription.tenantId}/${subscription.subscriptionId}`,
        );

        // Store the selected subscription IDs
        await setSelectedSubscriptionIds(selectedIds);

        ext.outputChannel.appendLine(
            l10n.t(
                'Successfully configured subscription filtering. Selected {0} subscription(s)',
                selectedSubscriptions.length,
            ),
        );

        if (selectedSubscriptions.length > 0) {
            const subscriptionNames = selectedSubscriptions.map(
                (subscription) => subscription.name || subscription.subscriptionId,
            );
            ext.outputChannel.appendLine(l10n.t('Selected subscriptions: {0}', subscriptionNames.join(', ')));
        }
    }

    public shouldExecute(context: FilteringWizardContext): boolean {
        // Execute if we have either tenant or subscription filtering to apply
        return !!(context.selectedTenants || context.selectedSubscriptions);
    }
}
