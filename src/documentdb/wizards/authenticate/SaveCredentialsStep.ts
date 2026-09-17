/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';

import * as l10n from '@vscode/l10n';
import { type AuthenticateWizardContext } from './AuthenticateWizardContext';

export class SaveCredentialsStep extends AzureWizardPromptStep<AuthenticateWizardContext> {
    public async prompt(context: AuthenticateWizardContext): Promise<void> {
        const promptItems = [
            {
                id: 'saveCredentials',
                label: l10n.t('Yes, save my credentials'),
                detail: l10n.t('Save credentials for future connections.'),
                alwaysShow: true,
            },
            {
                id: 'doNotSaveCredentials',
                label: l10n.t('No'),
                detail: l10n.t('Do not save credentials.'),
                alwaysShow: true,
            },
        ];

        const selectedItem = await context.ui.showQuickPick([...promptItems], {
            enableGrouping: true,
            placeHolder: l10n.t('Save credentials for future use?'),
            stepName: 'saveCredentials',
            suppressPersistence: true,
        });

        context.saveCredentials = selectedItem.id === 'saveCredentials';
    }

    public shouldPrompt(context: AuthenticateWizardContext): boolean {
        return (
            Boolean(context.isUserNameUpdated) ||
            Boolean(context.isPasswordUpdated) ||
            Boolean(context.isAuthMethodUpdated)
        );
    }
}
