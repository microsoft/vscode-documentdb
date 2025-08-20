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
        /**
         * Note to future maintainers: This step prompts the user to select an authentication method.
         * There is no direct way to pre-select an item in the Quick Pick. The workaround is to place
         * the current authentication method first in the list, which ensures it is selected by default
         * when the picker is displayed.
         */

        const nativeAuthItem = {
            authMethod: AuthMethod.NativeAuth,
            label: l10n.t('Username and Password'),
            detail: l10n.t('Authenticate using a username and password'),
        };

        const entraIdItem = {
            authMethod: AuthMethod.MicrosoftEntraID,
            label: l10n.t('Microsoft Entra ID'),
            detail: l10n.t('Authenticate using Microsoft Entra ID (Azure AD)'),
        };

        const allItems =
            context.selectedAuthenticationMethod === AuthMethod.MicrosoftEntraID
                ? [entraIdItem, nativeAuthItem]
                : [nativeAuthItem, entraIdItem];

        const quickPickItems = allItems.map((item) => ({
            ...item,
            alwaysShow: true,
            description: context.availableAuthenticationMethods.includes(item.authMethod)
                ? undefined
                : l10n.t('Cluster support unknown $(info)'),
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
