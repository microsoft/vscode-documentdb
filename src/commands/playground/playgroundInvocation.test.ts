/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as vscode from 'vscode';
import { PLAYGROUND_LANGUAGE_ID } from '../../documentdb/playground/constants';
import { parsePlaygroundInvocation, resolvePlaygroundEditor } from './playgroundInvocation';

function makeEditor(uri: vscode.Uri, languageId = PLAYGROUND_LANGUAGE_ID): vscode.TextEditor {
    return { document: { uri, languageId } } as unknown as vscode.TextEditor;
}

describe('parsePlaygroundInvocation', () => {
    it('recognizes the existing Run Block CodeLens range', () => {
        expect(parsePlaygroundInvocation([2, 4])).toEqual({
            activationSource: 'playgroundCodeLens',
            range: { startLine: 2, endLine: 4 },
            screenReaderMode: false,
        });
    });

    it('recognizes the existing Open CodeLens arguments', () => {
        const uri = vscode.Uri.file('/playground.documentdb.js');
        expect(parsePlaygroundInvocation([uri, 2, 4])).toEqual({
            activationSource: 'playgroundCodeLens',
            uri,
            range: { startLine: 2, endLine: 4 },
            screenReaderMode: false,
        });
    });

    it('recognizes editor-menu URIs and the bounded Run All marker', () => {
        const uri = vscode.Uri.file('/playground.documentdb.js');
        expect(parsePlaygroundInvocation([uri])).toMatchObject({
            activationSource: 'playgroundEditorMenu',
            uri,
        });
        expect(parsePlaygroundInvocation([{ activationSource: 'playgroundCodeLens' }])).toMatchObject({
            activationSource: 'playgroundCodeLens',
        });
        expect(
            parsePlaygroundInvocation([{ activationSource: 'playgroundCodeLens', extra: true }]).activationSource,
        ).toBe('playgroundOther');
    });

    it('preserves the URI from editor-title invocation context', () => {
        const uri = vscode.Uri.file('/playground.documentdb.js');
        expect(parsePlaygroundInvocation([uri, { groupId: 2, editorIndex: 0 }])).toEqual({
            activationSource: 'playgroundEditorMenu',
            uri,
            screenReaderMode: false,
        });
    });

    it('recognizes only supported screen-reader objects', () => {
        expect(parsePlaygroundInvocation([{ screenReaderMode: true }])).toEqual({
            activationSource: 'playgroundScreenReaderKeybinding',
            screenReaderMode: true,
        });
        expect(parsePlaygroundInvocation([{ screenReaderMode: false }]).activationSource).toBe('playgroundOther');
    });

    it.each([['playgroundEditorMenu'], ['playgroundScreenReaderKeybinding'], ['unbounded-source']])(
        'does not accept a caller-supplied telemetry string %s',
        (activationSource) => {
            expect(parsePlaygroundInvocation([{ activationSource }]).activationSource).toBe('playgroundOther');
            expect(parsePlaygroundInvocation([activationSource]).activationSource).toBe('playgroundOther');
        },
    );
});

describe('resolvePlaygroundEditor', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('uses the active playground when no URI is supplied', () => {
        const active = makeEditor(vscode.Uri.file('/active.documentdb.js'));
        vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockReturnValue(active);
        expect(resolvePlaygroundEditor(undefined)).toBe(active);
    });

    it('targets a matching inactive visible editor group instead of another active playground', () => {
        const active = makeEditor(vscode.Uri.file('/active.documentdb.js'));
        const target = makeEditor(vscode.Uri.file('/target.documentdb.js'));
        vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockReturnValue(active);
        vi.spyOn(vscode.window, 'visibleTextEditors', 'get').mockReturnValue([active, target]);

        expect(resolvePlaygroundEditor(target.document.uri)).toBe(target);
    });

    it('does not use another active playground when the requested URI is not visible', () => {
        const active = makeEditor(vscode.Uri.file('/active.documentdb.js'));
        vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockReturnValue(active);
        vi.spyOn(vscode.window, 'visibleTextEditors', 'get').mockReturnValue([active]);

        expect(resolvePlaygroundEditor(vscode.Uri.file('/missing.documentdb.js'))).toBeUndefined();
    });
});
