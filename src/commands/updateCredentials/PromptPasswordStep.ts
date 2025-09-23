/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';

export class PromptPasswordStep extends AzureWizardPromptStep<UpdateCredentialsWizardContext> {
    public async prompt(context: UpdateCredentialsWizardContext): Promise<void> {
        const passwordTemp = await context.ui.showInputBox({
            prompt: l10n.t('Please enter the password for the user "{username}"', {
                username: context.nativeAuth?.connectionUser ?? '',
            }),
            value: context.nativeAuth?.connectionPassword,
            password: true,
            ignoreFocusOut: true,
        });

        const trimmedPassword = passwordTemp.trim();

        // Update structured config
        context.nativeAuth = {
            connectionUser: context.nativeAuth?.connectionUser ?? '',
            connectionPassword: trimmedPassword,
        };
        context.valuesToMask.push(trimmedPassword);
    }

    public shouldPrompt(context: UpdateCredentialsWizardContext): boolean {
        return context.selectedAuthenticationMethod === AuthMethodId.NativeAuth;
    }
}
