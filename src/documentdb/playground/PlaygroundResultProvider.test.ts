/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { PlaygroundResultProvider } from './PlaygroundResultProvider';

function makeDocument(uri: vscode.Uri): vscode.TextDocument {
    return { uri } as vscode.TextDocument;
}

function makeEditor(document: vscode.TextDocument, viewColumn: vscode.ViewColumn): vscode.TextEditor {
    return { document, viewColumn } as vscode.TextEditor;
}

describe('PlaygroundResultProvider', () => {
    const sourceUri = vscode.Uri.file('/queries/a query.documentdb.js');
    let provider: PlaygroundResultProvider;
    let documents: vscode.TextDocument[];
    let editors: vscode.TextEditor[];

    beforeEach(() => {
        documents = [];
        editors = [];
        vi.spyOn(vscode.workspace, 'textDocuments', 'get').mockImplementation(() => documents);
        vi.spyOn(vscode.window, 'visibleTextEditors', 'get').mockImplementation(() => editors);
        vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue({} as vscode.TextEditor);
        vi.spyOn(vscode.workspace, 'openTextDocument').mockImplementation(async () => {
            const resultUri = provider.getResultUri(sourceUri);
            resultUri.toString();
            return makeDocument(resultUri);
        });
        vi.spyOn(vscode.languages, 'setTextDocumentLanguage').mockImplementation(async (doc) => doc);
        vi.spyOn(vscode.workspace, 'onDidCloseTextDocument').mockReturnValue({ dispose: vi.fn() });
        provider = new PlaygroundResultProvider();
    });

    afterEach(() => {
        provider.dispose();
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it('round-trips the existing result URI source including escaped query characters', () => {
        const source = sourceUri.with({ query: 'value=a&b=+#' });
        const resultUri = provider.getResultUri(source);
        expect(provider.getSourceUri(resultUri)?.toString()).toBe(source.toString());
        expect(provider.getSourceUri(resultUri.with({ scheme: 'file' }))).toBeUndefined();
        expect(provider.getSourceUri(resultUri.with({ query: '' }))).toBeUndefined();
        expect(provider.getSourceUri(resultUri.with({ query: 'source=' }))).toBeUndefined();
    });

    it('returns no source for an invalid encoded URI', () => {
        const resultUri = provider.getResultUri(sourceUri);
        vi.spyOn(vscode.Uri, 'parse').mockImplementationOnce(() => {
            throw new Error('Invalid URI');
        });
        expect(provider.getSourceUri(resultUri)).toBeUndefined();
    });

    it.each([undefined, false, true])(
        'opens a new result with focus=%s and preserves content and language',
        async (focus) => {
            const resultUri = provider.getResultUri(sourceUri);
            resultUri.toString();
            const changes: vscode.Uri[] = [];
            const subscription = provider.onDidChange((uri) => changes.push(uri));

            await provider.showResult(sourceUri, 'result bytes', focus === undefined ? undefined : { focus });

            expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(resultUri);
            expect(vscode.window.showTextDocument).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ uri: resultUri }),
                { viewColumn: vscode.ViewColumn.Beside, preserveFocus: focus !== true, preview: false },
            );
            expect(vscode.languages.setTextDocumentLanguage).toHaveBeenCalledWith(
                expect.objectContaining({ uri: resultUri }),
                'documentdb-playground-result',
            );
            expect(provider.provideTextDocumentContent(resultUri)).toBe('result bytes');
            expect(changes).toEqual([resultUri]);
            subscription.dispose();
        },
    );

    it.each([undefined, false, true])(
        'updates a visible result with focus=%s without duplicate reveals',
        async (focus) => {
            const doc = makeDocument(provider.getResultUri(sourceUri));
            documents = [doc];
            editors = [makeEditor(doc, vscode.ViewColumn.Three)];

            await provider.showResult(sourceUri, 'updated', focus === undefined ? undefined : { focus });

            expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
            expect(provider.provideTextDocumentContent(doc.uri)).toBe('updated');
            if (focus) {
                expect(vscode.window.showTextDocument).toHaveBeenCalledExactlyOnceWith(doc, {
                    viewColumn: vscode.ViewColumn.Three,
                    preserveFocus: false,
                    preview: false,
                });
            } else {
                expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
            }
        },
    );

    it.each([false, true])('reveals a hidden open result with focus=%s', async (focus) => {
        const doc = makeDocument(provider.getResultUri(sourceUri));
        documents = [doc];

        await provider.showResult(sourceUri, 'updated', { focus });

        expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
        expect(vscode.window.showTextDocument).toHaveBeenCalledExactlyOnceWith(doc, {
            viewColumn: vscode.ViewColumn.Beside,
            preserveFocus: !focus,
            preview: false,
        });
    });

    it('does not create a result when explicitly focusing a source without an open result', async () => {
        documents = [makeDocument(provider.getResultUri(vscode.Uri.file('/another.documentdb.js')))];
        expect(await provider.focusResult(sourceUri)).toBe(false);
        expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
        expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    });

    it.each([false, true])(
        'focuses the actual open result (visible=%s) in its existing group when visible',
        async (visible) => {
            const doc = makeDocument(provider.getResultUri(sourceUri));
            documents = [doc];
            editors = visible ? [makeEditor(doc, vscode.ViewColumn.Two)] : [];

            expect(await provider.focusResult(sourceUri)).toBe(true);
            expect(vscode.window.showTextDocument).toHaveBeenCalledExactlyOnceWith(doc, {
                viewColumn: visible ? vscode.ViewColumn.Two : vscode.ViewColumn.Beside,
                preserveFocus: false,
                preview: false,
            });
            expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
        },
    );
});
