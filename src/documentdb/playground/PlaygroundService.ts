/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { PLAYGROUND_LANGUAGE_ID, PlaygroundCommandIds } from './constants';
import { type PlaygroundConnection } from './types';

/**
 * Singleton service managing per-document query playground connections and execution state.
 *
 * Each playground document is permanently bound to a cluster/database connection.
 * Multiple playgrounds can be open simultaneously, each connected to different servers.
 */
export class PlaygroundService implements vscode.Disposable {
    private static _instance: PlaygroundService | undefined;

    /** Per-document connections keyed by `uri.toString()`. */
    private readonly _connections = new Map<string, PlaygroundConnection>();
    /**
     * Temporarily stashed connections for untitled→file URI migration.
     * When an untitled playground is saved, VS Code closes the untitled doc and opens a file doc.
     * We stash the connection keyed by fsPath so it can be migrated to the new URI.
     */
    private readonly _pendingMigrations = new Map<string, PlaygroundConnection>();
    private _isExecuting = false;

    private readonly _onDidChangeState = new vscode.EventEmitter<void>();
    readonly onDidChangeState: vscode.Event<void> = this._onDidChangeState.event;

    private readonly _statusBarItem: vscode.StatusBarItem;
    private readonly _disposables: vscode.Disposable[] = [];

    private constructor() {
        // StatusBarItem — left-aligned, shown only when a query playground file is the active editor
        this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this._statusBarItem.command = PlaygroundCommandIds.showConnectionInfo;
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

        // Clean up connection when a playground document is closed.
        // For untitled documents, stash the connection briefly so it can be
        // migrated if the document is being saved (untitled → file transition).
        this._disposables.push(
            vscode.workspace.onDidCloseTextDocument((doc) => {
                if (doc.languageId === PLAYGROUND_LANGUAGE_ID) {
                    const connection = this._connections.get(doc.uri.toString());
                    if (connection && doc.uri.scheme === 'untitled') {
                        this._pendingMigrations.set(doc.uri.fsPath, connection);
                        // Clear the stash after a short delay if no file doc claims it
                        setTimeout(() => {
                            this._pendingMigrations.delete(doc.uri.fsPath);
                        }, 2000);
                    }
                    this._connections.delete(doc.uri.toString());
                    this._onDidChangeState.fire();
                }
            }),
        );

        // Migrate connection when a playground file document opens after an untitled save
        this._disposables.push(
            vscode.workspace.onDidOpenTextDocument((doc) => {
                if (doc.languageId === PLAYGROUND_LANGUAGE_ID && doc.uri.scheme === 'file') {
                    const stashed = this._pendingMigrations.get(doc.uri.fsPath);
                    if (stashed) {
                        this._pendingMigrations.delete(doc.uri.fsPath);
                        this._connections.set(doc.uri.toString(), stashed);
                        this._onDidChangeState.fire();
                    }
                }
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

    setConnection(uri: vscode.Uri, connection: PlaygroundConnection): void {
        this._connections.set(uri.toString(), connection);
        this._onDidChangeState.fire();
    }

    removeConnection(uri: vscode.Uri): void {
        this._connections.delete(uri.toString());
        this._onDidChangeState.fire();
    }

    isConnected(uri: vscode.Uri): boolean {
        return this._connections.has(uri.toString());
    }

    getConnection(uri: vscode.Uri): PlaygroundConnection | undefined {
        return this._connections.get(uri.toString());
    }

    /**
     * Returns a human-readable display string for a document's connection,
     * e.g. "MyCluster / orders". Returns `undefined` if disconnected.
     */
    getDisplayName(uri: vscode.Uri): string | undefined {
        const connection = this._connections.get(uri.toString());
        if (!connection) {
            return undefined;
        }
        return `${connection.clusterDisplayName} / ${connection.databaseName}`;
    }

    /**
     * Returns all cluster IDs that have at least one open playground document.
     */
    getActiveClusterIds(): Set<string> {
        const ids = new Set<string>();
        for (const conn of this._connections.values()) {
            ids.add(conn.clusterId);
        }
        return ids;
    }

    /**
     * Check whether any open playground document is connected to the given cluster.
     */
    hasPlaygroundsForCluster(clusterId: string): boolean {
        for (const conn of this._connections.values()) {
            if (conn.clusterId === clusterId) {
                return true;
            }
        }
        return false;
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

        const displayName = this.getDisplayName(editor.document.uri);
        if (displayName) {
            this._statusBarItem.text = `$(plug) ${displayName}`;
            this._statusBarItem.tooltip = l10n.t('Query Playground connected to {0}', displayName);
        } else {
            this._statusBarItem.text = `$(warning) ${l10n.t('No database connected')}`;
            this._statusBarItem.tooltip = l10n.t(
                'This playground has no connection. Create a new playground from the DocumentDB panel.',
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
        this._connections.clear();
        PlaygroundService._instance = undefined;
    }
}
