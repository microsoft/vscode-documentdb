/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { PlaygroundService } from '../../documentdb/playground/PlaygroundService';
import { PLAYGROUND_LANGUAGE_ID } from '../../documentdb/playground/constants';
import { detectBlocks, detectCurrentBlock } from '../../documentdb/playground/statementDetector';
import { executePlaygroundCode } from './executePlaygroundCode';

/**
 * Runs the block specified by CodeLens arguments or the current block
 * at the cursor position. Any active text selection is intentionally
 * ignored to avoid executing partial code left selected by autocomplete.
 *
 * CodeLens passes `[startLine, endLine]` as arguments so clicking
 * a per-block "▶ Run" lens executes exactly that block.
 */
export async function runSelected(_context: IActionContext, startLine?: number, endLine?: number): Promise<void> {
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

    let codeToRun: string;
    let selectionSource: string;

    if (startLine !== undefined && endLine !== undefined) {
        // Invoked from CodeLens with explicit block range
        selectionSource = 'codeLens';
        const range = new vscode.Range(startLine, 0, endLine, editor.document.lineAt(endLine).text.length);
        codeToRun = editor.document.getText(range);
    } else {
        // Run current block at cursor, fall back to preceding block.
        // Any active selection (e.g. from autocomplete) is intentionally
        // ignored so we always execute the full block.
        selectionSource = 'cursor';
        codeToRun = detectCurrentBlock(editor.document, editor.selection.active);
        if (!codeToRun.trim()) {
            // Cursor is on a blank line — fall back to the nearest preceding block
            // (same behavior as CodeLens resolveActiveBlock)
            selectionSource = 'fallback';
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

    _context.telemetry.properties.selectionSource = selectionSource;
    const blocks = detectBlocks(editor.document);
    _context.telemetry.measurements.blockCount = blocks.length;

    if (!codeToRun.trim()) {
        void vscode.window.showInformationMessage(l10n.t('No code to run. Place the cursor in a code block.'));
        return;
    }

    await executePlaygroundCode(codeToRun, 'runSelected', editor.document.uri);
}
