/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SCRATCHPAD_LANGUAGE_ID } from './constants';
import { detectBlocks, findBlockAtLine } from './statementDetector';

/**
 * Highlights the code block containing the cursor in scratchpad files.
 * Uses a subtle background tint so the user knows which block
 * "▶ Run" (Ctrl+Enter) will execute.
 */
export class ScratchpadBlockHighlighter implements vscode.Disposable {
    private readonly _decoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.linkedEditingBackground'),
        isWholeLine: true,
    });

    private readonly _disposables: vscode.Disposable[] = [];

    constructor() {
        this._disposables.push(this._decoration);

        this._disposables.push(
            vscode.window.onDidChangeTextEditorSelection((e) => {
                this.update(e.textEditor);
            }),
        );

        this._disposables.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor) {
                    this.update(editor);
                }
            }),
        );

        // Initialize with current editor
        if (vscode.window.activeTextEditor) {
            this.update(vscode.window.activeTextEditor);
        }
    }

    private update(editor: vscode.TextEditor): void {
        if (editor.document.languageId !== SCRATCHPAD_LANGUAGE_ID) {
            return;
        }

        const cursorLine = editor.selection.active.line;
        const blocks = detectBlocks(editor.document);
        const currentBlock = findBlockAtLine(blocks, cursorLine);

        if (currentBlock) {
            const range = new vscode.Range(
                currentBlock.startLine,
                0,
                currentBlock.endLine,
                editor.document.lineAt(currentBlock.endLine).text.length,
            );
            editor.setDecorations(this._decoration, [range]);
        } else {
            editor.setDecorations(this._decoration, []);
        }
    }

    dispose(): void {
        for (const d of this._disposables) {
            d?.dispose();
        }
    }
}
