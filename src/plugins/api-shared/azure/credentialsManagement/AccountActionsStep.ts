/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, GoBackError, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { nonNullValue } from '../../../../utils/nonNull';
import { type CredentialsManagementWizardContext } from './CredentialsManagementWizardContext';

interface AccountActionQuickPickItem extends vscode.QuickPickItem {
    action?: 'back' | 'exit';
}

export class AccountActionsStep extends AzureWizardPromptStep<CredentialsManagementWizardContext> {
    public async prompt(context: CredentialsManagementWizardContext): Promise<void> {
        const selectedAccount = nonNullValue(
            context.selectedAccount,
            'context.selectedAccount',
            'AccountActionsStep.ts',
        );

        // Create action items for the selected account
        const actionItems: AccountActionQuickPickItem[] = [
            {
                label: l10n.t('Back to account selection'),
                detail: l10n.t('Return to the account list'),
                iconPath: new vscode.ThemeIcon('arrow-left'),
                action: 'back',
            },
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                label: l10n.t('Exit'),
                detail: l10n.t('Close the account management wizard'),
                iconPath: new vscode.ThemeIcon('close'),
                action: 'exit',
            },
        ];

        const selectedAction = await context.ui.showQuickPick(actionItems, {
            stepName: 'accountActions',
            placeHolder: l10n.t('{0} is currently being used for Azure service discovery', selectedAccount.label),
            suppressPersistence: true,
        });

        // Handle the selected action
        if (selectedAction.action === 'back') {
            // Clear the selected account to go back to selection
            context.selectedAccount = undefined;
            context.telemetry.properties.accountAction = 'back';

            // Use GoBackError to navigate back to the previous step
            throw new GoBackError();
        } else if (selectedAction.action === 'exit') {
            context.telemetry.properties.accountAction = 'exit';

            // User chose to exit - throw UserCancelledError to gracefully exit wizard
            throw new UserCancelledError('exitAccountManagement');
        }
    }

    public shouldPrompt(context: CredentialsManagementWizardContext): boolean {
        // Only show this step if we have a selected account
        return !!context.selectedAccount;
    }
}
