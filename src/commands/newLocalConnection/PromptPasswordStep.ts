/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type NewLocalConnectionWizardContext } from './NewLocalConnectionWizardContext';

export class PromptPasswordStep extends AzureWizardPromptStep<NewLocalConnectionWizardContext> {
    public async prompt(context: NewLocalConnectionWizardContext): Promise<void> {
        const passwordTemp = await context.ui.showInputBox({
            prompt: l10n.t('Enter the password'),
            password: true,
            ignoreFocusOut: true,
        });

        context.password = passwordTemp.trim();
        context.valuesToMask.push(context.password);
    }

    public shouldPrompt(context: NewLocalConnectionWizardContext): boolean {
        return context.emulatorType === 'documentdb';
    }
}
