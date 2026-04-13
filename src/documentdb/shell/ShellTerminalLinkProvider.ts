/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { Views } from '../Views';

/**
 * Metadata about an active shell terminal, exposed by the PTY
 * for the link provider to build navigation actions.
 */
export interface ShellTerminalInfo {
    /** Stable cluster ID for CredentialCache and session lookups. */
    readonly clusterId: string;
}

/**
 * Registry mapping active shell terminals to their metadata.
 *
 * Populated by the shell command handler when a terminal is created,
 * queried by the link provider to build navigation actions.
 */
const shellTerminalRegistry = new Map<vscode.Terminal, ShellTerminalInfoProvider>();

/**
 * A function that returns the current {@link ShellTerminalInfo} for a shell terminal.
 * Called lazily so the link provider always gets the latest state.
 */
export type ShellTerminalInfoProvider = () => ShellTerminalInfo;

/**
 * Register a shell terminal in the link provider registry.
 * Call this after `vscode.window.createTerminal()` in the command handler.
 */
export function registerShellTerminal(terminal: vscode.Terminal, infoProvider: ShellTerminalInfoProvider): void {
    shellTerminalRegistry.set(terminal, infoProvider);
}

/**
 * Remove a shell terminal from the link provider registry.
 * Call this when the terminal PTY closes.
 */
export function unregisterShellTerminal(terminal: vscode.Terminal): void {
    shellTerminalRegistry.delete(terminal);
}

/**
 * Returns a snapshot of all registered shell terminals with their info.
 * Used by the worker task manager debug command.
 */
export function getRegisteredShellTerminals(): ReadonlyArray<{
    terminal: vscode.Terminal;
    info: ShellTerminalInfo;
}> {
    return Array.from(shellTerminalRegistry.entries()).map(([terminal, provider]) => ({
        terminal,
        info: provider(),
    }));
}

/**
 * The marker prefix for the "Open in Collection View" action line.
 *
 * The full action line format is:
 *   `📊 Open collection [<db>.<collection>] in Collection View`
 *
 * The database and collection names are enclosed in brackets so that names
 * containing special characters (e.g., `stores (10)`) are unambiguous.
 *
 * The action line format is locale-independent — only the link tooltip is localized.
 * Format: `🔗 [<db>.<collection>]`
 */
export const ACTION_LINE_PREFIX = '\u{1F517} '; // 🔗 + space

/**
 * Regex to match the "Open in Collection View" action line.
 *
 * Captures:
 * - Group 1: database name
 * - Group 2: collection name
 *
 * The pattern accounts for optional ANSI color codes (gray) that wrap the line.
 * Names are inside brackets `[db.collection]` to handle special chars in names.
 * The dot between db and collection is the first dot after the opening bracket.
 *
 * The format is locale-independent — uses the ACTION_LINE_PREFIX sentinel
 * followed by `[db.collection]`, with no English text to translate.
 */
/* eslint-disable no-control-regex -- ANSI escape codes are intentional for matching terminal output */
const ACTION_LINE_PATTERN = /(?:\x1b\[\d+m)*\u{1F517} \[([^\].]+)\.([^\]]+)\](?:\x1b\[\d+m)*/u;
/* eslint-enable no-control-regex */

/**
 * Extended terminal link that carries navigation metadata.
 */
interface CollectionViewTerminalLink extends vscode.TerminalLink {
    /** Cluster ID for opening the collection view. */
    readonly clusterId: string;
    /** Database name parsed from the action line. */
    readonly databaseName: string;
    /** Collection name parsed from the action line. */
    readonly collectionName: string;
}

/**
 * Provides clickable "Open in Collection View" links in DocumentDB shell terminals.
 *
 * After a query that targets a specific collection, the PTY appends an action line:
 *   `📊 Open collection [myDb.myCollection] in Collection View`
 *
 * This provider detects that line and makes it a clickable link that opens
 * the Collection View for that database and collection.
 *
 * Only active for terminals registered via {@link registerShellTerminal}.
 */
export class ShellTerminalLinkProvider implements vscode.TerminalLinkProvider<CollectionViewTerminalLink> {
    provideTerminalLinks(context: vscode.TerminalLinkContext): CollectionViewTerminalLink[] {
        const infoProvider = shellTerminalRegistry.get(context.terminal);
        if (!infoProvider) {
            // Not a shell terminal — no links
            return [];
        }

        const match = ACTION_LINE_PATTERN.exec(context.line);
        if (!match) {
            return [];
        }

        const info = infoProvider();
        const databaseName = match[1];
        const collectionName = match[2];

        return [
            {
                startIndex: match.index,
                length: match[0].length,
                tooltip: vscode.l10n.t('Open collection "{0}.{1}" in Collection View', databaseName, collectionName),
                clusterId: info.clusterId,
                databaseName,
                collectionName,
            },
        ];
    }

    handleTerminalLink(link: CollectionViewTerminalLink): void {
        void callWithTelemetryAndErrorHandling(
            'vscode-documentdb.shell.terminalLink.openCollectionView',
            async (context: IActionContext) => {
                context.telemetry.properties.linkType = 'collectionActionLine';

                await vscode.commands.executeCommand('vscode-documentdb.command.internal.containerView.open', {
                    clusterId: link.clusterId,
                    viewId: Views.ConnectionsView,
                    databaseName: link.databaseName,
                    collectionName: link.collectionName,
                });
            },
        );
    }
}
