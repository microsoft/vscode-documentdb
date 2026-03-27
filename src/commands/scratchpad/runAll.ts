/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ScratchpadService } from '../../documentdb/scratchpad/ScratchpadService';
import { SCRATCHPAD_LANGUAGE_ID } from '../../documentdb/scratchpad/constants';
import { executeScratchpadCode } from './executeScratchpadCode';

/**
 * Runs the entire content of the active scratchpad file.
 */
export async function runAll(_context: IActionContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== SCRATCHPAD_LANGUAGE_ID) {
        return;
    }

    const service = ScratchpadService.getInstance();
    if (!service.isConnected()) {
        void vscode.window.showWarningMessage(
            l10n.t('Connect to a database before running. Right-click a database in the DocumentDB panel.'),
        );
        return;
    }

    const code = editor.document.getText();
    if (!code.trim()) {
        return;
    }

    await executeScratchpadCode(code, 'runAll');
}
