/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { AuthMethod } from '../../documentdb/auth/AuthMethod';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export class PromptAuthMethodStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const quickPickItems = [
            {
                label: vscode.l10n.t('Username and Password'),
                detail: vscode.l10n.t('Authenticate using a username and password'),
                authMethod: AuthMethod.NativeAuth,
                alwaysShow: true,
            },
            {
                label: vscode.l10n.t('Microsoft Entra ID'),
                detail: vscode.l10n.t('Authenticate using Microsoft Entra ID (Azure AD)'),
                authMethod: AuthMethod.MicrosoftEntraID,
                alwaysShow: true,
            },
        ];

        const selectedItem = await context.ui.showQuickPick(quickPickItems, {
            placeHolder: vscode.l10n.t('Select an authentication method'),
            stepName: 'selectAuthMethod',
            ignoreFocusOut: true,
        });

        if (!selectedItem) {
            // Treat cancellation as an error so caller can handle it consistently
            throw new Error(vscode.l10n.t('No authentication method selected.'));
        }

        context.authenticationMethod = selectedItem.authMethod;
    }

    public shouldPrompt(context: NewConnectionWizardContext): boolean {
        return !context.authenticationMethod;
    }
}
