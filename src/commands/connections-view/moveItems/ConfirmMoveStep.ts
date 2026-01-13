/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type MoveItemsWizardContext } from './MoveItemsWizardContext';

/**
 * Step to confirm the move operation before execution.
 * Uses a modal dialog for clear user confirmation.
 */
export class ConfirmMoveStep extends AzureWizardPromptStep<MoveItemsWizardContext> {
    public async prompt(context: MoveItemsWizardContext): Promise<void> {
        const itemCount = context.itemsToMove.length;
        const targetName = context.targetFolderPath ?? l10n.t('/ (Root)');

        const confirmMessage =
            itemCount === 1
                ? l10n.t('Move "{0}" to "{1}"?', context.itemsToMove[0].name, targetName)
                : l10n.t('Move {0} items to "{1}"?', itemCount.toString(), targetName);

        const moveButton = l10n.t('Move');
        const result = await vscode.window.showWarningMessage(confirmMessage, { modal: true }, moveButton);

        if (result !== moveButton) {
            throw new UserCancelledError();
        }
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
