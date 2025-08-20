/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { l10n } from 'vscode';
import { AuthMethod } from '../../documentdb/auth/AuthMethod';
import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';

export class PromptAuthMethodStep extends AzureWizardPromptStep<UpdateCredentialsWizardContext> {
    public async prompt(context: UpdateCredentialsWizardContext): Promise<void> {
        const quickPickItems = [
            {
                authMethod: AuthMethod.NativeAuth,
                label: l10n.t('Username and Password'),
                detail: l10n.t('Authenticate using a username and password'),
            },
            {
                authMethod: AuthMethod.MicrosoftEntraID,
                label: l10n.t('Microsoft Entra ID'),
                detail: l10n.t('Authenticate using Microsoft Entra ID (Azure AD)'),
            },
        ].map((item) => ({
            ...item,
            alwaysShow: true,
            description: context.availableAuthenticationMethods.includes(item.authMethod)
                ? undefined
                : l10n.t('Cluster support unknown $(info)'),
            picked: item.authMethod === context.selectedAuthenticationMethod,
        }));

        const selectedItem = await context.ui.showQuickPick(quickPickItems, {
            placeHolder: l10n.t('Select an authentication method'),
            stepName: 'selectAuthMethod',
            suppressPersistence: true,
            ignoreFocusOut: true,
        });

        if (!selectedItem) {
            // Treat cancellation as an error so caller can handle it consistently
            throw new Error(l10n.t('No authentication method selected.'));
        }

        context.selectedAuthenticationMethod = selectedItem.authMethod;
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
