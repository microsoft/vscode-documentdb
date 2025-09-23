/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';

import * as l10n from '@vscode/l10n';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';

export class PromptUserNameStep extends AzureWizardPromptStep<UpdateCredentialsWizardContext> {
    public async prompt(context: UpdateCredentialsWizardContext): Promise<void> {
        const username = await context.ui.showInputBox({
            prompt: l10n.t('Please enter the username'),
            value: context.nativeAuth?.connectionUser ?? '',
            ignoreFocusOut: true,
        });

        const trimmedUsername = username.trim();

        // Update structured config
        context.nativeAuth = {
            connectionUser: trimmedUsername,
            connectionPassword: context.nativeAuth?.connectionPassword,
        };
        context.valuesToMask.push(trimmedUsername, username);
    }

    public shouldPrompt(context: UpdateCredentialsWizardContext): boolean {
        return context.selectedAuthenticationMethod === AuthMethodId.NativeAuth;
    }
}
