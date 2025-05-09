/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';

import * as l10n from '@vscode/l10n';
import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';

export class PromptUserNameStep extends AzureWizardPromptStep<UpdateCredentialsWizardContext> {
    public async prompt(context: UpdateCredentialsWizardContext): Promise<void> {
        const username = await context.ui.showInputBox({
            prompt: l10n.t('Please enter the username'),
            value: context.username,
            ignoreFocusOut: true,
        });

        context.username = username.trim();
        context.valuesToMask.push(context.username, username);
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
