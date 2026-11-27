/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { PlaygroundContextKeyTracker, PlaygroundContextKeys } from './PlaygroundContextKeys';
import { PlaygroundService } from './PlaygroundService';
import { PLAYGROUND_LANGUAGE_ID } from './constants';

vi.mock('../../extensionVariables', () => ({
    ext: { outputChannel: { error: vi.fn() } },
}));

interface MockDocument extends vscode.TextDocument {
    lines: string[];
}

function makeEditor(uri: vscode.Uri, lines: string[], line: number): {
    editor: vscode.TextEditor;
    document: MockDocument;
} {
    const document = {
        uri,
        languageId: PLAYGROUND_LANGUAGE_ID,
        lineCount: lines.length,
        lines,
        lineAt: (index: number) => ({ text: lines[index] ?? '' }),
    } as unknown as MockDocument;
    return {
        document,
        editor: {
            document,
            selection: { active: new vscode.Position(line, 0) },
        } as unknown as vscode.TextEditor,
    };
}

describe('PlaygroundContextKeyTracker', () => {
    let activeEditor: vscode.TextEditor | undefined;
    let stateEvent: vscode.EventEmitter<void>;
    let activeEditorListener: ((editor: vscode.TextEditor | undefined) => void) | undefined;
    let selectionListener: ((event: vscode.TextEditorSelectionChangeEvent) => void) | undefined;
    let documentListener: ((event: vscode.TextDocumentChangeEvent) => void) | undefined;
    let connected: boolean;
    let tracker: PlaygroundContextKeyTracker;
    let disposables: vscode.Disposable[];

    beforeEach(() => {
        connected = true;
        stateEvent = new vscode.EventEmitter<void>();
        disposables = [];
        vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockImplementation(() => activeEditor);
        vi.spyOn(vscode.window, 'onDidChangeActiveTextEditor').mockImplementation((listener) => {
            activeEditorListener = listener;
            const disposable = { dispose: vi.fn() };
            disposables.push(disposable);
            return disposable;
        });
        vi.spyOn(vscode.window, 'onDidChangeTextEditorSelection').mockImplementation((listener) => {
            selectionListener = listener;
            const disposable = { dispose: vi.fn() };
            disposables.push(disposable);
            return disposable;
        });
        vi.spyOn(vscode.workspace, 'onDidChangeTextDocument').mockImplementation((listener) => {
            documentListener = listener;
            const disposable = { dispose: vi.fn() };
            disposables.push(disposable);
            return disposable;
        });
        vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    });

    afterEach(() => {
        tracker?.dispose();
        stateEvent.dispose();
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    function start(lines = ['db.users.find({});']): { editor: vscode.TextEditor; document: MockDocument } {
        const target = makeEditor(vscode.Uri.file('/playground.documentdb.js'), lines, 0);
        activeEditor = target.editor;
        const service = {
            onDidChangeState: stateEvent.event,
            isConnected: vi.fn(() => connected),
        } as unknown as PlaygroundService;
        tracker = new PlaygroundContextKeyTracker(service);
        return target;
    }

    it('tracks connected and current-block-code state without duplicate context writes', () => {
        const target = start(['db.users.find({});', '', '// heading']);

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'setContext',
            PlaygroundContextKeys.connected,
            true,
        );
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'setContext',
            PlaygroundContextKeys.blockHasCode,
            true,
        );

        vi.mocked(vscode.commands.executeCommand).mockClear();
        tracker.refresh();
        selectionListener?.({
            textEditor: target.editor,
            selections: [],
            kind: undefined,
        });
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it('updates for connection, selection and document changes and is false outside a playground', () => {
        const target = start(['// heading', '', 'db.users.find({});']);
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'setContext',
            PlaygroundContextKeys.blockHasCode,
            false,
        );
        vi.mocked(vscode.commands.executeCommand).mockClear();

        target.document.lines[0] = 'db.users.find({});';
        const documentChange: vscode.TextDocumentChangeEvent = {
            document: target.document,
            contentChanges: [],
            reason: undefined,
        };
        documentListener?.(documentChange);
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'setContext',
            PlaygroundContextKeys.blockHasCode,
            true,
        );

        target.editor.selection = {
            ...target.editor.selection,
            active: new vscode.Position(2, 0),
        } as vscode.Selection;
        vi.mocked(vscode.commands.executeCommand).mockClear();
        selectionListener?.({ textEditor: target.editor } as vscode.TextEditorSelectionChangeEvent);
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();

        connected = false;
        stateEvent.fire();
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'setContext',
            PlaygroundContextKeys.connected,
            false,
        );

        activeEditor = { document: { languageId: 'plaintext' } } as vscode.TextEditor;
        activeEditorListener?.(activeEditor);
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'setContext',
            PlaygroundContextKeys.blockHasCode,
            false,
        );
    });

    it('disposes all scoped listeners', () => {
        start();
        tracker.dispose();
        for (const disposable of disposables) {
            expect(disposable.dispose).toHaveBeenCalled();
        }
    });

    it('reports rejected context updates', async () => {
        vi.mocked(vscode.commands.executeCommand).mockRejectedValueOnce(new Error('context failed'));
        start();
        await Promise.resolve();
        expect(ext.outputChannel.error).toHaveBeenCalledWith(expect.stringContaining('context failed'));
    });
});
