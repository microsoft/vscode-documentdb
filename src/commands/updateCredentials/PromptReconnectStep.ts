/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';

export class PromptReconnectStep extends AzureWizardPromptStep<UpdateCredentialsWizardContext> {
    public async prompt(context: UpdateCredentialsWizardContext): Promise<void> {
        const quickPickItems: IAzureQuickPickItem<boolean>[] = [
            {
                label: l10n.t('Yes'),
                description: l10n.t('Reconnect now with the updated credentials'),
                data: true,
            },
            {
                label: l10n.t('No'),
                description: l10n.t('Save credentials without reconnecting'),
                data: false,
            },
        ];

        const selectedItem = await context.ui.showQuickPick(quickPickItems, {
            placeHolder: l10n.t('Would you like to reconnect with the updated credentials?'),
            stepName: 'promptReconnect',
            suppressPersistence: true,
        });

        context.shouldReconnect = selectedItem.data;
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
