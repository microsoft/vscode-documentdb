/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { PlaygroundService } from '../../documentdb/playground/PlaygroundService';
import { PLAYGROUND_LANGUAGE_ID } from '../../documentdb/playground/constants';
import { ext } from '../../extensionVariables';
import { executePlaygroundCode } from './executePlaygroundCode';

/**
 * Runs the entire content of the active query playground file.
 */
export async function runAll(_context: IActionContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== PLAYGROUND_LANGUAGE_ID) {
        return;
    }

    const service = PlaygroundService.getInstance();
    if (!service.isConnected(editor.document.uri)) {
        void vscode.window.showWarningMessage(
            l10n.t('This playground has no connection. Create a new playground from the DocumentDB panel.'),
        );
        return;
    }

    const code = editor.document.getText();
    if (!code.trim()) {
        void vscode.window.showInformationMessage(l10n.t('The playground file is empty. Add some code to run.'));
        return;
    }

    const confirmRunAll = vscode.workspace
        .getConfiguration()
        .get<boolean>(ext.settingsKeys.playgroundConfirmRunAll, true);

    if (confirmRunAll) {
        const confirmed = await vscode.window.showWarningMessage(
            l10n.t('Are you sure you want to run the entire playground file?'),
            {
                modal: true,
                detail: l10n.t(
                    'This will execute all statements in the file against the connected database. You can disable this confirmation by setting "{0}" to false.',
                    ext.settingsKeys.playgroundConfirmRunAll,
                ),
            },
            l10n.t('Run All'),
        );

        if (!confirmed) {
            return;
        }
    }

    await executePlaygroundCode(code, 'runAll', editor.document.uri);
}
