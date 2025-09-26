/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, GoBackError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { nonNullValue } from '../../../../utils/nonNull';
import { type CredentialsManagementWizardContext } from './CredentialsManagementWizardContext';

interface AccountActionQuickPickItem extends vscode.QuickPickItem {
    action?: 'back' | 'signOut';
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
                label: l10n.t('$(arrow-left) Back to account selection'),
                detail: l10n.t('Return to the account list'),
                iconPath: new vscode.ThemeIcon('arrow-left'),
                action: 'back',
            },
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                label: l10n.t('$(sign-out) Sign out from this account'),
                detail: l10n.t('Remove this account from service discovery'),
                iconPath: new vscode.ThemeIcon('sign-out'),
                action: 'signOut',
            },
        ];

        const selectedAction = await context.ui.showQuickPick(actionItems, {
            stepName: 'accountActions',
            placeHolder: l10n.t('What would you like to do with {0}?', selectedAccount.label),
            suppressPersistence: true,
        });

        // Handle the selected action
        if (selectedAction.action === 'back') {
            // Clear the selected account to go back to selection
            context.selectedAccount = undefined;
            context.telemetry.properties.accountAction = 'back';

            // Use GoBackError to navigate back to the previous step
            throw new GoBackError();
        } else if (selectedAction.action === 'signOut') {
            // TODO: Implement sign out functionality
            context.telemetry.properties.accountAction = 'signOut';

            // For now, just show a message
            void vscode.window.showInformationMessage(
                l10n.t('Sign out functionality will be implemented in the next step'),
            );
        }
    }

    public shouldPrompt(context: CredentialsManagementWizardContext): boolean {
        // Only show this step if we have a selected account
        return !!context.selectedAccount;
    }
}
