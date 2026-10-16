/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PLAYGROUND_LANGUAGE_ID } from '../../playground/constants';

/**
 * Characters that signal the end of a field-value pair and should exit snippet mode.
 *
 * Mirrors the `SNIPPET_EXIT_CHARS` set used in the Collection View's QueryEditor.
 * When the user types one of these after accepting a snippet completion
 * (e.g., `{ $exists: true| }` → user types `,`), the active snippet session
 * is cancelled so the tab-stop highlight doesn't persist — the "ghost selection" bug.
 */
const SNIPPET_EXIT_CHARS = new Set([',', '}', ']']);

/**
 * Manages snippet session lifecycle for query playground editors.
 *
 * In the Collection View (webview Monaco), snippet sessions are cancelled
 * explicitly via `snippetController2.cancel()` when delimiter characters are
 * typed.  The query playground uses VS Code's native editor, which doesn't
 * expose the snippet controller directly.  Instead, this manager listens for
 * text changes on playground documents and executes the built-in `leaveSnippet`
 * command to close the active snippet session when a delimiter character is
 * typed.
 *
 * Without this, the snippet tab-stop highlight stays active after the user
 * fills in a value and continues editing — pressing `,`, `}`, `]`, or even
 * Escape (which is consumed by the suggest widget first) doesn't exit the
 * snippet naturally.
 */
export class PlaygroundSnippetSessionManager implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];

    constructor() {
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument((e) => {
                this.onDocumentChange(e);
            }),
        );
    }

    private onDocumentChange(e: vscode.TextDocumentChangeEvent): void {
        if (e.document.languageId !== PLAYGROUND_LANGUAGE_ID) {
            return;
        }

        // `leaveSnippet` acts on the active editor. Guard against programmatic
        // edits to a playground document while a different editor is focused.
        if (vscode.window.activeTextEditor?.document !== e.document) {
            return;
        }

        // Only react to single-character user keystrokes, not multi-character
        // completions which may legitimately contain commas or braces.
        const change = e.contentChanges[0];
        if (!change || change.text.length !== 1) {
            return;
        }

        if (SNIPPET_EXIT_CHARS.has(change.text)) {
            void vscode.commands.executeCommand('leaveSnippet');
        }
    }

    /**
     * Register the snippet session manager.
     * Returns a disposable that unregisters all listeners.
     */
    static register(): vscode.Disposable {
        return new PlaygroundSnippetSessionManager();
    }

    dispose(): void {
        this.disposables.forEach((d) => {
            d.dispose();
        });
    }
}
