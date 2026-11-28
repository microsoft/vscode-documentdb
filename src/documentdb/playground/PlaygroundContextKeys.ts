/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { PLAYGROUND_LANGUAGE_ID } from './constants';
import { PlaygroundService } from './PlaygroundService';
import { blockContainsCode, detectBlocks, resolveBlockAtLine } from './statementDetector';

export const PlaygroundContextKeys = {
    connected: 'documentdbPlaygroundConnected',
    blockHasCode: 'documentdbPlaygroundBlockHasCode',
} as const;

export class PlaygroundContextKeyTracker implements vscode.Disposable {
    private readonly _service: PlaygroundService;
    private readonly _disposables: vscode.Disposable[] = [];
    private _connected: boolean | undefined;
    private _blockHasCode: boolean | undefined;

    constructor(service: PlaygroundService = PlaygroundService.getInstance()) {
        this._service = service;
        this._disposables.push(
            this._service.onDidChangeState(() => this.refresh()),
            vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
            vscode.window.onDidChangeTextEditorSelection((event) => {
                if (event.textEditor === vscode.window.activeTextEditor) {
                    this.refresh();
                }
            }),
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (event.document === vscode.window.activeTextEditor?.document) {
                    this.refresh();
                }
            }),
        );
        this.refresh();
    }

    refresh(): void {
        const editor = vscode.window.activeTextEditor;
        let connected = false;
        let blockHasCode = false;

        if (editor?.document.languageId === PLAYGROUND_LANGUAGE_ID) {
            connected = this._service.isConnected(editor.document.uri);
            const block = resolveBlockAtLine(detectBlocks(editor.document), editor.selection.active.line)?.block;
            blockHasCode = block ? blockContainsCode(editor.document, block) : false;
        }

        this.updateContextKey(PlaygroundContextKeys.connected, connected, '_connected');
        this.updateContextKey(PlaygroundContextKeys.blockHasCode, blockHasCode, '_blockHasCode');
    }

    dispose(): void {
        for (const disposable of this._disposables) {
            disposable.dispose();
        }
    }

    private updateContextKey(key: string, value: boolean, property: '_connected' | '_blockHasCode'): void {
        if (this[property] === value) {
            return;
        }
        this[property] = value;

        void vscode.commands.executeCommand('setContext', key, value).then(
            (): void => undefined,
            (error: unknown): void => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                ext.outputChannel.error(vscode.l10n.t('Failed to update Query Playground context: {0}', errorMessage));
            },
        );
    }
}
