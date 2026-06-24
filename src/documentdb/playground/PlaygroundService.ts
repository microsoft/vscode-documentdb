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
const MAX_MIGRATION_TEXT_LENGTH = 1_000_000; // ~1 MB of text

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

        // Migrate the connection when an untitled playground is saved to disk.
        //
        // Saving an untitled document opens a brand-new `file:` document (with a
        // different URI — Save As can change directory and filename freely) and then
        // closes the untitled one. We correlate the two by content and re-key the
        // connection onto the new URI.
        //
        // We trigger on `onDidSaveTextDocument` rather than `onDidOpenTextDocument`:
        // for a brand-new file the file's document model is still empty when it opens,
        // so content correlation would fail. By the time the save event fires the text
        // is populated and the untitled document is still open, so the match is
        // reliable. This also runs before the untitled closes, so the cluster never
        // appears "orphaned" during the transition and its worker is not torn down.
        this._disposables.push(
            vscode.workspace.onDidSaveTextDocument((doc) => {
                if (doc.languageId === PLAYGROUND_LANGUAGE_ID && doc.uri.scheme === 'file') {
                    this.migrateConnectionFromSavedUntitled(doc);
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
     * Re-key a connection from a just-saved untitled playground onto its new
     * `file:` document.
     *
     * When an untitled playground is saved, the connection is keyed by the old
     * `untitled:` URI. We find the still-open untitled playground whose content
     * matches the new file document and move its connection onto the new URI.
     *
     * Correlation is by content (URI and filename are unreliable: Save As can
     * change both, and the untitled path lives under a temp/workspace folder).
     * To stay unambiguous we only migrate when exactly one untitled playground
     * matches — e.g. "Save All" of two byte-identical fresh playgrounds is left
     * alone rather than risk binding the wrong connection.
     */
    private migrateConnectionFromSavedUntitled(fileDoc: vscode.TextDocument): void {
        const fileKey = fileDoc.uri.toString();
        if (this._connections.has(fileKey)) {
            return; // already bound (e.g. re-save of an already-migrated file)
        }

        // Size-gate before reading: `getDocumentCharLength` uses `offsetAt` and
        // does not pull the whole file into memory the way `getText()` does.
        if (getDocumentCharLength(fileDoc) > MAX_MIGRATION_TEXT_LENGTH) {
            return; // too large to correlate cheaply — skip auto-migration
        }
        const fileText = normalizePlaygroundText(fileDoc.getText());

        // Cheap filters first (scheme → language → has-connection → size); only the
        // few still-open untitled playgrounds that hold a connection ever reach the
        // content comparison, so `getText()` is not called on unrelated or large documents.
        const matches = vscode.workspace.textDocuments.filter((doc) => {
            if (doc.uri.scheme !== 'untitled' || doc.languageId !== PLAYGROUND_LANGUAGE_ID) {
                return false;
            }
            if (!this._connections.has(doc.uri.toString())) {
                return false;
            }
            if (getDocumentCharLength(doc) > MAX_MIGRATION_TEXT_LENGTH) {
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
            `[PlaygroundService] migrated connection on save: ${sourceKey} → ${fileKey} ` +
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
