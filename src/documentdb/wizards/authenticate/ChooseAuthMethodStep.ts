/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';

import { AuthMethod, isSupportedAuthMethod } from '../../AuthMethod';
import { type AuthenticateWizardContext } from './AuthenticateWizardContext';

export class ChooseAuthMethodStep extends AzureWizardPromptStep<AuthenticateWizardContext> {
    public async prompt(context: AuthenticateWizardContext): Promise<void> {
        const availableMethods = context.availableAuthMethods ?? [AuthMethod.NativeAuth];

        // If there's only one method available, auto-select it
        if (availableMethods.length === 1) {
            if (isSupportedAuthMethod(availableMethods[0])) {
                context.selectedAuthMethod = availableMethods[0];
                context.isAuthMethodUpdated = true;
                return;
            }

            throw new Error(l10n.t('Unsupported authentication method: {0}', availableMethods[0]));
        }

        // Create quick pick items for each auth method
        const quickPickItems = availableMethods.map((method) => {
            switch (method) {
                case AuthMethod.NativeAuth:
                    return {
                        label: l10n.t('Username and Password'),
                        detail: l10n.t('Authenticate using a username and password'),
                        authMethod: AuthMethod.NativeAuth,
                        alwaysShow: true,
                    };
                case AuthMethod.MicrosoftEntraID:
                    return {
                        label: l10n.t('Microsoft Entra ID'),
                        detail: l10n.t('Authenticate using Microsoft Entra ID (Azure AD)'),
                        authMethod: AuthMethod.MicrosoftEntraID,
                        alwaysShow: true,
                    };
                default:
                    // Handle unknown methods gracefully
                    return {
                        label: method,
                        detail: l10n.t('Unknown authentication method (experimental support)'),
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
            suppressPersistence: true,
            ignoreFocusOut: true,
        });

        if (isSupportedAuthMethod(selectedItem.authMethod) === false) {
            throw new Error(l10n.t('The selected authentication method is not supported.'));
        }

        context.selectedAuthMethod = selectedItem.authMethod;
        context.isAuthMethodUpdated = true;
    }

    public shouldPrompt(context: AuthenticateWizardContext): boolean {
        return !context.selectedAuthMethod;
    }
}
