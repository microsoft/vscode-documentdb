/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { PLAYGROUND_LANGUAGE_ID } from './constants';
import { detectBlocks, findBlockAtLine } from './statementDetector';

/**
 * Shows a vertical indicator in the gutter for all code blocks in query
 * playground files. The active block (containing the cursor) is brighter;
 * inactive blocks are dimmed. Decoration types are recreated when the color
 * theme changes to use the appropriate dark/light SVG variants.
 */
export class PlaygroundBlockHighlighter implements vscode.Disposable {
    private _activeDecoration!: vscode.TextEditorDecorationType;
    private _inactiveDecoration!: vscode.TextEditorDecorationType;
    private readonly _extensionPath: string;

    private readonly _disposables: vscode.Disposable[] = [];

    constructor(extensionPath: string) {
        this._extensionPath = extensionPath;
        this.createDecorations();

        this._disposables.push(
            vscode.window.onDidChangeActiveColorTheme(() => {
                this._activeDecoration.dispose();
                this._inactiveDecoration.dispose();
                this.createDecorations();
                // Re-apply to current editor
                if (vscode.window.activeTextEditor) {
                    this.update(vscode.window.activeTextEditor);
                }
            }),
        );

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

        this._disposables.push(
            vscode.workspace.onDidChangeTextDocument((e) => {
                const editor = vscode.window.activeTextEditor;
                if (editor && editor.document === e.document) {
                    this.update(editor);
                }
            }),
        );

        if (vscode.window.activeTextEditor) {
            this.update(vscode.window.activeTextEditor);
        }
    }

    private createDecorations(): void {
        const isLight =
            vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ||
            vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrastLight;
        const suffix = isLight ? '-light' : '';
        const iconsDir = path.join(this._extensionPath, 'resources', 'icons');

        this._activeDecoration = vscode.window.createTextEditorDecorationType({
            gutterIconPath: vscode.Uri.file(path.join(iconsDir, `playground-block-active${suffix}.svg`)),
            gutterIconSize: 'contain',
        });
        this._inactiveDecoration = vscode.window.createTextEditorDecorationType({
            gutterIconPath: vscode.Uri.file(path.join(iconsDir, `playground-block-inactive${suffix}.svg`)),
            gutterIconSize: 'contain',
        });
    }

    private update(editor: vscode.TextEditor): void {
        if (editor.document.languageId !== PLAYGROUND_LANGUAGE_ID) {
            return;
        }

        const cursorLine = editor.selection.active.line;
        const blocks = detectBlocks(editor.document);
        const activeBlock = findBlockAtLine(blocks, cursorLine);

        const activeRanges: vscode.Range[] = [];
        const inactiveRanges: vscode.Range[] = [];

        for (const block of blocks) {
            const isActive = activeBlock !== undefined && block.startLine === activeBlock.startLine;
            const target = isActive ? activeRanges : inactiveRanges;
            for (let line = block.startLine; line <= block.endLine; line++) {
                target.push(new vscode.Range(line, 0, line, 0));
            }
        }

        editor.setDecorations(this._activeDecoration, activeRanges);
        editor.setDecorations(this._inactiveDecoration, inactiveRanges);
    }

    dispose(): void {
        this._activeDecoration.dispose();
        this._inactiveDecoration.dispose();
        for (const d of this._disposables) {
            d?.dispose();
        }
    }
}
