/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, type IActionContext, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';

export interface ReconnectContext extends IActionContext {
    offerReconnect: boolean;
    shouldReconnect: boolean;
}

export class PromptReconnectStep<T extends ReconnectContext> extends AzureWizardPromptStep<T> {
    public async prompt(context: T): Promise<void> {
        const quickPickItems: IAzureQuickPickItem<boolean>[] = [
            {
                label: l10n.t('Yes'),
                detail: l10n.t('Reconnect now with the updated credentials'),
                data: true,
            },
            {
                label: l10n.t('No'),
                detail: l10n.t('Save credentials without reconnecting'),
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

    public shouldPrompt(context: T): boolean {
        return context.offerReconnect;
    }
}
