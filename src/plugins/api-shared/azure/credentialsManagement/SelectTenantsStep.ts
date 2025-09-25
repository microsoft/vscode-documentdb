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
import { isTenantFilteredOut } from '../subscriptionFiltering';
import { type CredentialsManagementWizardContext } from './CredentialsManagementWizardContext';

interface TenantQuickPickItem extends vscode.QuickPickItem {
    tenant?: AzureTenant;
}

export class SelectTenantsStep extends AzureWizardPromptStep<CredentialsManagementWizardContext> {
    public async prompt(context: CredentialsManagementWizardContext): Promise<void> {
        const selectedAccount = nonNullValue(
            context.selectedAccount,
            'context.selectedAccount',
            'SelectTenantsStep.ts',
        );

        // Create async function to provide better loading UX and debugging experience
        const getTenantQuickPickItems = async (): Promise<TenantQuickPickItem[]> => {
            const tenants = await this.getAvailableTenantsForAccount(context);

            // Initialize availableTenants map if not exists
            if (!context.availableTenants) {
                context.availableTenants = new Map();
            }

            // Store tenants for this account
            context.availableTenants.set(selectedAccount.id, tenants);

            // Store all tenants for the selected account in context for ExecuteStep
            context.allTenants = tenants;

            if (tenants.length === 0) {
                void vscode.window.showWarningMessage(
                    l10n.t(
                        'No tenants found for the selected account. Please try signing in again or selecting a different account.',
                    ),
                );
                return [];
            }

            // Create quick pick items
            const tenantItems: TenantQuickPickItem[] = tenants.map((tenant) => {
                const tenantId = tenant.tenantId || '';
                const displayName = tenant.displayName || tenantId;

                return {
                    label: displayName,
                    detail: tenantId,
                    description: tenant.defaultDomain ?? undefined,
                    iconPath: new vscode.ThemeIcon('organization'),
                    tenant,
                };
            });

            return tenantItems;
        };

        const selectedItems = await context.ui.showQuickPick(getTenantQuickPickItems(), {
            stepName: 'selectTenants',
            placeHolder: l10n.t('Select tenants to use'),
            canPickMany: true,
            matchOnDescription: true,
            suppressPersistence: true,
            loadingPlaceHolder: l10n.t('Loading Tenants…'),
            isPickSelected: (pick) => {
                const tenantPick = pick as TenantQuickPickItem;

                // Check if this tenant is currently selected (not filtered out)
                if (tenantPick.tenant?.tenantId) {
                    return !isTenantFilteredOut(tenantPick.tenant.tenantId, selectedAccount.id);
                }

                return false;
            },
        });

        // Extract selected tenants
        context.selectedTenants = selectedItems.map((item) =>
            nonNullValue(item.tenant, 'item.tenant', 'SelectTenantsStep.ts'),
        );
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
}
