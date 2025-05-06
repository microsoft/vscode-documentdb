/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type NewEmulatorConnectionWizardContext } from './NewEmulatorConnectionWizardContext';

export class ProvidePasswordStep extends AzureWizardPromptStep<NewEmulatorConnectionWizardContext> {
    public async prompt(context: NewEmulatorConnectionWizardContext): Promise<void> {
        const passwordTemp = await context.ui.showInputBox({
            prompt: l10n.t('Enter the password for the Emulator'),
            password: true,
            ignoreFocusOut: true,
        });

        context.password = passwordTemp.trim();
        context.valuesToMask.push(context.password);
    }

    public shouldPrompt(context: NewEmulatorConnectionWizardContext): boolean {
        return context.emulatorType === 'documentdb';
    }
}
