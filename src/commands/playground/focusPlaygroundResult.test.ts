/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { PlaygroundResultProvider } from '../../documentdb/playground/PlaygroundResultProvider';
import { ext } from '../../extensionVariables';
import { focusPlayground, focusPlaygroundResult } from './focusPlaygroundResult';

vi.mock('../../extensionVariables', () => ({ ext: { playgroundResultProvider: undefined } }));

function makeEditor(uri: vscode.Uri, languageId: string, viewColumn: vscode.ViewColumn): vscode.TextEditor {
    return { document: { uri, languageId }, viewColumn } as vscode.TextEditor;
}

describe('playground focus commands', () => {
    const sourceUri = vscode.Uri.file('/target.documentdb.js');
    const context = {} as IActionContext;
    let provider: PlaygroundResultProvider;
    let activeEditor: vscode.TextEditor | undefined;
    let visibleEditors: vscode.TextEditor[];
    let documents: vscode.TextDocument[];

    beforeEach(() => {
        activeEditor = undefined;
        visibleEditors = [];
        documents = [];
        vi.spyOn(vscode.workspace, 'textDocuments', 'get').mockImplementation(() => documents);
        vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockImplementation(() => activeEditor);
        vi.spyOn(vscode.window, 'visibleTextEditors', 'get').mockImplementation(() => visibleEditors);
        vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
        vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue({} as vscode.TextEditor);
        vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({ uri: sourceUri } as vscode.TextDocument);
        vi.spyOn(vscode.workspace, 'onDidCloseTextDocument').mockReturnValue({ dispose: vi.fn() });
        provider = new PlaygroundResultProvider();
        ext.playgroundResultProvider = provider;
        vi.spyOn(provider, 'focusResult').mockResolvedValue(true);
    });

    afterEach(() => {
        provider.dispose();
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it.each(['documentdb-playground', 'documentdb-playground-result'])('focuses the source-specific result from %s', async (languageId) => {
        activeEditor = makeEditor(
            languageId === 'documentdb-playground' ? sourceUri : provider.getResultUri(sourceUri),
            languageId,
            vscode.ViewColumn.One,
        );

        await focusPlaygroundResult(context);

        expect(provider.focusResult).toHaveBeenCalledOnce();
        expect(vi.mocked(provider.focusResult).mock.calls[0][0].toString()).toBe(sourceUri.toString());
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
    });

    it('reports when the active playground has no open result', async () => {
        activeEditor = makeEditor(sourceUri, 'documentdb-playground', vscode.ViewColumn.One);
        vi.mocked(provider.focusResult).mockResolvedValue(false);

        await focusPlaygroundResult(context);

        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('No Query Playground result is open.');
    });

    it.each([undefined, 'javascript'])('reports no result without a target (%s)', async (languageId) => {
        activeEditor = languageId ? makeEditor(sourceUri, languageId, vscode.ViewColumn.One) : undefined;

        await focusPlaygroundResult(context);

        expect(provider.focusResult).not.toHaveBeenCalled();
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('No Query Playground result is open.');
    });

    it('returns to the exact source in its existing editor group rather than another playground', async () => {
        activeEditor = makeEditor(provider.getResultUri(sourceUri), 'documentdb-playground-result', vscode.ViewColumn.Two);
        const target = makeEditor(sourceUri, 'documentdb-playground', vscode.ViewColumn.Three);
        visibleEditors = [
            makeEditor(vscode.Uri.file('/other.documentdb.js'), 'documentdb-playground', vscode.ViewColumn.One),
            target,
            activeEditor,
        ];

        await focusPlayground(context);

        expect(vscode.window.showTextDocument).toHaveBeenCalledExactlyOnceWith(target.document, {
            viewColumn: vscode.ViewColumn.Three, preserveFocus: false,
        });
        expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
    });

    it('opens a source not currently visible without running or connecting', async () => {
        activeEditor = makeEditor(provider.getResultUri(sourceUri), 'documentdb-playground-result', vscode.ViewColumn.Two);

        await focusPlayground(context);

        expect(vscode.workspace.openTextDocument).toHaveBeenCalledOnce();
        expect(vi.mocked(vscode.workspace.openTextDocument).mock.calls[0][0]).toEqual(
            expect.objectContaining({ scheme: sourceUri.scheme, path: sourceUri.path }),
        );
        expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
            expect.objectContaining({ uri: sourceUri }),
            { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
        );
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it.each([undefined, 'documentdb-playground'])('reports no playground without an active result (%s)', async (languageId) => {
        activeEditor = languageId ? makeEditor(sourceUri, languageId, vscode.ViewColumn.One) : undefined;

        await focusPlayground(context);

        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('No Query Playground is available to focus.');
        expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    });

    it('reports when the result source can no longer be opened', async () => {
        activeEditor = makeEditor(provider.getResultUri(sourceUri), 'documentdb-playground-result', vscode.ViewColumn.Two);
        vi.mocked(vscode.workspace.openTextDocument).mockRejectedValue(new Error('File not found'));

        await focusPlayground(context);

        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('No Query Playground is available to focus.');
        expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    });

    it('does not recreate a closed untitled playground or a stale pre-Save As source', async () => {
        const untitledUri = vscode.Uri.parse('untitled:Query-1.documentdb.js');
        activeEditor = makeEditor(
            provider.getResultUri(untitledUri), 'documentdb-playground-result', vscode.ViewColumn.Two,
        );
        const savedEditor = makeEditor(
            vscode.Uri.file('/saved.documentdb.js'), 'documentdb-playground', vscode.ViewColumn.One,
        );
        documents = [savedEditor.document];
        visibleEditors = [savedEditor, activeEditor];

        await focusPlayground(context);

        expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
        expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
        expect(vscode.window.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
            'No Query Playground is available to focus.',
        );
    });

    it('reveals an already-open but hidden untitled playground without creating another document', async () => {
        const untitledUri = vscode.Uri.parse('untitled:Query-1.documentdb.js');
        activeEditor = makeEditor(
            provider.getResultUri(untitledUri), 'documentdb-playground-result', vscode.ViewColumn.Two,
        );
        const source = makeEditor(untitledUri, 'documentdb-playground', vscode.ViewColumn.One);
        documents = [source.document, activeEditor.document];
        visibleEditors = [activeEditor];

        await focusPlayground(context);

        expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(vscode.window.showTextDocument).toHaveBeenCalledExactlyOnceWith(source.document, {
            viewColumn: vscode.ViewColumn.Active, preserveFocus: false,
        });
    });
});
