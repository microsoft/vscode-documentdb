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
