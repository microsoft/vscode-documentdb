/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';

import * as l10n from '@vscode/l10n';
import { type NewEmulatorConnectionWizardContext } from './NewEmulatorConnectionWizardContext';

export class ProvideUserNameStep extends AzureWizardPromptStep<NewEmulatorConnectionWizardContext> {
    public async prompt(context: NewEmulatorConnectionWizardContext): Promise<void> {
        const username = await context.ui.showInputBox({
            prompt: l10n.t('Enter the username'),
            ignoreFocusOut: true,
        });

        context.userName = username.trim();
        context.valuesToMask.push(context.userName, username);
    }

    public shouldPrompt(context: NewEmulatorConnectionWizardContext): boolean {
        return context.emulatorType === 'documentdb';
    }
}
