/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PLAYGROUND_LANGUAGE_ID } from '../../../playground/constants';
import { PlaygroundSnippetSessionManager } from '../PlaygroundSnippetSessionManager';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Capture the onDidChangeTextDocument callback registered during construction
let onDidChangeTextDocumentCallback: ((e: vscode.TextDocumentChangeEvent) => void) | undefined;

const mockOnDidChangeTextDocument = jest.fn(
    (listener: (e: vscode.TextDocumentChangeEvent) => void): vscode.Disposable => {
        onDidChangeTextDocumentCallback = listener;
        return { dispose: jest.fn() };
    },
);

jest.mock('vscode', () => {
    return {
        workspace: {
            get onDidChangeTextDocument() {
                return mockOnDidChangeTextDocument;
            },
        },
        commands: {
            executeCommand: jest.fn(),
        },
    };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChangeEvent(languageId: string, text: string): vscode.TextDocumentChangeEvent {
    return {
        document: { languageId } as vscode.TextDocument,
        contentChanges: [
            {
                text,
                range: new (jest.fn().mockImplementation(() => ({})))(),
                rangeOffset: 0,
                rangeLength: 0,
            } as unknown as vscode.TextDocumentContentChangeEvent,
        ],
        reason: undefined,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlaygroundSnippetSessionManager', () => {
    let manager: PlaygroundSnippetSessionManager;

    beforeEach(() => {
        jest.clearAllMocks();
        onDidChangeTextDocumentCallback = undefined;
        manager = new PlaygroundSnippetSessionManager();
    });

    afterEach(() => {
        manager.dispose();
    });

    it('should register a document change listener on construction', () => {
        expect(mockOnDidChangeTextDocument).toHaveBeenCalledTimes(1);
        expect(onDidChangeTextDocumentCallback).toBeDefined();
    });

    it.each([',', '}', ']'])('should execute leaveSnippet when "%s" is typed in a playground', (char) => {
        const event = makeChangeEvent(PLAYGROUND_LANGUAGE_ID, char);
        onDidChangeTextDocumentCallback!(event);
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('leaveSnippet');
    });

    it('should NOT execute leaveSnippet for non-playground documents', () => {
        const event = makeChangeEvent('typescript', ',');
        onDidChangeTextDocumentCallback!(event);
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it('should NOT execute leaveSnippet for multi-character insertions', () => {
        // Multi-character insertions are completion acceptances, not user keystrokes.
        const event = makeChangeEvent(PLAYGROUND_LANGUAGE_ID, '{ $exists: true }');
        onDidChangeTextDocumentCallback!(event);
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it('should NOT execute leaveSnippet for non-delimiter characters', () => {
        const event = makeChangeEvent(PLAYGROUND_LANGUAGE_ID, 'a');
        onDidChangeTextDocumentCallback!(event);
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it('should NOT execute leaveSnippet for empty changes', () => {
        const event: vscode.TextDocumentChangeEvent = {
            document: { languageId: PLAYGROUND_LANGUAGE_ID } as vscode.TextDocument,
            contentChanges: [],
            reason: undefined,
        };
        onDidChangeTextDocumentCallback!(event);
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it('should dispose the document change listener', () => {
        const disposeSpy = (mockOnDidChangeTextDocument.mock.results[0]?.value as { dispose: jest.Mock })?.dispose;
        manager.dispose();
        expect(disposeSpy).toHaveBeenCalled();
    });
});
