/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * URI scheme for query playground result documents.
 * Registered via `vscode.workspace.registerTextDocumentContentProvider`.
 */
export const PLAYGROUND_RESULT_SCHEME = 'documentdb-playground-result';

/** Language ID registered in package.json for result documents. */
const PLAYGROUND_RESULT_LANGUAGE_ID = 'documentdb-playground-result';

/**
 * Virtual document content provider for query playground results.
 *
 * Each source playground file gets a stable result URI so that re-running
 * a query replaces the content in the same tab instead of opening a new one.
 *
 * VS Code calls `provideTextDocumentContent(uri)` whenever the document needs
 * to be rendered. We store the latest content in a Map and fire `onDidChange`
 * to trigger a re-pull when the result is updated.
 */
export class PlaygroundResultProvider implements vscode.TextDocumentContentProvider {
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    /** Content keyed by URI string. */
    private readonly _contents = new Map<string, string>();

    /** Disposables for event subscriptions. */
    private readonly _disposables: vscode.Disposable[] = [];

    constructor() {
        // Clean up stored content when result documents are closed
        this._disposables.push(
            vscode.workspace.onDidCloseTextDocument((doc) => {
                if (doc.uri.scheme === PLAYGROUND_RESULT_SCHEME) {
                    this._contents.delete(doc.uri.toString());
                }
            }),
        );
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this._contents.get(uri.toString()) ?? '';
    }

    /**
     * Build a deterministic result URI for a given source playground file.
     * Same source file → same URI → same tab.
     */
    getResultUri(sourceUri: vscode.Uri): vscode.Uri {
        // Encode the source URI to keep result URIs unique per playground file.
        const encoded = encodeURIComponent(sourceUri.toString());
        return vscode.Uri.parse(`${PLAYGROUND_RESULT_SCHEME}://results/${encoded}/Query Playground Result`);
    }

    /**
     * Update (or set) the content for a result URI and notify VS Code to re-read it.
     */
    updateContent(uri: vscode.Uri, content: string): void {
        this._contents.set(uri.toString(), content);
        this._onDidChange.fire(uri);
    }

    /**
     * Open (or reveal) the result document beside the active editor.
     * If the tab already exists, its content is updated in place.
     *
     * The document language is always `documentdb-playground-result`, which
     * delegates syntax highlighting to JSONC via its TextMate grammar while
     * keeping the custom DocumentDB icon on the tab.
     */
    async showResult(sourceUri: vscode.Uri, content: string): Promise<void> {
        const resultUri = this.getResultUri(sourceUri);
        this.updateContent(resultUri, content);

        // If the document is already open, the onDidChange event (fired by
        // updateContent) is enough — VS Code will re-pull the content.
        // We just need to ensure it's visible.
        const existingDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === resultUri.toString());
        if (!existingDoc) {
            const doc = await vscode.workspace.openTextDocument(resultUri);
            await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Beside,
                preserveFocus: true,
                preview: false,
            });
            // Set our language so VS Code uses our icon and JSONC-delegating grammar.
            // Must happen after openTextDocument since VS Code can't infer language
            // from our scheme-only URI (no file extension).
            await vscode.languages.setTextDocumentLanguage(doc, PLAYGROUND_RESULT_LANGUAGE_ID);
        } else {
            // Document exists — ensure it's visible in an editor
            const visibleEditor = vscode.window.visibleTextEditors.find(
                (e) => e.document.uri.toString() === resultUri.toString(),
            );
            if (!visibleEditor) {
                await vscode.window.showTextDocument(existingDoc, {
                    viewColumn: vscode.ViewColumn.Beside,
                    preserveFocus: true,
                    preview: false,
                });
            }
        }
    }

    dispose(): void {
        this._disposables.forEach((d) => d.dispose());
        this._onDidChange.dispose();
        this._contents.clear();
    }
}
