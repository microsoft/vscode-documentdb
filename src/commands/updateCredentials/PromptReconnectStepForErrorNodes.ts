/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, type IActionContext, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';

export interface ReconnectContext extends IActionContext {
    /** True when the wizard was triggered from an error/retry node. */
    isErrorState: boolean;
    /** Set by the prompt; when true the error state is cleared to trigger a reconnect. */
    reconnectAfterError: boolean;
}

/**
 * Asks the user whether to reconnect after updating credentials.
 * Only shown when the node is in an error state (e.g., previous connection failure).
 */
export class PromptReconnectStepForErrorNodes<T extends ReconnectContext> extends AzureWizardPromptStep<T> {
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

        context.reconnectAfterError = selectedItem.data;
    }

    public shouldPrompt(context: T): boolean {
        return context.isErrorState;
    }
}
