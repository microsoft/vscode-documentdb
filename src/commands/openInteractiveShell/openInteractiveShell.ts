/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { DocumentDBShellPty } from '../../documentdb/shell/DocumentDBShellPty';
import { type ShellConnectionInfo } from '../../documentdb/shell/ShellSessionManager';
import { registerShellTerminal } from '../../documentdb/shell/ShellTerminalLinkProvider';
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';

/**
 * Parameters for opening an interactive shell with pre-formatted content.
 * Used by cross-feature navigation (Collection View → Shell, Playground → Shell).
 */
export interface OpenShellWithInputParams {
    readonly clusterId: string;
    readonly clusterDisplayName: string;
    readonly databaseName: string;
    /** Optional command to pre-fill in the shell input line (not executed). */
    readonly initialInput?: string;
}

/**
 * Opens an interactive DocumentDB shell in a VS Code terminal.
 *
 * Can be invoked from:
 * - Cluster node → opens shell connected to default database ("test")
 * - Database node → opens shell connected to that database
 * - Collection node → opens shell connected to that collection's database
 *
 * The command creates a Pseudoterminal with a dedicated worker thread per session.
 */
export async function openInteractiveShell(
    context: IActionContext,
    node?: ClusterItemBase | DatabaseItem | CollectionItem,
): Promise<void> {
    if (!node) {
        void vscode.window.showInformationMessage(
            l10n.t(
                'Right-click a cluster, database, or collection in the DocumentDB panel to open an interactive shell.',
            ),
        );
        return;
    }

    const connectionInfo = extractConnectionInfo(node);

    // Verify credentials are available before opening the terminal
    if (!CredentialCache.hasCredentials(connectionInfo.clusterId)) {
        void vscode.window.showErrorMessage(
            l10n.t('Not signed in to {0}. Please authenticate first.', connectionInfo.clusterDisplayName),
        );
        return;
    }

    context.telemetry.properties.experience = node.experience.api;
    context.telemetry.properties.nodeType = getNodeType(node);

    const pty = new DocumentDBShellPty({ connectionInfo });

    const terminal = vscode.window.createTerminal({
        name: l10n.t('DocumentDB: {0}/{1}', connectionInfo.clusterDisplayName, connectionInfo.databaseName),
        pty,
        iconPath: new vscode.ThemeIcon('terminal'),
    });

    pty.setTerminal(terminal);
    registerShellTerminal(terminal, () => pty.getTerminalInfo());

    terminal.show();
}

/**
 * Opens an interactive shell with explicit connection info and optional pre-filled input.
 *
 * Used by cross-feature navigation (Collection View → Shell, Playground → Shell).
 * Unlike {@link openInteractiveShell}, this does not require a tree node.
 */
export async function openInteractiveShellWithInput(
    _context: IActionContext,
    params?: OpenShellWithInputParams,
): Promise<void> {
    if (!params) {
        return;
    }

    const connectionInfo: ShellConnectionInfo = {
        clusterId: params.clusterId,
        clusterDisplayName: params.clusterDisplayName,
        databaseName: params.databaseName,
    };

    // Verify credentials are available before opening the terminal
    if (!CredentialCache.hasCredentials(connectionInfo.clusterId)) {
        void vscode.window.showErrorMessage(
            l10n.t('Not signed in to {0}. Please authenticate first.', connectionInfo.clusterDisplayName),
        );
        return;
    }

    const pty = new DocumentDBShellPty({
        connectionInfo,
        initialInput: params.initialInput,
    });

    const terminal = vscode.window.createTerminal({
        name: l10n.t('DocumentDB: {0}/{1}', connectionInfo.clusterDisplayName, connectionInfo.databaseName),
        pty,
        iconPath: new vscode.ThemeIcon('terminal'),
    });

    pty.setTerminal(terminal);
    registerShellTerminal(terminal, () => pty.getTerminalInfo());

    terminal.show();
}

/**
 * Extract connection info from a tree node.
 *
 * Uses `clusterId` (stable) for cache lookups, NOT `treeId` (changes on folder move).
 */
function extractConnectionInfo(node: ClusterItemBase | DatabaseItem | CollectionItem): ShellConnectionInfo {
    // Database and collection nodes have `databaseInfo`
    if ('databaseInfo' in node) {
        return {
            clusterId: node.cluster.clusterId,
            clusterDisplayName: node.cluster.name,
            databaseName: node.databaseInfo.name,
        };
    }

    // Cluster-level node — use "test" as default database (matches mongosh convention)
    return {
        clusterId: node.cluster.clusterId,
        clusterDisplayName: node.cluster.name,
        databaseName: 'test',
    };
}

function getNodeType(node: ClusterItemBase | DatabaseItem | CollectionItem): string {
    if ('collectionInfo' in node) {
        return 'collection';
    }
    if ('databaseInfo' in node) {
        return 'database';
    }
    return 'cluster';
}
