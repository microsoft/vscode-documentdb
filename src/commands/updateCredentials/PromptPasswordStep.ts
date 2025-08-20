/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { AuthMethod } from '../../documentdb/auth/AuthMethod';
import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';

export class PromptPasswordStep extends AzureWizardPromptStep<UpdateCredentialsWizardContext> {
    public async prompt(context: UpdateCredentialsWizardContext): Promise<void> {
        const passwordTemp = await context.ui.showInputBox({
            prompt: l10n.t('Please enter the password for the user "{username}"', {
                username: context.username ?? '',
            }),
            value: context.password,
            password: true,
            ignoreFocusOut: true,
        });

        context.password = passwordTemp.trim();
        context.valuesToMask.push(context.password);
    }

    public shouldPrompt(context: UpdateCredentialsWizardContext): boolean {
        return context.selectedAuthenticationMethod === AuthMethod.NativeAuth;
    }
}
