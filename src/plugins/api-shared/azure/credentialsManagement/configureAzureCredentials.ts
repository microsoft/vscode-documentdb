/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../../../extensionVariables';
import { type AzureSubscriptionProviderWithFilters } from '../AzureSubscriptionProviderWithFilters';
import { AzureContextProperties } from '../wizard/AzureContextProperties';
import { type CredentialsManagementWizardContext } from './CredentialsManagementWizardContext';
import { ExecuteStep } from './ExecuteStep';
import { SelectAccountStep } from './SelectAccountStep';
import { SelectTenantsStep } from './SelectTenantsStep';

/**
 * Configures Azure credentials by allowing the user to select accounts and tenants
 * for filtering Azure discovery results.
 *
 * @param context - The action context
 * @param azureSubscriptionProvider - The Azure subscription provider with filtering capabilities
 */
export async function configureAzureCredentials(
    context: IActionContext,
    azureSubscriptionProvider: AzureSubscriptionProviderWithFilters,
): Promise<void> {
    let wizardContext: CredentialsManagementWizardContext;

    do {
        try {
            ext.outputChannel.appendLine(l10n.t('Starting Azure credentials configuration wizard'));

            // Create wizard context
            wizardContext = {
                ...context,
                [AzureContextProperties.SelectedAccount]: undefined,
                [AzureContextProperties.SelectedTenants]: undefined,
                azureSubscriptionProvider,
                shouldRestartWizard: false,
            };

            // Create and configure the wizard
            const wizard = new AzureWizard(wizardContext, {
                title: l10n.t('Manage Azure Credentials'),
                promptSteps: [new SelectAccountStep(), new SelectTenantsStep()],
                executeSteps: [new ExecuteStep()],
            });

            // Execute the wizard
            await wizard.prompt();
            await wizard.execute();

            if (wizardContext.shouldRestartWizard) {
                ext.outputChannel.appendLine(l10n.t('Restarting wizard after account sign-in...'));
            } else {
                ext.outputChannel.appendLine(l10n.t('Azure credentials configuration completed successfully.'));
            }
        } catch (error) {
            if (error instanceof UserCancelledError) {
                // User cancelled
                ext.outputChannel.appendLine(l10n.t('Azure credentials configuration was cancelled by user.'));
                return;
            }

            // Any other error - don't retry, just throw
            const errorMessage = error instanceof Error ? error.message : String(error);
            ext.outputChannel.appendLine(l10n.t('Azure credentials configuration failed: {0}', errorMessage));
            void vscode.window.showErrorMessage(l10n.t('Failed to configure Azure credentials: {0}', errorMessage));
            throw error;
        }
    } while (wizardContext.shouldRestartWizard);
}
