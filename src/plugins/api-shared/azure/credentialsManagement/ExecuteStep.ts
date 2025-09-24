/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../../../extensionVariables';
import { nonNullValue } from '../../../../utils/nonNull';
import { type CredentialsManagementWizardContext } from './CredentialsManagementWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<CredentialsManagementWizardContext> {
    public priority: number = 100;

    public async execute(context: CredentialsManagementWizardContext): Promise<void> {
        const selectedAccount = nonNullValue(context.selectedAccount, 'context.selectedAccount', 'ExecuteStep.ts');

        const selectedTenants = context.selectedTenants || [];

        ext.outputChannel.appendLine(
            l10n.t('Saving Azure credentials configuration for account: {0}', selectedAccount.label),
        );

        // Create tenant/account selection identifiers in the format: "tenantId/accountId"
        const tenantAccountIds = selectedTenants.map((tenant) => `${tenant.tenantId || ''}/${selectedAccount.id}`);

        // Get all available tenants for this account to calculate the full set
        const allTenantsForAccount = nonNullValue(context.allTenants, 'context.allTenants', 'ExecuteStep.ts');
        const allTenantKeys = allTenantsForAccount.map((tenant) => `${tenant.tenantId}/${selectedAccount.id}`);

        // Calculate unselected tenants (inverse logic to match Azure Resource Groups)
        const unselectedTenants = allTenantKeys.filter((tenant) => !tenantAccountIds.includes(tenant));

        // Save unselected tenants to workspace configuration (with fallback to globalState)
        try {
            const config = vscode.workspace.getConfiguration('azureResourceGroups');
            await config.update('unselectedTenants', unselectedTenants, vscode.ConfigurationTarget.Global);
        } catch (error) {
            console.error(
                'Unable to update Azure Resource Groups tenant configuration, using fallback storage.',
                error,
            );
        } finally {
            // Always update our fallback storage regardless of primary storage success
            await ext.context.globalState.update('azure-discovery.unselectedTenants', unselectedTenants);
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
    }

    public shouldExecute(context: CredentialsManagementWizardContext): boolean {
        return !!context.selectedAccount && !context.shouldRestartWizard;
    }
}
