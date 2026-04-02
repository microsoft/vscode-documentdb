/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { PLAYGROUND_LANGUAGE_ID, PlaygroundCommandIds } from './constants';
import { type PlaygroundConnection } from './types';

/**
 * Singleton service managing the active query playground connection and execution state.
 *
 * Design decisions (from 06-scrapbook-rebuild.md (historical reference)):
 * - D1 (Option B): All query playground files share a single global connection
 * - StatusBarItem shows connection status when a `.documentdb.js` file is active
 * - Service emits state changes so UI components (CodeLens, StatusBar) can refresh
 */
export class PlaygroundService implements vscode.Disposable {
    private static _instance: PlaygroundService | undefined;

    private _connection: PlaygroundConnection | undefined;
    private _isExecuting = false;

    private readonly _onDidChangeState = new vscode.EventEmitter<void>();
    readonly onDidChangeState: vscode.Event<void> = this._onDidChangeState.event;

    private readonly _statusBarItem: vscode.StatusBarItem;
    private readonly _disposables: vscode.Disposable[] = [];

    private constructor() {
        // StatusBarItem — left-aligned, shown only when a query playground file is the active editor
        this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this._statusBarItem.command = PlaygroundCommandIds.connect;
        this._disposables.push(this._statusBarItem);

        // Update StatusBar visibility when the active editor changes
        this._disposables.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                this.updateStatusBar(editor);
            }),
        );

        // Also listen for state changes to refresh the bar text
        this._disposables.push(
            this.onDidChangeState(() => {
                this.updateStatusBar(vscode.window.activeTextEditor);
            }),
        );

        // Initialize with current editor
        this.updateStatusBar(vscode.window.activeTextEditor);
    }

    static getInstance(): PlaygroundService {
        if (!PlaygroundService._instance) {
            PlaygroundService._instance = new PlaygroundService();
        }
        return PlaygroundService._instance;
    }

    // ── Connection management ──────────────────────────────────────────

    setConnection(connection: PlaygroundConnection): void {
        this._connection = connection;
        this._onDidChangeState.fire();
    }

    clearConnection(): void {
        this._connection = undefined;
        this._onDidChangeState.fire();
    }

    isConnected(): boolean {
        return this._connection !== undefined;
    }

    getConnection(): PlaygroundConnection | undefined {
        return this._connection;
    }

    /**
     * Returns a human-readable display string for the active connection,
     * e.g. "MyCluster / orders". Returns `undefined` if disconnected.
     */
    getDisplayName(): string | undefined {
        if (!this._connection) {
            return undefined;
        }
        return `${this._connection.clusterDisplayName} / ${this._connection.databaseName}`;
    }

    // ── Execution state ────────────────────────────────────────────────

    get isExecuting(): boolean {
        return this._isExecuting;
    }

    setExecuting(executing: boolean): void {
        this._isExecuting = executing;
        this._onDidChangeState.fire();
    }

    // ── StatusBar ──────────────────────────────────────────────────────

    private updateStatusBar(editor: vscode.TextEditor | undefined): void {
        if (!editor || editor.document.languageId !== PLAYGROUND_LANGUAGE_ID) {
            this._statusBarItem.hide();
            return;
        }

        if (this._connection) {
            const displayName = this.getDisplayName()!;
            this._statusBarItem.text = `$(plug) ${displayName}`;
            this._statusBarItem.tooltip = l10n.t('Query Playground connected to {0}', displayName);
        } else {
            this._statusBarItem.text = `$(warning) ${l10n.t('No database connected')}`;
            this._statusBarItem.tooltip = l10n.t(
                'Click to learn how to connect a database for the Query Playground',
            );
        }

        this._statusBarItem.show();
    }

    // ── Lifecycle ──────────────────────────────────────────────────────

    dispose(): void {
        for (const d of this._disposables) {
            d?.dispose();
        }
        this._onDidChangeState.dispose();
        PlaygroundService._instance = undefined;
    }
}
