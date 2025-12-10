/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureTenant } from '@microsoft/vscode-azext-azureauth';
import { AzureWizardPromptStep, GoBackError, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../../../extensionVariables';
import { nonNullProp, nonNullValue } from '../../../../utils/nonNull';
import { removeUnselectedTenant } from '../subscriptionFiltering/subscriptionFilteringHelpers';
import { type CredentialsManagementWizardContext } from './CredentialsManagementWizardContext';

interface TenantQuickPickItem extends vscode.QuickPickItem {
    tenant?: AzureTenant;
    isSignedIn?: boolean;
    isBackOption?: boolean;
    isExitOption?: boolean;
}

export class AccountTenantsStep extends AzureWizardPromptStep<CredentialsManagementWizardContext> {
    public async prompt(context: CredentialsManagementWizardContext): Promise<void> {
        const selectedAccount = nonNullValue(
            context.selectedAccount,
            'context.selectedAccount',
            'AccountTenantsStep.ts',
        );

        // Get tenants for the selected account from cached data (fetched in SelectAccountStep)
        const getTenantQuickPickItems = (): TenantQuickPickItem[] => {
            const accountInfo = context.allAccountsWithTenantInfo?.find(
                (info) => info.account.id === selectedAccount.id,
            );
            const tenantsWithStatus = accountInfo?.tenantsWithStatus ?? [];

            // Add telemetry
            const unauthenticatedCount = tenantsWithStatus.filter((t) => !t.isSignedIn).length;
            context.telemetry.measurements.totalTenantCount = tenantsWithStatus.length;
            context.telemetry.measurements.unauthenticatedTenantCount = unauthenticatedCount;

            if (tenantsWithStatus.length === 0) {
                context.telemetry.properties.noTenantsAvailable = 'true';
                return [
                    {
                        label: l10n.t('No tenants available for this account'),
                        kind: vscode.QuickPickItemKind.Separator,
                    },
                    {
                        label: l10n.t('Back to account selection'),
                        iconPath: new vscode.ThemeIcon('arrow-left'),
                        isBackOption: true,
                    },
                    { label: '', kind: vscode.QuickPickItemKind.Separator },
                    {
                        label: l10n.t('Exit'),
                        iconPath: new vscode.ThemeIcon('close'),
                        isExitOption: true,
                    },
                ];
            }

            // Build tenant items with sign-in status, sorted by name
            const sortedTenants = [...tenantsWithStatus].sort((a, b) => {
                const aName = a.tenant.displayName ?? a.tenant.tenantId ?? '';
                const bName = b.tenant.displayName ?? b.tenant.tenantId ?? '';
                return aName.localeCompare(bName);
            });

            const tenantItems: TenantQuickPickItem[] = sortedTenants.map(({ tenant, isSignedIn }) => ({
                label: tenant.displayName ?? tenant.tenantId ?? l10n.t('Unknown tenant'),
                description: tenant.tenantId ?? '',
                detail: isSignedIn ? l10n.t('$(pass) Signed in') : l10n.t('$(sign-in) Select to sign in'),
                tenant,
                isSignedIn,
            }));

            return [
                ...tenantItems,
                { label: '', kind: vscode.QuickPickItemKind.Separator },
                {
                    label: l10n.t('Back to account selection'),
                    iconPath: new vscode.ThemeIcon('arrow-left'),
                    isBackOption: true,
                },
                {
                    label: l10n.t('Exit'),
                    iconPath: new vscode.ThemeIcon('close'),
                    isExitOption: true,
                },
            ];
        };

        const selectedItem = await context.ui.showQuickPick(getTenantQuickPickItems(), {
            stepName: 'selectTenant',
            placeHolder: l10n.t('Tenants for "{0}"', selectedAccount.label),
            matchOnDescription: true,
            suppressPersistence: true,
            loadingPlaceHolder: l10n.t('Loading tenants…'),
        });

        // Handle navigation options
        if (selectedItem.isBackOption) {
            // Clear the selected account to go back to selection (keep cache for fast navigation)
            context.selectedAccount = undefined;
            context.selectedTenant = undefined;
            context.telemetry.properties.tenantAction = 'back';

            throw new GoBackError();
        } else if (selectedItem.isExitOption) {
            context.telemetry.properties.tenantAction = 'exit';
            throw new UserCancelledError('exitAccountManagement');
        }

        // User selected a tenant
        const selectedTenant = nonNullValue(selectedItem.tenant, 'selectedItem.tenant', 'AccountTenantsStep.ts');

        if (selectedItem.isSignedIn) {
            // Already signed in - set as selected and go to action step for back/exit options
            context.selectedTenant = selectedTenant;
            context.telemetry.properties.tenantAction = 'selectSignedInTenant';
        } else {
            // Not signed in - start sign-in directly (no extra step)
            context.telemetry.properties.tenantAction = 'signIn';
            await this.handleSignIn(context, selectedTenant);
            // Clear cache to refresh sign-in status after sign-in attempt
            context.allAccountsWithTenantInfo = [];
            // After sign-in attempt, go back to account selection to re-fetch all data
            context.selectedAccount = undefined;
            throw new GoBackError();
        }
    }

    private async handleSignIn(context: CredentialsManagementWizardContext, tenant: AzureTenant): Promise<void> {
        const tenantId = nonNullProp(tenant, 'tenantId', 'tenant.tenantId', 'AccountTenantsStep.ts');
        const tenantName = tenant.displayName ?? tenantId;
        const accountId = tenant.account.id;

        try {
            ext.outputChannel.appendLine(l10n.t('Starting sign-in to tenant: {0}', tenantName));

            // Sign in to the specific tenant
            const success = await context.azureSubscriptionProvider.signIn(tenantId, tenant.account);

            if (success) {
                ext.outputChannel.appendLine(l10n.t('Successfully signed in to tenant: {0}', tenantName));
                void vscode.window.showInformationMessage(l10n.t('Successfully signed in to {0}', tenantName));

                // Auto-select the newly authenticated tenant by removing it from the unselected list
                // This ensures the tenant's subscriptions will appear in the Discovery View
                await removeUnselectedTenant(tenantId, accountId);
                ext.outputChannel.appendLine(
                    l10n.t('Tenant {0} has been automatically included in subscription discovery', tenantName),
                );
            } else {
                ext.outputChannel.appendLine(l10n.t('Sign-in to tenant was cancelled or failed: {0}', tenantName));
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            ext.outputChannel.appendLine(l10n.t('Failed to sign in to tenant {0}: {1}', tenantName, errorMessage));
            throw error;
        }
    }

    public shouldPrompt(context: CredentialsManagementWizardContext): boolean {
        // Only show this step if we have a selected account but no selected tenant
        return !!context.selectedAccount && !context.selectedTenant;
    }
}
