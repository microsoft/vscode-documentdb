/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../../../extensionVariables';
import { ExecuteStep } from './ExecuteStep';
import { type FilteringWizardContext } from './FilteringWizardContext';
import { InitializeFilteringStep } from './InitializeFilteringStep';

/**
 * Configures the Azure subscription filter using the wizard pattern.
 */
export async function configureAzureSubscriptionFilter(
    context: IActionContext,
    azureSubscriptionProvider: VSCodeAzureSubscriptionProvider,
): Promise<void> {
    context.telemetry.properties.subscriptionFiltering = 'configureAzureSubscriptionFilter';

    /**
     * Ensure the user is signed in to Azure
     */
    if (!(await azureSubscriptionProvider.isSignedIn())) {
        context.telemetry.properties.subscriptionFilteringResult = 'Failed';
        context.telemetry.properties.subscriptionFilteringError = 'NotSignedIn';
        const signIn: vscode.MessageItem = { title: l10n.t('Sign In') };
        void vscode.window
            .showInformationMessage(l10n.t('You are not signed in to Azure. Sign in and retry.'), signIn)
            .then(async (input) => {
                if (input === signIn) {
                    await azureSubscriptionProvider.signIn();
                    ext.discoveryBranchDataProvider.refresh();
                }
            });

        // Return so that the signIn flow can be completed before continuing
        return;
    }

    // Create wizard context
    const wizardContext: FilteringWizardContext = {
        ...context,
        azureSubscriptionProvider,
    };

    // Create and run wizard
    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Configure Azure Discovery Filters'),
        promptSteps: [new InitializeFilteringStep()],
        executeSteps: [new ExecuteStep()],
    });

    try {
        await wizard.prompt();
        await wizard.execute();
        context.telemetry.properties.subscriptionFilteringResult = 'Succeeded';
    } catch (error) {
        context.telemetry.properties.subscriptionFilteringResult = 'Failed';
        context.telemetry.properties.subscriptionFilteringError =
            error instanceof Error ? error.message : String(error);
        throw error;
    }
}
