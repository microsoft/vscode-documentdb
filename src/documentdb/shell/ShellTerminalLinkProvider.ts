/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { escapeJsString } from '../../utils/escapeJsString';
import { PlaygroundCommandIds } from '../playground/constants';
import { Views } from '../Views';

/**
 * Metadata about an active shell terminal, exposed by the PTY
 * for the link provider and debug stats command.
 */
export interface ShellTerminalInfo {
    /** Stable cluster ID for CredentialCache and session lookups. */
    readonly clusterId: string;
    /** Human-readable cluster display name. */
    readonly clusterDisplayName: string;
    /** Current active database name (may change after `use <db>`). */
    readonly activeDatabase: string;
    /** Whether the worker is initialized and connected. */
    readonly isInitialized: boolean;
    /** Whether the shell is currently evaluating a command. */
    readonly isEvaluating: boolean;
    /** Worker thread state. */
    readonly workerState: 'idle' | 'spawning' | 'ready' | 'executing';
    /** Authentication method used. */
    readonly authMethod: 'NativeAuth' | 'MicrosoftEntraID' | undefined;
    /** Username for SCRAM auth (undefined for Entra ID or before init). */
    readonly username: string | undefined;
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
 * Format: `  ↗ Collection View [<db>.<collection>]`
 */
export const ACTION_LINE_PREFIX = '\u{2197} Collection View '; // '↗ Collection View '

/**
 * The marker prefix for the "Open in Playground" action line.
 *
 * Format: `  ↗ Query Playground [<db>.<collection>]`
 * Uses a different text label from the Collection View link so both can appear on the same line.
 */
export const PLAYGROUND_ACTION_PREFIX = '\u{2197} Query Playground '; // '↗ Query Playground '

/**
 * The marker prefix for the "Open Settings" action line.
 *
 * Format: `⚙ [settingKey]`
 * The settings key is NOT localized — it's the programmatic VS Code setting ID.
 */
export const SETTINGS_ACTION_PREFIX = '\u{2699} '; // ⚙ + space

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
const ACTION_LINE_PATTERN = /(?:\x1b\[\d+m)*\u{2197} Collection View \[([^\].]+)\.([^\]]+)\](?:\x1b\[\d+m)*/u;
/* eslint-enable no-control-regex */

/**
 * Regex to match the "Open in Playground" action line.
 *
 * Same capture structure as ACTION_LINE_PATTERN but uses `↗ Query Playground` prefix.
 * The pattern accounts for optional ANSI color codes (gray) that wrap the line.
 */
/* eslint-disable no-control-regex -- ANSI escape codes are intentional for matching terminal output */
const PLAYGROUND_LINE_PATTERN = /(?:\x1b\[\d+m)*\u{2197} Query Playground \[([^\].]+)\.([^\]]+)\](?:\x1b\[\d+m)*/u;
/* eslint-enable no-control-regex */

/**
 * Regex to match the "Open Settings" action line.
 *
 * Captures:
 * - Group 1: the VS Code setting key (e.g., `documentDB.shell.initTimeout`)
 *
 * The pattern accounts for optional ANSI color codes that wrap the line.
 * The format is locale-independent.
 */

/* eslint-disable no-control-regex -- ANSI escape codes are intentional for matching terminal output */
const SETTINGS_LINE_PATTERN = /(?:\x1b\[\d+m)*\u{2699} \[([^\]]+)\](?:\x1b\[\d+m)*/u;
/* eslint-enable no-control-regex */

/**
 * Extended terminal link that carries navigation metadata.
 */
interface CollectionViewTerminalLink extends vscode.TerminalLink {
    readonly linkType: 'collectionView';
    /** Cluster ID for opening the collection view. */
    readonly clusterId: string;
    /** Human-readable cluster display name. */
    readonly clusterDisplayName: string;
    /** Database name parsed from the action line. */
    readonly databaseName: string;
    /** Collection name parsed from the action line. */
    readonly collectionName: string;
}

/**
 * Terminal link that opens a Query Playground.
 */
interface PlaygroundTerminalLink extends vscode.TerminalLink {
    readonly linkType: 'playground';
    /** Cluster ID for the playground connection. */
    readonly clusterId: string;
    /** Human-readable cluster display name. */
    readonly clusterDisplayName: string;
    /** Database name parsed from the action line. */
    readonly databaseName: string;
    /** Collection name parsed from the action line. */
    readonly collectionName: string;
}

/**
 * Terminal link that opens a VS Code setting.
 */
interface SettingsTerminalLink extends vscode.TerminalLink {
    readonly linkType: 'settings';
    /** The VS Code setting key to open. */
    readonly settingKey: string;
}

/**
 * Union of all shell terminal link types.
 */
type ShellTerminalLink = CollectionViewTerminalLink | PlaygroundTerminalLink | SettingsTerminalLink;

/**
 * Provides clickable navigation links in DocumentDB shell terminals.
 *
 * After a query that targets a specific collection, the PTY appends action lines
 * with sentinels (`↗ Collection View` and `↗ Query Playground`). This provider
 * detects those markers and returns clickable links.
 *
 * Multiple links can appear on the same line (e.g., `↗ Collection View [db.coll]  ↗ Query Playground [db.coll]`).
 *
 * Only active for terminals registered via {@link registerShellTerminal}.
 */
export class ShellTerminalLinkProvider implements vscode.TerminalLinkProvider<ShellTerminalLink> {
    provideTerminalLinks(context: vscode.TerminalLinkContext): ShellTerminalLink[] {
        const infoProvider = shellTerminalRegistry.get(context.terminal);
        if (!infoProvider) {
            // Not a shell terminal — no links
            return [];
        }

        const links: ShellTerminalLink[] = [];

        // Check for collection view action line (↗ Collection View)
        const collectionMatch = ACTION_LINE_PATTERN.exec(context.line);
        if (collectionMatch) {
            const info = infoProvider();
            links.push({
                linkType: 'collectionView',
                startIndex: collectionMatch.index,
                length: collectionMatch[0].length,
                tooltip: vscode.l10n.t(
                    'Open collection "{0}.{1}" in Collection View',
                    collectionMatch[1],
                    collectionMatch[2],
                ),
                clusterId: info.clusterId,
                clusterDisplayName: info.clusterDisplayName,
                databaseName: collectionMatch[1],
                collectionName: collectionMatch[2],
            });
        }

        // Check for playground action line (↗ Query Playground)
        const playgroundMatch = PLAYGROUND_LINE_PATTERN.exec(context.line);
        if (playgroundMatch) {
            const info = infoProvider();
            links.push({
                linkType: 'playground',
                startIndex: playgroundMatch.index,
                length: playgroundMatch[0].length,
                tooltip: vscode.l10n.t('Open "{0}.{1}" in Query Playground', playgroundMatch[1], playgroundMatch[2]),
                clusterId: info.clusterId,
                clusterDisplayName: info.clusterDisplayName,
                databaseName: playgroundMatch[1],
                collectionName: playgroundMatch[2],
            });
        }

        if (links.length > 0) {
            return links;
        }

        // Check for settings action line
        const settingsMatch = SETTINGS_LINE_PATTERN.exec(context.line);
        if (settingsMatch) {
            const settingKey = settingsMatch[1];
            return [
                {
                    linkType: 'settings',
                    startIndex: settingsMatch.index,
                    length: settingsMatch[0].length,
                    tooltip: vscode.l10n.t('Open setting: {0}', settingKey),
                    settingKey,
                },
            ];
        }

        return [];
    }

    handleTerminalLink(link: ShellTerminalLink): void {
        if (link.linkType === 'settings') {
            void callWithTelemetryAndErrorHandling(
                'vscode-documentdb.shell.terminalLink.openSettings',
                async (context: IActionContext) => {
                    context.telemetry.properties.linkType = 'settingsActionLine';
                    context.telemetry.properties.settingKey = link.settingKey;

                    await vscode.commands.executeCommand('workbench.action.openSettings', link.settingKey);
                },
            );
            return;
        }

        if (link.linkType === 'playground') {
            void callWithTelemetryAndErrorHandling(
                'vscode-documentdb.shell.terminalLink.openPlayground',
                async (context: IActionContext) => {
                    context.telemetry.properties.linkType = 'playgroundActionLine';
                    context.telemetry.properties.activationSource = 'shellActionLine';

                    const escaped = escapeJsString(link.collectionName);
                    const content = `db.getCollection('${escaped}').find({ })`;

                    await vscode.commands.executeCommand(PlaygroundCommandIds.newWithContent, {
                        clusterId: link.clusterId,
                        clusterDisplayName: link.clusterDisplayName,
                        databaseName: link.databaseName,
                        content,
                    });
                },
            );
            return;
        }

        void callWithTelemetryAndErrorHandling(
            'vscode-documentdb.shell.terminalLink.openCollectionView',
            async (context: IActionContext) => {
                context.telemetry.properties.linkType = 'collectionActionLine';
                context.telemetry.properties.activationSource = 'shellActionLine';

                await vscode.commands.executeCommand('vscode-documentdb.command.internal.containerView.open', {
                    clusterId: link.clusterId,
                    clusterDisplayName: link.clusterDisplayName,
                    viewId: Views.ConnectionsView,
                    databaseName: link.databaseName,
                    collectionName: link.collectionName,
                });
            },
        );
    }
}
