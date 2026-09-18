/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSCodeAzureSubscriptionProvider, type AzureTenant } from '@microsoft/vscode-azext-azureauth';
import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { type AzureSubscriptionProviderWithFilters } from '../../plugins/api-shared/azure/AzureSubscriptionProviderWithFilters';
import { traceTenantLookup, type TenantLookupResult } from '../../plugins/api-shared/azure/traceTenantLookup';
import { traceAuthFlow } from '../../utils/authTrace';
import { nonNullValue } from '../../utils/nonNull';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

const TENANT_LOOKUP_TIMEOUT_MS = 5_000;
const TENANT_RETRY_TIMEOUT_MS = 30_000;

interface TenantQuickPickItem extends vscode.QuickPickItem {
    tenant?: AzureTenant;
    isCustomOption?: boolean;
    isSignInOption?: boolean;
    isRetryOption?: boolean;
}

export class PromptTenantStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const subscriptionProvider = new VSCodeAzureSubscriptionProvider();
        let accountManagementUsed = false;
        let lookupTimeoutMs = TENANT_LOOKUP_TIMEOUT_MS;

        if (!(await this.isSignedIn(subscriptionProvider))) {
            await this.handleSignInToOtherAccounts(context, subscriptionProvider);
            accountManagementUsed = true;
        }

        // Create async function to provide better loading UX and debugging experience
        const tenantItemsPromise = async (): Promise<TenantQuickPickItem[]> => {
            // Load available tenants from Azure subscription provider
            const { tenants, status } = await this.getAvailableTenants(subscriptionProvider, lookupTimeoutMs);
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
                    label: l10n.t('Manage Azure Accounts…'),
                    detail: l10n.t(
                        'Sign in to additional accounts or authenticate with other tenants to see more options.',
                    ),
                    iconPath: new vscode.ThemeIcon('key'),
                    alwaysShow: true,
                    isSignInOption: true,
                },
                { label: '', kind: vscode.QuickPickItemKind.Separator },
            ];

            if (tenants.length === 0) {
                const detail =
                    status === 'timeout'
                        ? l10n.t('Loading tenants timed out after {0} seconds.', lookupTimeoutMs / 1000)
                        : status === 'error'
                          ? l10n.t('Unable to load tenants. See the DocumentDB for VS Code output for details.')
                          : l10n.t('No tenants were returned for the available Azure accounts.');
                tenantItems.unshift({
                    label: l10n.t('Retry loading tenants'),
                    detail,
                    iconPath: new vscode.ThemeIcon('refresh'),
                    isRetryOption: true,
                    alwaysShow: true,
                });
            }

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

            traceAuthFlow('newConnection.tenantPicker.ready', {
                status,
                tenantCount: tenants.length,
                timeoutMs: lookupTimeoutMs,
                options: tenants.length ? 'manual,manageAccounts,tenant' : 'retry,manual,manageAccounts',
            });
            return tenantItems;
        };

        let selectedItem: TenantQuickPickItem;
        do {
            selectedItem = await context.ui.showQuickPick(tenantItemsPromise(), {
                stepName: 'selectTenant',
                placeHolder: l10n.t('Select a tenant for Microsoft Entra ID authentication'),
                suppressPersistence: true,
                loadingPlaceHolder: l10n.t('Loading Tenants…'),
                enableGrouping: true,
                matchOnDescription: true,
            });

            traceAuthFlow('newConnection.tenantPicker.selection', {
                choice: selectedItem.isRetryOption
                    ? 'retry'
                    : selectedItem.isSignInOption
                      ? 'manageAccounts'
                      : selectedItem.isCustomOption
                        ? 'manual'
                        : 'tenant',
            });
            if (selectedItem.isSignInOption) {
                await this.handleSignInToOtherAccounts(context, subscriptionProvider);
                accountManagementUsed = true;
            }
            if (selectedItem.isRetryOption) {
                lookupTimeoutMs = TENANT_RETRY_TIMEOUT_MS;
            }
        } while (selectedItem.isSignInOption || selectedItem.isRetryOption);

        if (selectedItem.isCustomOption) {
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
        if (accountManagementUsed) {
            context.telemetry.properties.tenantSelectionMethod = 'signInTriggered';
        } else if (selectedItem.isCustomOption) {
            context.telemetry.properties.tenantSelectionMethod = 'custom';
        } else {
            context.telemetry.properties.tenantSelectionMethod = 'fromList';
        }
    }

    public configureBeforePrompt(context: NewConnectionWizardContext): void {
        const shouldPrompt = this.shouldPrompt(context);
        traceAuthFlow('newConnection.tenantPicker.gate', {
            skipped: !shouldPrompt,
            reason: shouldPrompt ? 'interactiveEntra' : 'notInteractiveEntra',
        });
    }

    public shouldPrompt(context: NewConnectionWizardContext): boolean {
        // Only show this step if Microsoft Entra ID authentication is selected
        return context.selectedAuthenticationMethod === AuthMethodId.MicrosoftEntraID;
    }

    private async isSignedIn(subscriptionProvider: VSCodeAzureSubscriptionProvider): Promise<boolean> {
        try {
            return await traceTenantLookup('newConnection.isSignedIn', () => subscriptionProvider.isSignedIn(), {
                timeoutMs: TENANT_LOOKUP_TIMEOUT_MS,
                fallbackValue: true,
            });
        } catch {
            return true;
        }
    }

    private async getAvailableTenants(
        subscriptionProvider: VSCodeAzureSubscriptionProvider,
        timeoutMs: number,
    ): Promise<TenantLookupResult> {
        let timedOut = false;
        try {
            const tenants = await traceTenantLookup(
                'newConnection.getTenants',
                () => subscriptionProvider.getTenants(),
                {
                    timeoutMs,
                    fallbackValue: [],
                    onTimeout: () => {
                        timedOut = true;
                    },
                },
            );

            tenants.sort((a: AzureTenant, b: AzureTenant) => {
                // Sort by display name if available, otherwise by tenant ID
                const aName = a.displayName || a.tenantId || '';
                const bName = b.displayName || b.tenantId || '';
                return aName.localeCompare(bName, undefined, { numeric: true });
            });
            return { tenants, status: timedOut ? 'timeout' : 'success' };
        } catch {
            // If we can't load tenants, just return empty array
            // User can still use custom tenant ID option
            return { tenants: [], status: 'error' };
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

    private async handleSignInToOtherAccounts(
        context: NewConnectionWizardContext,
        subscriptionProvider: VSCodeAzureSubscriptionProvider,
    ): Promise<void> {
        // Add telemetry for credential configuration activation
        context.telemetry.properties.credentialConfigActivated = 'true';
        context.telemetry.properties.nodeProvided = 'false';

        // Call the credentials management function directly
        const { configureAzureCredentials } = await import('../../plugins/api-shared/azure/credentialsManagement');
        await configureAzureCredentials(
            context,
            subscriptionProvider as AzureSubscriptionProviderWithFilters,
            undefined,
        );
    }
}
