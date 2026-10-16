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
            value: context.nativeAuthConfig?.connectionUser ?? '',
            ignoreFocusOut: true,
            // eslint-disable-next-line @typescript-eslint/require-await
            asyncValidationTask: async (username?: string) => {
                if (!username || username.trim().length === 0) {
                    return l10n.t('Username cannot be empty');
                }
                return undefined;
            },
        });

        const trimmedUsername = username.trim();

        // Update structured config
        context.nativeAuthConfig = {
            connectionUser: trimmedUsername,
            connectionPassword: context.nativeAuthConfig?.connectionPassword,
        };
        context.valuesToMask.push(trimmedUsername, username);
    }

    public shouldPrompt(context: UpdateCredentialsWizardContext): boolean {
        return context.selectedAuthenticationMethod === AuthMethodId.NativeAuth;
    }
}
