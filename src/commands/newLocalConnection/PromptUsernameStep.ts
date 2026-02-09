/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';

import * as l10n from '@vscode/l10n';
import { NewEmulatorConnectionMode, type NewLocalConnectionWizardContext } from './NewLocalConnectionWizardContext';

export class PromptUsernameStep extends AzureWizardPromptStep<NewLocalConnectionWizardContext> {
    public async prompt(context: NewLocalConnectionWizardContext): Promise<void> {
        const username = await context.ui.showInputBox({
            prompt: l10n.t('Enter the username'),
            value: context.userName,
            ignoreFocusOut: true,
            // eslint-disable-next-line @typescript-eslint/require-await
            asyncValidationTask: async (username?: string) => {
                if (!username || username.trim().length === 0) {
                    return l10n.t('Username cannot be empty');
                }
                return undefined;
            },
        });

        context.userName = username.trim();
        context.valuesToMask.push(context.userName, username);
    }

    public shouldPrompt(context: NewLocalConnectionWizardContext): boolean {
        return (
            context.emulatorType === 'documentdb' || context.mode === NewEmulatorConnectionMode.CustomConnectionString
        );
    }
}
