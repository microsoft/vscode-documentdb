/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../../../extensionVariables';
import { nonNullValue } from '../../../../utils/nonNull';
import { type CredentialsManagementWizardContext } from './CredentialsManagementWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<CredentialsManagementWizardContext> {
    public priority: number = 100;

    public async execute(context: CredentialsManagementWizardContext): Promise<void> {
        const executeStartTime = Date.now();
        const selectedAccount = nonNullValue(context.selectedAccount, 'context.selectedAccount', 'ExecuteStep.ts');

        const selectedTenants = context.selectedTenants || [];

        ext.outputChannel.appendLine(
            l10n.t('Saving Azure credentials configuration for account: {0}', selectedAccount.label),
        );

        // Get all available tenants for this account
        const allTenantsForAccount = nonNullValue(context.allTenants, 'context.allTenants', 'ExecuteStep.ts');
        const selectedTenantIds = new Set(selectedTenants.map((tenant) => tenant.tenantId || ''));

        // Add telemetry for execution
        context.telemetry.measurements.tenantFilteringCount = allTenantsForAccount.length;
        context.telemetry.measurements.selectedFinalTenantsCount = selectedTenants.length;
        context.telemetry.properties.filteringActionType = 'tenantFiltering';

        // Use the individual add/remove functions to update tenant selections
        const { addUnselectedTenant, removeUnselectedTenant } = await import(
            '../subscriptionFiltering/subscriptionFilteringHelpers'
        );

        // Process each tenant - add to unselected if not selected, remove from unselected if selected
        for (const tenant of allTenantsForAccount) {
            const tenantId = tenant.tenantId || '';
            if (selectedTenantIds.has(tenantId)) {
                // Tenant is selected, so remove it from unselected list (make it available)
                await removeUnselectedTenant(tenantId, selectedAccount.id);
            } else {
                // Tenant is not selected, so add it to unselected list (filter it out)
                await addUnselectedTenant(tenantId, selectedAccount.id);
            }
        }

        ext.outputChannel.appendLine(
            l10n.t(
                'Successfully configured Azure tenant filtering. Selected {0} tenant(s) for account {1}',
                selectedTenants.length,
                selectedAccount.label,
            ),
        );

        if (selectedTenants.length > 0) {
            const tenantNames = selectedTenants.map(
                (tenant) => tenant.displayName || tenant.tenantId || l10n.t('Unknown tenant'),
            );
            ext.outputChannel.appendLine(l10n.t('Selected tenants: {0}', tenantNames.join(', ')));
        } else {
            ext.outputChannel.appendLine(
                l10n.t(
                    'No tenants selected. Azure discovery will be filtered to exclude all results for this account.',
                ),
            );
        }

        // Refresh the discovery tree to apply the new filtering
        ext.outputChannel.appendLine(l10n.t('Refreshing Azure discovery tree...'));
        ext.discoveryBranchDataProvider.refresh();

        ext.outputChannel.appendLine(l10n.t('Azure credentials configuration completed successfully.'));

        // Add completion telemetry
        context.telemetry.measurements.executionTimeMs = Date.now() - executeStartTime;
    }

    public shouldExecute(context: CredentialsManagementWizardContext): boolean {
        return !!context.selectedAccount && !context.shouldRestartWizard;
    }
}
