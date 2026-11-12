/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { z } from 'zod';

/**
 * Input of `common.confirm`. Every string is shown as given: the calling webview localizes it.
 */
export const confirmInput = z.object({
    /** The dialog's message, its bold first line. */
    message: z.string().min(1),
    /** Secondary text under the message; VS Code shows `detail` only in a modal dialog. */
    detail: z.string().optional(),
    /** The single confirm button, for example the action's name. VS Code adds Cancel itself. */
    confirmLabel: z.string().min(1),
    /** `warning` (the default) or `information`. There is no error style: use `displayErrorMessage`. */
    severity: z.enum(['warning', 'information']).optional(),
});

export type ConfirmInput = z.infer<typeof confirmInput>;

export interface ConfirmResult {
    readonly confirmed: boolean;
}

/**
 * A modal confirmation with one confirm button and VS Code's own Cancel. Escape, Cancel and closing
 * the dialog all mean "not confirmed". Unlike `getConfirmationAsInSettings`, this ignores the
 * destructive-action confirmation style: it is for a plain "continue or cancel" choice.
 */
export async function showModalConfirmation(input: ConfirmInput): Promise<ConfirmResult> {
    const options: vscode.MessageOptions = { modal: true, detail: input.detail };
    const choice =
        input.severity === 'information'
            ? await vscode.window.showInformationMessage(input.message, options, input.confirmLabel)
            : await vscode.window.showWarningMessage(input.message, options, input.confirmLabel);
    return { confirmed: choice === input.confirmLabel };
}
