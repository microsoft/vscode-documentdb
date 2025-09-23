/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureTenant } from '@microsoft/vscode-azext-azureauth';
import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../../../extensionVariables';
import { nonNullValue } from '../../../../utils/nonNull';
import { type CredentialsManagementWizardContext } from './CredentialsManagementWizardContext';

interface TenantQuickPickItem extends vscode.QuickPickItem {
    tenant?: AzureTenant;
    isSelectAllOption?: boolean;
    isClearAllOption?: boolean;
}

export class SelectTenantsStep extends AzureWizardPromptStep<CredentialsManagementWizardContext> {
    public async prompt(context: CredentialsManagementWizardContext): Promise<void> {
        // Get available tenants for the selected account
        const tenants = await this.getAvailableTenantsForAccount(context);

        // Initialize availableTenants map if not exists
        if (!context.availableTenants) {
            context.availableTenants = new Map();
        }

        // Store tenants for this account
        const selectedAccount = nonNullValue(
            context.selectedAccount,
            'context.selectedAccount',
            'SelectTenantsStep.ts',
        );
        context.availableTenants.set(selectedAccount.id, tenants);

        // Store all tenants for the selected account in context for ExecuteStep
        context.allTenants = tenants;

        if (tenants.length === 0) {
            void vscode.window.showWarningMessage(
                l10n.t(
                    'No tenants found for the selected account. Please try signing in again or selecting a different account.',
                ),
            );
            return;
        }

        // Get currently selected tenant IDs from storage
        const { getSelectedTenantIds } = await import('../subscriptionFiltering');
        const allTenantKeys = tenants.map((tenant) => `${tenant.tenantId}/${selectedAccount.id}`);
        const currentlySelectedTenants = getSelectedTenantIds(allTenantKeys);
        const currentlySelectedTenantIds = new Set(currentlySelectedTenants.map((id) => id.split('/')[0]));

        // Create quick pick items with checkboxes
        const tenantItems: TenantQuickPickItem[] = this.createTenantPickItems(tenants, currentlySelectedTenantIds);

        // Add control options
        const controlItems: TenantQuickPickItem[] = [
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                label: l10n.t('$(check-all) Select All'),
                detail: l10n.t('Select all tenants for this account'),
                isSelectAllOption: true,
            },
            {
                label: l10n.t('$(clear-all) Clear All'),
                detail: l10n.t('Clear all selected tenants for this account'),
                isClearAllOption: true,
            },
        ];

        const allItems = [...tenantItems, ...controlItems];

        const selectedItems = await context.ui.showQuickPick(allItems, {
            stepName: 'selectTenants',
            placeHolder: l10n.t('Select tenants to include in discovery (multiple selection)'),
            canPickMany: true,
            matchOnDescription: true,
            suppressPersistence: true,
            loadingPlaceHolder: 'Loading...',
        });

        // Handle control options
        if (selectedItems.some((item) => item.isSelectAllOption)) {
            context.selectedTenants = tenants;
        } else if (selectedItems.some((item) => item.isClearAllOption)) {
            context.selectedTenants = [];
        } else {
            // Filter out control items and extract tenants
            const tenantSelections = selectedItems.filter((item) => item.tenant);
            context.selectedTenants = tenantSelections.map((item) =>
                nonNullValue(item.tenant, 'item.tenant', 'SelectTenantsStep.ts'),
            );
        }
    }

    public shouldPrompt(context: CredentialsManagementWizardContext): boolean {
        return !!context.selectedAccount && !context.shouldRestartWizard;
    }

    private async getAvailableTenantsForAccount(context: CredentialsManagementWizardContext): Promise<AzureTenant[]> {
        try {
            const selectedAccount = nonNullValue(
                context.selectedAccount,
                'context.selectedAccount',
                'SelectTenantsStep.ts',
            );

            // Get tenants for the specific account
            const tenants = await context.azureSubscriptionProvider.getTenants(selectedAccount);

            return tenants.sort((a, b) => {
                // Sort by display name if available, otherwise by tenant ID
                const aName = a.displayName || a.tenantId || '';
                const bName = b.displayName || b.tenantId || '';
                return aName.localeCompare(bName);
            });
        } catch (error) {
            ext.outputChannel.appendLine(
                l10n.t(
                    'Failed to retrieve tenants for account: {0}',
                    error instanceof Error ? error.message : String(error),
                ),
            );
            return [];
        }
    }

    private createTenantPickItems(
        tenants: AzureTenant[],
        currentlySelectedTenantIds: Set<string>,
    ): TenantQuickPickItem[] {
        return tenants.map((tenant) => {
            const tenantId = tenant.tenantId || '';
            const displayName = tenant.displayName || tenantId;
            const isSelected = currentlySelectedTenantIds.has(tenantId);

            return {
                label: displayName,
                description: tenantId,
                detail: tenant.domains?.[0] || undefined, // Show primary domain if available
                iconPath: new vscode.ThemeIcon('organization'),
                picked: isSelected,
                tenant,
            };
        });
    }
}
