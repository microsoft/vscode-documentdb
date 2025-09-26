/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzureWizard,
    callWithTelemetryAndErrorHandling,
    UserCancelledError,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../../../extensionVariables';
import { isTreeElementWithContextValue } from '../../../../tree/TreeElementWithContextValue';
import { type AzureSubscriptionProviderWithFilters } from '../AzureSubscriptionProviderWithFilters';
import { AccountActionsStep } from './AccountActionsStep';
import { type CredentialsManagementWizardContext } from './CredentialsManagementWizardContext';
import { ExecuteStep } from './ExecuteStep';
import { SelectAccountStep } from './SelectAccountStep';

/**
 * Internal implementation of Azure account management.
 */
async function configureAzureCredentialsInternal(
    context: IActionContext,
    azureSubscriptionProvider: AzureSubscriptionProviderWithFilters,
): Promise<void> {
    const startTime = Date.now();
    context.telemetry.properties.credentialsManagementAction = 'configure';

    try {
        ext.outputChannel.appendLine(l10n.t('Starting Azure account management wizard'));

        // Create wizard context
        const wizardContext: CredentialsManagementWizardContext = {
            ...context,
            selectedAccount: undefined,
            azureSubscriptionProvider,
        };

        // Create and configure the wizard
        const wizard = new AzureWizard(wizardContext, {
            title: l10n.t('Manage Azure Accounts'),
            promptSteps: [new SelectAccountStep(), new AccountActionsStep()],
            executeSteps: [new ExecuteStep()],
        });

        // Execute the wizard
        await wizard.prompt();
        await wizard.execute();

        // Success telemetry
        context.telemetry.measurements.credentialsManagementDurationMs = Date.now() - startTime;
        context.telemetry.properties.credentialsManagementResult = 'Succeeded';
    } catch (error) {
        context.telemetry.measurements.credentialsManagementDurationMs = Date.now() - startTime;

        if (error instanceof UserCancelledError) {
            if (error.message === 'accountAddedSuccessfully') {
                // Account was successfully added
                context.telemetry.properties.credentialsManagementResult = 'Succeeded';
                context.telemetry.properties.accountAdded = 'true';
                ext.outputChannel.appendLine(l10n.t('Azure account added successfully.'));
                return;
            } else {
                // User cancelled
                context.telemetry.properties.credentialsManagementResult = 'Canceled';
                ext.outputChannel.appendLine(l10n.t('Azure account management was cancelled by user.'));
                return;
            }
        }

        // Any other error - don't retry, just throw
        context.telemetry.properties.credentialsManagementResult = 'Failed';
        context.telemetry.properties.credentialsManagementError = error instanceof Error ? error.name : 'UnknownError';
        const errorMessage = error instanceof Error ? error.message : String(error);
        ext.outputChannel.appendLine(l10n.t('Azure account management failed: {0}', errorMessage));
        throw error;
    }
}

/**
 * Configures Azure credentials by allowing the user to select accounts and tenants
 * for filtering Azure discovery results.
 *
 * @param context - The action context
 * @param azureSubscriptionProvider - The Azure subscription provider with filtering capabilities
 * @param node - Optional tree node from which the account management was initiated
 */
export async function configureAzureCredentials(
    context: IActionContext,
    azureSubscriptionProvider: AzureSubscriptionProviderWithFilters,
    node?: unknown,
): Promise<void> {
    return await callWithTelemetryAndErrorHandling(
        'serviceDiscovery.configureAzureCredentials',
        async (telemetryContext: IActionContext) => {
            // Track node context information
            telemetryContext.telemetry.properties.nodeProvided = node ? 'true' : 'false';
            if (node && isTreeElementWithContextValue(node)) {
                telemetryContext.telemetry.properties.nodeContextValue = node.contextValue;
            }

            // Pass through other telemetry properties from the calling context
            if (context.telemetry.properties.discoveryProviderId) {
                telemetryContext.telemetry.properties.discoveryProviderId =
                    context.telemetry.properties.discoveryProviderId;
            }

            await configureAzureCredentialsInternal(telemetryContext, azureSubscriptionProvider);

            // Copy the credentials management result to the outer context so providers can access it
            if (telemetryContext.telemetry.properties.credentialsManagementResult) {
                context.telemetry.properties.credentialsManagementResult =
                    telemetryContext.telemetry.properties.credentialsManagementResult;
            }
        },
    );
}
