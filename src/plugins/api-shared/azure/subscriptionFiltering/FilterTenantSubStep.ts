/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureTenant } from '@microsoft/vscode-azext-azureauth';
import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { nonNullValue } from '../../../../utils/nonNull';
import { type FilteringWizardContext } from './FilteringWizardContext';

interface TenantQuickPickItem extends vscode.QuickPickItem {
    tenant?: AzureTenant;
}

export class FilterTenantSubStep extends AzureWizardPromptStep<FilteringWizardContext> {
    public async prompt(context: FilteringWizardContext): Promise<void> {
        const tenants = context.availableTenants || [];

        // Add telemetry for tenant filtering
        context.telemetry.measurements.availableTenantsForFilteringCount = tenants.length;

        if (tenants.length === 0) {
            void vscode.window.showWarningMessage(
                l10n.t('No tenants found. Please try signing in again or check your Azure permissions.'),
            );
            return;
        }

        // Create quick pick items for tenants (data is preloaded, no async needed)
        const tenantItems: TenantQuickPickItem[] = tenants.map((tenant) => {
            return {
                label: tenant.displayName ?? tenant.tenantId ?? '',
                detail: tenant.tenantId,
                description: tenant.defaultDomain,
                group: tenant.account.label,
                iconPath: new vscode.ThemeIcon('organization'),
                tenant,
            };
        });

        const selectedItems = await context.ui.showQuickPick(tenantItems, {
            stepName: 'filterTenants',
            placeHolder: l10n.t('Select tenants to include in subscription discovery'),
            canPickMany: true,
            enableGrouping: true,
            matchOnDescription: true,
            suppressPersistence: true,
            loadingPlaceHolder: l10n.t('Loading Tenant Filter Options…'),
            isPickSelected: (pick) => {
                const tenantPick = pick as TenantQuickPickItem;

                if (!tenantPick.tenant?.tenantId) {
                    return true; // Default to selected if no tenant ID
                }

                // Use the preinitialized selectedTenants from context (handles both initial and going back scenarios)
                if (context.selectedTenants && context.selectedTenants.length > 0) {
                    return context.selectedTenants.some(
                        (selectedTenant) => selectedTenant.tenantId === tenantPick.tenant?.tenantId,
                    );
                }

                // Fallback to true if no selectedTenants (shouldn't happen with proper initialization)
                return true;
            },
        });

        // Extract selected tenants
        context.selectedTenants = selectedItems.map((item) =>
            nonNullValue(item.tenant, 'item.tenant', 'FilterTenantSubStep.ts'),
        );

        // Add telemetry for tenant selection
        const totalTenants = context.availableTenants?.length ?? 0;
        context.telemetry.measurements.selectedTenantsForFilteringCount = selectedItems.length;
        context.telemetry.measurements.unselectedTenantsForFilteringCount = totalTenants - selectedItems.length;
        context.telemetry.properties.allTenantsSelectedForFiltering = (
            selectedItems.length === totalTenants
        ).toString();
        context.telemetry.properties.noTenantsSelectedForFiltering = (selectedItems.length === 0).toString();
    }

    public shouldPrompt(): boolean {
        // The decision has been made in the init step when the subwizard was constructed
        return true;
    }
}
