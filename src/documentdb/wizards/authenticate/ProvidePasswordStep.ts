/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { AuthMethodId } from '../../auth/AuthMethod';
import { type AuthenticateWizardContext } from './AuthenticateWizardContext';

export class ProvidePasswordStep extends AzureWizardPromptStep<AuthenticateWizardContext> {
    public async prompt(context: AuthenticateWizardContext): Promise<void> {
        const passwordTemp = await context.ui.showInputBox({
            prompt: l10n.t(
                'You need to provide the password for "{username}" in order to continue. Your password will not be stored.',
                { username: context.selectedUserName ?? '' },
            ),
            placeHolder: l10n.t('Password for {username_at_resource}', {
                username_at_resource: `${context.selectedUserName}@${context.resourceName}`,
            }),
            title: l10n.t('Authenticate to connect with your DocumentDB cluster'),
            value: context.password ?? '',
            password: true,
            ignoreFocusOut: true,
        });

        context.password = passwordTemp.trim();
        context.valuesToMask.push(context.password);

        context.isPasswordUpdated = true;
    }

    public shouldPrompt(context: AuthenticateWizardContext): boolean {
        // with no availableAuthMethods, we're in the 'old' mode, so we just prompt for the password,
        // otherwise, we prompt only with only for NativeAuth
        return !context.availableAuthMethods || context.selectedAuthMethod === AuthMethodId.NativeAuth;
    }
}
