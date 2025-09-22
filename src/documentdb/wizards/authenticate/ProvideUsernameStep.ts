/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';

import * as l10n from '@vscode/l10n';
import { AuthMethodId } from '../../auth/AuthMethod';
import { type AuthenticateWizardContext } from './AuthenticateWizardContext';

export class ProvideUserNameStep extends AzureWizardPromptStep<AuthenticateWizardContext> {
    public async prompt(context: AuthenticateWizardContext): Promise<void> {
        const username = await context.ui.showInputBox({
            prompt: l10n.t('Please provide the username for "{resource}":', { resource: context.resourceName }),
            placeHolder: l10n.t('Username for {resource}', { resource: context.resourceName }),
            value: context.nativeAuth?.connectionUser ?? context.adminUserName,
            title: l10n.t('Authenticate to connect with your DocumentDB cluster'),
            ignoreFocusOut: true,
        });

        const trimmedUsername = username.trim();

        // Update both structured config and legacy field
        context.nativeAuth = {
            connectionUser: trimmedUsername,
            connectionPassword: context.nativeAuth?.connectionPassword ?? context.password ?? '',
        };
        context.selectedUserName = trimmedUsername;
        context.valuesToMask.push(trimmedUsername, username);

        context.isUserNameUpdated = true;
    }

    public shouldPrompt(context: AuthenticateWizardContext): boolean {
        // If availableAuthMethods is provided, only prompt when native auth is selected and username is undefined
        if (context.availableAuthMethods) {
            return context.selectedAuthMethod === AuthMethodId.NativeAuth && context.selectedUserName === undefined;
        }

        // If availableAuthMethods is not provided, prompt when username is undefined
        return context.selectedUserName === undefined;
    }
}
