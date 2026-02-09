/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSCodeAzureSubscriptionProvider, type AzureTenant } from '@microsoft/vscode-azext-azureauth';
import { AzureWizardPromptStep, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { type AzureSubscriptionProviderWithFilters } from '../../plugins/api-shared/azure/AzureSubscriptionProviderWithFilters';
import { nonNullValue } from '../../utils/nonNull';
import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';

interface TenantQuickPickItem extends vscode.QuickPickItem {
    tenant?: AzureTenant;
    isCustomOption?: boolean;
    isSignInOption?: boolean;
}

export class PromptTenantStep extends AzureWizardPromptStep<UpdateCredentialsWizardContext> {
    public async prompt(context: UpdateCredentialsWizardContext): Promise<void> {
        // Create async function to provide better loading UX and debugging experience
        const tenantItemsPromise = async (): Promise<TenantQuickPickItem[]> => {
            // Load available tenants from Azure subscription provider
            const tenants = await this.getAvailableTenants(context);
            context.telemetry.measurements.availableTenantsCount = tenants.length;

            // Create quick pick items
            const tenantItems: TenantQuickPickItem[] = [
                {
                    label: l10n.t('Manually enter a custom tenant ID'),
                    iconPath: new vscode.ThemeIcon('edit'),
                    isCustomOption: true,
                    alwaysShow: true,
                },
                {
                    label: l10n.t('Sign in to other Azure accounts to access more tenants'),
                    iconPath: new vscode.ThemeIcon('key'),
                    alwaysShow: true,
                    isSignInOption: true,
                },
                { label: '', kind: vscode.QuickPickItemKind.Separator },
            ];

            // Add available tenants to the list, grouped by account
            tenants.forEach((tenant) => {
                const item: TenantQuickPickItem & { group?: string } = {
                    label: tenant.displayName ?? tenant.tenantId ?? '',
                    detail: tenant.tenantId,
                    description: tenant.defaultDomain,
                    group: tenant.account.label,
                    iconPath: new vscode.ThemeIcon('organization'),
                    tenant,
                };
                tenantItems.push(item);
            });

            return tenantItems;
        };

        const selectedItem = await context.ui.showQuickPick(tenantItemsPromise(), {
            stepName: 'selectTenant',
            placeHolder: l10n.t('Select a tenant for Microsoft Entra ID authentication'),
            suppressPersistence: true,
            loadingPlaceHolder: l10n.t('Loading Tenants…'),
            enableGrouping: true,
            matchOnDescription: true,
        });

        if (selectedItem.isSignInOption) {
            // Handle sign in to other Azure accounts
            await this.handleSignInToOtherAccounts(context);
            await this.showRetryInstructions();

            // Exit wizard - user needs to restart the credentials update flow
            throw new UserCancelledError('Account management completed');
        } else if (selectedItem.isCustomOption) {
            // Show input box for custom tenant ID
            const customTenantId = await context.ui.showInputBox({
                prompt: l10n.t('Enter the tenant ID (GUID)'),
                placeHolder: l10n.t('e.g., 12345678-1234-1234-1234-123456789012 or 12345678123412341234123456789012'),
                validateInput: (input) => this.validateTenantId(input),
            });

            // Normalize tenant ID - add dashes if missing
            const normalizedTenantId = this.normalizeTenantId(customTenantId.trim());

            // Set entraIdAuthConfig with the normalized tenant ID
            context.entraIdAuthConfig = {
                ...context.entraIdAuthConfig,
                tenantId: normalizedTenantId,
            };
        } else {
            const tenant = nonNullValue(selectedItem.tenant, 'selectedItem.tenant', 'PromptTenantStep.ts');

            // Set entraIdAuthConfig with the selected tenant ID
            context.entraIdAuthConfig = {
                ...context.entraIdAuthConfig,
                tenantId: tenant.tenantId,
            };
        }

        // Add telemetry - track selection method
        if (selectedItem.isSignInOption) {
            context.telemetry.properties.tenantSelectionMethod = 'signInTriggered';
        } else if (selectedItem.isCustomOption) {
            context.telemetry.properties.tenantSelectionMethod = 'custom';
        } else {
            context.telemetry.properties.tenantSelectionMethod = 'fromList';
        }
    }

    public shouldPrompt(context: UpdateCredentialsWizardContext): boolean {
        // Only show this step if Microsoft Entra ID authentication is selected
        return context.selectedAuthenticationMethod === AuthMethodId.MicrosoftEntraID;
    }

    private async getAvailableTenants(_context: UpdateCredentialsWizardContext): Promise<AzureTenant[]> {
        try {
            // Create a new Azure subscription provider to get tenants
            const subscriptionProvider = new VSCodeAzureSubscriptionProvider();
            const tenants = await subscriptionProvider.getTenants();

            return tenants.sort((a: AzureTenant, b: AzureTenant) => {
                // Sort by display name if available, otherwise by tenant ID
                const aName = a.displayName || a.tenantId || '';
                const bName = b.displayName || b.tenantId || '';
                return aName.localeCompare(bName, undefined, { numeric: true });
            });
        } catch {
            // If we can't load tenants, just return empty array
            // User can still use custom tenant ID option
            return [];
        }
    }

    private validateTenantId(input: string): string | undefined {
        if (!input || input.trim().length === 0) {
            return l10n.t('Tenant ID cannot be empty');
        }

        const trimmedInput = input.trim();

        // Validation for GUID format - with or without dashes
        const guidWithDashesRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const guidWithoutDashesRegex = /^[0-9a-f]{32}$/i;

        if (!guidWithDashesRegex.test(trimmedInput) && !guidWithoutDashesRegex.test(trimmedInput)) {
            return l10n.t(
                'Please enter a valid tenant ID in GUID format (e.g., 12345678-1234-1234-1234-123456789012 or 12345678123412341234123456789012)',
            );
        }

        return undefined;
    }

    private normalizeTenantId(tenantId: string): string {
        // If tenant ID already has dashes, return as-is
        if (tenantId.includes('-')) {
            return tenantId;
        }

        // If it's a 32-character hex string without dashes, add them
        if (/^[0-9a-f]{32}$/i.test(tenantId)) {
            return [
                tenantId.slice(0, 8),
                tenantId.slice(8, 12),
                tenantId.slice(12, 16),
                tenantId.slice(16, 20),
                tenantId.slice(20, 32),
            ].join('-');
        }

        // Return as-is if it doesn't match expected pattern
        return tenantId;
    }

    private async handleSignInToOtherAccounts(context: UpdateCredentialsWizardContext): Promise<void> {
        // Add telemetry for credential configuration activation
        context.telemetry.properties.credentialConfigActivated = 'true';
        context.telemetry.properties.nodeProvided = 'false';

        // Create a new Azure subscription provider to trigger sign-in
        const subscriptionProvider = new VSCodeAzureSubscriptionProvider();

        // Call the credentials management function directly
        const { configureAzureCredentials } = await import('../../plugins/api-shared/azure/credentialsManagement');
        await configureAzureCredentials(
            context,
            subscriptionProvider as AzureSubscriptionProviderWithFilters,
            undefined,
        );
    }

    private async showRetryInstructions(): Promise<void> {
        await vscode.window.showInformationMessage(
            l10n.t('Account Management Completed'),
            {
                modal: true,
                detail: l10n.t(
                    'The account management flow has completed.\n\nPlease try updating the credentials again to see your available tenants.',
                ),
            },
            l10n.t('OK'),
        );
    }
}
