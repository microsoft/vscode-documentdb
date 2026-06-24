/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { PLAYGROUND_LANGUAGE_ID, PlaygroundCommandIds } from './constants';
import { type PlaygroundConnection } from './types';

/**
 * Normalize playground text for content correlation across an untitled→file save.
 * Trailing whitespace/newlines are ignored so that save-time transforms (e.g.
 * `files.insertFinalNewline`, `files.trimTrailingWhitespace`) don't break the match.
 */
function normalizePlaygroundText(text: string): string {
    return text.replace(/\s+$/, '');
}

/**
 * Character length of a document, computed via `offsetAt` so it does NOT
 * materialize the full text the way `getText().length` would. `offsetAt` walks
 * the document's internal line-offset model, so it stays cheap even for very
 * large files (including a single huge line). Used to gate content correlation
 * before any `getText()` call.
 */
function getDocumentCharLength(doc: vscode.TextDocument): number {
    return doc.offsetAt(new vscode.Position(doc.lineCount, 0));
}

/**
 * Upper bound (in characters) on documents eligible for save-time content
 * correlation. Playgrounds are small query scripts; anything larger is skipped
 * to avoid unnecessary string work — such a file simply won't auto-reconnect
 * (no worse than before this feature existed).
 */
const MAX_TRANSFER_TEXT_LENGTH = 1_000_000; // ~1 MB of text

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

    /** Cluster IDs that currently have a running evaluation. */
    private readonly _executingClusterIds = new Set<string>();

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
        this._disposables.push(
            vscode.workspace.onDidCloseTextDocument((doc) => {
                if (doc.languageId === PLAYGROUND_LANGUAGE_ID) {
                    if (this._connections.delete(doc.uri.toString())) {
                        this._onDidChangeState.fire();
                    }
                }
            }),
        );

        // Transfer the connection when a playground is saved under a new URI.
        //
        // Two save flows change a playground's URI and would otherwise drop its
        // connection:
        //   • untitled → file: a scratch playground saved to disk for the first time.
        //   • file → file: an already-saved playground re-saved under a new name
        //     ("Save As…").
        // In both cases VS Code opens the new `file:` document, fires the save event
        // while the source document is still open, and then closes the source. We
        // correlate the two by content and re-key the connection onto the new URI.
        //
        // We trigger on `onDidSaveTextDocument` rather than `onDidOpenTextDocument`
        // because a brand-new file's document model is still empty when it opens; by
        // the time the save event fires the text is populated and the source is still
        // open, so the match is reliable. Running before the source closes also keeps
        // the cluster from looking "orphaned" during the transition.
        this._disposables.push(
            vscode.workspace.onDidSaveTextDocument((doc) => {
                if (doc.languageId === PLAYGROUND_LANGUAGE_ID && doc.uri.scheme === 'file') {
                    this.transferConnectionToSavedFile(doc);
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
        ext.outputChannel?.trace(
            `[PlaygroundService] setConnection: ${uri.toString()} → cluster=${connection.clusterId}, db=${connection.databaseName}`,
        );
        this._connections.set(uri.toString(), connection);
        this._onDidChangeState.fire();
    }

    removeConnection(uri: vscode.Uri): void {
        ext.outputChannel?.trace(`[PlaygroundService] removeConnection: ${uri.toString()}`);
        this._connections.delete(uri.toString());
        this._onDidChangeState.fire();
    }

    /**
     * Re-key a connection onto a freshly saved `file:` playground.
     *
     * Triggered on save, this covers both URI-changing save flows:
     *   • untitled → file: a scratch playground saved to disk for the first time.
     *   • file → file: an already-saved playground re-saved as a new file ("Save As…").
     * In both, the source document is still open when the save event fires, so we
     * find it by content and move its connection onto the new URI.
     *
     * Correlation is by content (URI and filename are unreliable: Save As changes
     * both). To stay unambiguous we only transfer when exactly one *other* open
     * playground holds a connection and matches — e.g. "Save All" of two identical
     * fresh playgrounds is left alone rather than risk binding the wrong connection.
     * A regular save of an already-connected playground is a no-op (its URI is
     * unchanged, so it is already bound).
     */
    private transferConnectionToSavedFile(fileDoc: vscode.TextDocument): void {
        const fileKey = fileDoc.uri.toString();
        if (this._connections.has(fileKey)) {
            return; // already bound (regular save of a connected playground)
        }

        // Size-gate before reading: `getDocumentCharLength` uses `offsetAt` and
        // does not pull the whole file into memory the way `getText()` does.
        if (getDocumentCharLength(fileDoc) > MAX_TRANSFER_TEXT_LENGTH) {
            return; // too large to correlate cheaply — skip the transfer
        }
        const fileText = normalizePlaygroundText(fileDoc.getText());

        // The source is any *other* open playground (untitled from a first save, or a
        // file from "Save As") that still holds a connection and whose content matches.
        // Cheap filters (identity → language → has-connection → size) run before
        // `getText()`, so it is not called on unrelated or large documents.
        const matches = vscode.workspace.textDocuments.filter((doc) => {
            const key = doc.uri.toString();
            if (key === fileKey || doc.languageId !== PLAYGROUND_LANGUAGE_ID) {
                return false;
            }
            if (!this._connections.has(key)) {
                return false;
            }
            if (getDocumentCharLength(doc) > MAX_TRANSFER_TEXT_LENGTH) {
                return false;
            }
            return normalizePlaygroundText(doc.getText()) === fileText;
        });

        if (matches.length !== 1) {
            return; // no match, or ambiguous — leave connections untouched
        }

        const sourceKey = matches[0].uri.toString();
        const connection = this._connections.get(sourceKey);
        if (!connection) {
            return;
        }

        this._connections.delete(sourceKey);
        this._connections.set(fileKey, connection);
        ext.outputChannel?.trace(
            `[PlaygroundService] transferred connection on save: ${sourceKey} → ${fileKey} ` +
                `(cluster=${connection.clusterId}, db=${connection.databaseName})`,
        );
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

    /**
     * Check whether a cluster's worker is currently executing.
     * When called without arguments, returns true if any cluster is executing.
     */
    isExecuting(clusterId?: string): boolean {
        if (clusterId) {
            return this._executingClusterIds.has(clusterId);
        }
        return this._executingClusterIds.size > 0;
    }

    /**
     * Check whether the playground document at the given URI is on a cluster
     * that is currently executing.
     */
    isExecutingForUri(uri: vscode.Uri): boolean {
        const connection = this._connections.get(uri.toString());
        if (!connection) {
            return false;
        }
        return this._executingClusterIds.has(connection.clusterId);
    }

    setExecuting(clusterId: string, executing: boolean): void {
        if (executing) {
            this._executingClusterIds.add(clusterId);
        } else {
            this._executingClusterIds.delete(clusterId);
        }
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
            this._statusBarItem.command = PlaygroundCommandIds.showConnectionInfo;
            this._statusBarItem.text = `$(plug) ${displayName}`;
            this._statusBarItem.tooltip = l10n.t('Query Playground connected to {0}', displayName);
        } else {
            this._statusBarItem.command = PlaygroundCommandIds.connect;
            this._statusBarItem.text = `$(warning) ${l10n.t('Connect database')}`;
            this._statusBarItem.tooltip = l10n.t(
                'This playground has no connection. Click to connect it to a database.',
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
