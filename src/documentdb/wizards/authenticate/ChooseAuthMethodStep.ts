/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { AuthMethod, type AuthenticateWizardContext } from './AuthenticateWizardContext';

export class ChooseAuthMethodStep extends AzureWizardPromptStep<AuthenticateWizardContext> {
    public async prompt(context: AuthenticateWizardContext): Promise<void> {
        const availableMethods = context.availableAuthMethods ?? [AuthMethod.NativeAuth_ConnectionString];

        // If there's only one method available, auto-select it
        if (availableMethods.length === 1) {
            context.selectedAuthMethod = availableMethods[0];
            context.isAuthMethodUpdated = true;
            return;
        }

        // Create quick pick items for each auth method
        const quickPickItems = availableMethods.map((method) => {
            switch (method) {
                case AuthMethod.NativeAuth_ConnectionString:
                    return {
                        label: l10n.t('Username and Password'),
                        detail: l10n.t('Authenticate using a username and password'),
                        authMethod: method,
                        alwaysShow: true,
                    };
                case AuthMethod.MicrosoftEntraID:
                    return {
                        label: l10n.t('Microsoft Entra ID'),
                        detail: l10n.t('Authenticate using Microsoft Entra ID (Azure AD)'),
                        authMethod: method,
                        alwaysShow: true,
                    };
                default:
                    return {
                        label: method,
                        detail: l10n.t('Unknown authentication method'),
                        authMethod: method,
                        alwaysShow: true,
                    };
            }
        });

        const selectedItem = await context.ui.showQuickPick(quickPickItems, {
            placeHolder: l10n.t('Select an authentication method for "{resourceName}"', {
                resourceName: context.resourceName,
            }),
            title: l10n.t('Authenticate to connect with your DocumentDB cluster'),
            ignoreFocusOut: true,
        });

        context.selectedAuthMethod = selectedItem.authMethod;
        context.isAuthMethodUpdated = true;
    }

    public shouldPrompt(context: AuthenticateWizardContext): boolean {
        return !context.selectedAuthMethod;
    }
}
