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
        // Use the source file path as the authority to keep URIs unique per file.
        // The path gets a .jsonc extension so VS Code applies JSON-with-comments language.
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
     */
    async showResult(sourceUri: vscode.Uri, content: string, languageId: string): Promise<void> {
        const resultUri = this.getResultUri(sourceUri);
        this.updateContent(resultUri, content);

        // If the document is already visible, just fire the change event (content already updated).
        // Otherwise, open it beside the active editor.
        const existingDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === resultUri.toString());
        if (!existingDoc) {
            const doc = await vscode.workspace.openTextDocument(resultUri);
            await vscode.window.showTextDocument(doc, {
                viewColumn: vscode.ViewColumn.Beside,
                preserveFocus: true,
                preview: false,
            });
            await vscode.languages.setTextDocumentLanguage(doc, languageId);
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

            // Update language if it changed
            if (existingDoc.languageId !== languageId) {
                await vscode.languages.setTextDocumentLanguage(existingDoc, languageId);
            }
        }
    }

    dispose(): void {
        this._disposables.forEach((d) => d.dispose());
        this._onDidChange.dispose();
        this._contents.clear();
    }
}
