/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type NewConnectionWizardContext } from '../../../commands/newConnection/NewConnectionWizardContext';
import { ext } from '../../../extensionVariables';
import { AzureVMContextProperties } from '../AzureVMDiscoveryProvider';

const DEFAULT_VM_TAG = 'DocumentDB';

export class SelectTagStep extends AzureWizardPromptStep<NewConnectionWizardContext> {
    public async prompt(context: NewConnectionWizardContext): Promise<void> {
        const currentTag: string = ext.context.globalState.get<string>('azure-vm-discovery', DEFAULT_VM_TAG);

        const newTag = await context.ui.showInputBox({
            prompt: l10n.t('Enter the Azure VM tag key used for discovering DocumentDB instances.'),
            value: currentTag,
            placeHolder: DEFAULT_VM_TAG,
            validateInput: (value: string) => {
                if (!value) {
                    return l10n.t('The tag cannot be empty.');
                }
                return undefined;
            },
        });

        context.properties[AzureVMContextProperties.SelectedTag] = newTag;
    }

    public shouldPrompt(context: NewConnectionWizardContext): boolean {
        return context.properties[AzureVMContextProperties.SelectedTag] === undefined;
    }
}
