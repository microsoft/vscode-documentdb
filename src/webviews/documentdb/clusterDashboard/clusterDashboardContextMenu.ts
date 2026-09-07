/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The contract between a dashboard row's native VS Code context menu and the panel it was
 * opened on. Imported by both the host and the webview, so nothing host-only may live here.
 */

/** Context-menu command ids, contributed under `webview/context` in `package.json`. */
export const CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS = {
    viewCollections: 'vscode-documentdb.command.clusterDashboard.context.viewCollections',
    openCollection: 'vscode-documentdb.command.clusterDashboard.context.openCollection',
    manageIndexes: 'vscode-documentdb.command.clusterDashboard.context.manageIndexes',
    copyReference: 'vscode-documentdb.command.clusterDashboard.context.copyReference',
    openShell: 'vscode-documentdb.command.clusterDashboard.context.openShell',
    newPlayground: 'vscode-documentdb.command.clusterDashboard.context.newPlayground',
    deleteDatabase: 'vscode-documentdb.command.clusterDashboard.context.deleteDatabase',
    copyCollection: 'vscode-documentdb.command.clusterDashboard.context.copyCollection',
    pasteCollection: 'vscode-documentdb.command.clusterDashboard.context.pasteCollection',
    exportDocuments: 'vscode-documentdb.command.clusterDashboard.context.exportDocuments',
    importDocuments: 'vscode-documentdb.command.clusterDashboard.context.importDocuments',
    deleteCollection: 'vscode-documentdb.command.clusterDashboard.context.deleteCollection',
} as const;

export type ClusterDashboardContextMenuCommandId =
    (typeof CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS)[keyof typeof CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS];

/**
 * The `data-vscode-context` payload a row publishes, and therefore the argument VS Code
 * hands to the context-menu command.
 */
export interface ClusterDashboardContextMenuContext {
    readonly clusterDashboardClusterId: string;
    readonly clusterDashboardSelectedDatabase?: string;
    readonly clusterDashboardDatabase: string;
    readonly clusterDashboardCollection?: string;
}

/**
 * The one menu entry the host cannot carry out on its own: stepping the open panel into a
 * database. Everything else acts on the tree node the row names and never reaches the
 * webview at all.
 */
export interface ShowCollectionsMessage {
    readonly type: 'clusterDashboard.showCollections';
    readonly databaseName: string;
}

export function isShowCollectionsMessage(value: unknown): value is ShowCollectionsMessage {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const message = value as Partial<ShowCollectionsMessage>;
    return message.type === 'clusterDashboard.showCollections' && typeof message.databaseName === 'string';
}
