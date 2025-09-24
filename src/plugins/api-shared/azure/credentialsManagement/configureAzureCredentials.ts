/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../../../extensionVariables';
import { AzureSubscriptionProviderWithFilters } from '../AzureSubscriptionProviderWithFilters';
import { AzureContextProperties } from '../wizard/AzureContextProperties';
import { type CredentialsManagementWizardContext } from './CredentialsManagementWizardContext';
import { ExecuteStep } from './ExecuteStep';
import { SelectAccountStep } from './SelectAccountStep';
import { SelectTenantsStep } from './SelectTenantsStep';

/**
 * Configures Azure credentials by allowing the user to select accounts and tenants
 * for filtering Azure discovery results. This replaces the TODO in AzureDiscoveryProvider.
 *
 * @param context - The action context
 * @param azureSubscriptionProvider - The Azure subscription provider with filtering capabilities
 */
export async function configureAzureCredentials(
    context: IActionContext,
    azureSubscriptionProvider: AzureSubscriptionProviderWithFilters,
): Promise<void> {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            attempt++;
            ext.outputChannel.appendLine(
                l10n.t('Starting Azure credentials configuration wizard (attempt {0}/{1})', attempt, maxRetries),
            );

            // Create wizard context
            const wizardContext: CredentialsManagementWizardContext = {
                ...context,
                [AzureContextProperties.SelectedAccount]: undefined,
                [AzureContextProperties.SelectedTenants]: undefined,
                azureSubscriptionProvider,
                shouldRestartWizard: false,
                newAccountSignedIn: false,
            };

            // Create and configure the wizard
            const wizard = new AzureWizard(wizardContext, {
                title: l10n.t('Configure Azure Credentials'),
                promptSteps: [new SelectAccountStep(), new SelectTenantsStep()],
                executeSteps: [new ExecuteStep()],
            });

            // Execute the wizard
            await wizard.prompt();
            await wizard.execute();

            // Success - exit the retry loop
            ext.outputChannel.appendLine(l10n.t('Azure credentials configuration completed successfully.'));
            break;
        } catch (error) {
            if (error instanceof UserCancelledError) {
                // User cancelled or no restart needed
                ext.outputChannel.appendLine(l10n.t('Azure credentials configuration was cancelled by user.'));
                return;
            }

            // Other errors
            const errorMessage = error instanceof Error ? error.message : String(error);
            ext.outputChannel.appendLine(
                l10n.t(
                    'Azure credentials configuration failed (attempt {0}/{1}): {2}',
                    attempt,
                    maxRetries,
                    errorMessage,
                ),
            );

            if (attempt >= maxRetries) {
                // Final attempt failed
                void vscode.window.showErrorMessage(
                    l10n.t('Failed to configure Azure credentials after {0} attempts: {1}', maxRetries, errorMessage),
                );
                throw error;
            }

            // Wait before retrying
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }
}

/**
 * Displays current Azure credentials configuration status
 *
 * @param _context - The action context (not used but required for command pattern)
 */
export async function showAzureCredentialsStatus(_context: IActionContext): Promise<void> {
    try {
        // For status display, we need to get all available tenants to use the filtering function
        const azureSubscriptionProvider = new AzureSubscriptionProviderWithFilters();
        const allTenants = await azureSubscriptionProvider.getTenants();

        const { isTenantFilteredOut } = await import('../subscriptionFiltering');

        azureSubscriptionProvider.dispose(); // Clean up

        // Check which tenants are currently selected (not filtered out)
        const selectedTenantKeys: string[] = [];
        for (const tenant of allTenants) {
            if (tenant.tenantId && !isTenantFilteredOut(tenant.tenantId, tenant.account.id)) {
                selectedTenantKeys.push(`${tenant.tenantId}/${tenant.account.id}`);
            }
        }

        if (selectedTenantKeys.length === 0) {
            void vscode.window.showInformationMessage(
                l10n.t('No Azure tenant filters are currently configured. All tenants will be included in discovery.'),
            );
            return;
        }

        // Group by account
        const accountTenantMap = new Map<string, string[]>();
        for (const tenantAccountId of selectedTenantKeys) {
            const [tenantId, accountId] = tenantAccountId.split('/');
            if (!accountTenantMap.has(accountId)) {
                accountTenantMap.set(accountId, []);
            }
            accountTenantMap.get(accountId)?.push(tenantId);
        }

        const statusMessages: string[] = [];
        for (const [accountId, tenantIds] of accountTenantMap) {
            statusMessages.push(l10n.t('Account {0}: {1} tenant(s) selected', accountId, tenantIds.length));
        }

        const fullMessage = l10n.t(
            'Azure tenant filtering is active:\n\n{0}\n\nUse "Configure Azure Credentials" to modify these settings.',
            statusMessages.join('\n'),
        );

        void vscode.window.showInformationMessage(fullMessage);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(l10n.t('Failed to retrieve Azure credentials status: {0}', errorMessage));
    }
}

/**
 * Clears all Azure credentials configuration
 *
 * @param _context - The action context (not used but required for command pattern)
 */
export async function clearAzureCredentialsConfiguration(_context: IActionContext): Promise<void> {
    try {
        const confirmResult = await vscode.window.showWarningMessage(
            l10n.t(
                'This will clear all Azure tenant filtering configuration. Azure discovery will include all tenants. Continue?',
            ),
            { modal: true },
            l10n.t('Clear Configuration'),
        );

        if (confirmResult) {
            // Clear tenant filtering by setting empty unselected tenants array
            try {
                const config = vscode.workspace.getConfiguration('azureResourceGroups');
                await config.update('unselectedTenants', [], vscode.ConfigurationTarget.Global);
            } catch (error) {
                console.error(
                    'Unable to update Azure Resource Groups tenant configuration, using fallback storage.',
                    error,
                );
            } finally {
                // Always update our fallback storage regardless of primary storage success
                await ext.context.globalState.update('azure-discovery.unselectedTenants', []);
            }

            ext.outputChannel.appendLine(l10n.t('Azure credentials configuration cleared.'));
            ext.discoveryBranchDataProvider.refresh();

            void vscode.window.showInformationMessage(
                l10n.t('Azure credentials configuration has been cleared. Discovery will now include all tenants.'),
            );
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(
            l10n.t('Failed to clear Azure credentials configuration: {0}', errorMessage),
        );
    }
}
