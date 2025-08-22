/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { createAuthMethodQuickPickItemsWithSupportInfo } from '../../documentdb/auth/AuthMethod';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export class PromptAuthMethodStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const quickPickItems = createAuthMethodQuickPickItemsWithSupportInfo(context.availableAuthenticationMethods);

        const selectedItem = await context.ui.showQuickPick(quickPickItems, {
            placeHolder: vscode.l10n.t('Select an authentication method'),
            stepName: 'selectAuthMethod',
            ignoreFocusOut: true,
            suppressPersistence: true,
        });

        if (!selectedItem) {
            // Treat cancellation as an error so caller can handle it consistently
            throw new Error(vscode.l10n.t('No authentication method selected.'));
        }

        context.selectedAuthenticationMethod = selectedItem.authMethod;
    }

    public shouldPrompt(context: NewConnectionWizardContext): boolean {
        return !context.selectedAuthenticationMethod;
    }
}
