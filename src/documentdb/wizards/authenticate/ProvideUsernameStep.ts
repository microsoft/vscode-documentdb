/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';

import * as l10n from '@vscode/l10n';
import { AuthMethod } from '../../AuthMethod';
import { type AuthenticateWizardContext } from './AuthenticateWizardContext';

export class ProvideUserNameStep extends AzureWizardPromptStep<AuthenticateWizardContext> {
    public async prompt(context: AuthenticateWizardContext): Promise<void> {
        const username = await context.ui.showInputBox({
            prompt: l10n.t('Please provide the username for "{resource}":', { resource: context.resourceName }),
            placeHolder: l10n.t('Username for {resource}', { resource: context.resourceName }),
            value: context.adminUserName,
            title: l10n.t('Authenticate to connect with your DocumentDB cluster'),
            ignoreFocusOut: true,
        });

        context.selectedUserName = username.trim();
        context.valuesToMask.push(context.selectedUserName, username);

        context.isUserNameUpdated = true;
    }

    public shouldPrompt(context: AuthenticateWizardContext): boolean {
        // If availableAuthMethods is provided, only prompt when native auth is selected and password is undefined
        if (context.availableAuthMethods) {
            return context.selectedAuthMethod === AuthMethod.NativeAuth && context.password === undefined;
        }

        // If availableAuthMethods is not provided, prompt when password is undefined
        return context.password === undefined;
    }
}
