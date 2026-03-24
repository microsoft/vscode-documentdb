/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ScratchpadService } from '../../documentdb/scratchpad/ScratchpadService';
import { SCRATCHPAD_LANGUAGE_ID } from '../../documentdb/scratchpad/constants';
import { detectBlocks, detectCurrentBlock } from '../../documentdb/scratchpad/statementDetector';
import { executeScratchpadCode } from './executeScratchpadCode';

/**
 * Runs the selected text, the block specified by CodeLens arguments,
 * or the current block at the cursor position.
 *
 * CodeLens passes `[startLine, endLine]` as arguments so clicking
 * a per-block "▶ Run" lens executes exactly that block.
 */
export async function runSelected(_context: IActionContext, startLine?: number, endLine?: number): Promise<void> {
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

    let codeToRun: string;

    if (startLine !== undefined && endLine !== undefined) {
        // Invoked from CodeLens with explicit block range
        const range = new vscode.Range(startLine, 0, endLine, editor.document.lineAt(endLine).text.length);
        codeToRun = editor.document.getText(range);
    } else if (!editor.selection.isEmpty) {
        // Behavior 1: Run selection
        codeToRun = editor.document.getText(editor.selection);
    } else {
        // Behavior 2: Run current block at cursor, fall back to preceding block
        codeToRun = detectCurrentBlock(editor.document, editor.selection.active);
        if (!codeToRun.trim()) {
            // Cursor is on a blank line — fall back to the nearest preceding block
            // (same behavior as CodeLens resolveActiveBlock)
            const blocks = detectBlocks(editor.document);
            const cursorLine = editor.selection.active.line;
            for (let i = blocks.length - 1; i >= 0; i--) {
                if (blocks[i].endLine < cursorLine) {
                    const range = new vscode.Range(
                        blocks[i].startLine,
                        0,
                        blocks[i].endLine,
                        editor.document.lineAt(blocks[i].endLine).text.length,
                    );
                    codeToRun = editor.document.getText(range);
                    break;
                }
            }
        }
    }

    if (!codeToRun.trim()) {
        return;
    }

    await executeScratchpadCode(codeToRun);
}
