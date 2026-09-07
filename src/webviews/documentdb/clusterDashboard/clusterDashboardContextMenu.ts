/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type NamespaceCommandId } from './clusterDashboardRouter';

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

export type ClusterDashboardContextMenuAction =
    | 'viewCollections'
    | 'openCollection'
    | 'manageIndexes'
    | NamespaceCommandId;

const clusterDashboardContextMenuActions: ReadonlySet<string> = new Set([
    'viewCollections',
    'openCollection',
    'manageIndexes',
    'vscode-documentdb.command.copyReference',
    'vscode-documentdb.command.shell.open',
    'vscode-documentdb.command.playground.new',
    'vscode-documentdb.command.dropDatabase',
    'vscode-documentdb.command.copyCollection',
    'vscode-documentdb.command.pasteCollection',
    'vscode-documentdb.command.exportDocuments',
    'vscode-documentdb.command.importDocuments',
    'vscode-documentdb.command.dropCollection',
]);

export interface ClusterDashboardContextMenuMessage {
    readonly type: 'clusterDashboard.contextMenu';
    readonly action: ClusterDashboardContextMenuAction;
    readonly databaseName: string;
    readonly collectionName?: string;
}

export interface ClusterDashboardContextMenuContext {
    readonly clusterDashboardClusterId: string;
    readonly clusterDashboardSelectedDatabase?: string;
    readonly clusterDashboardDatabase: string;
    readonly clusterDashboardCollection?: string;
}

export function isClusterDashboardContextMenuMessage(value: unknown): value is ClusterDashboardContextMenuMessage {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const message = value as Partial<ClusterDashboardContextMenuMessage>;
    return (
        message.type === 'clusterDashboard.contextMenu' &&
        typeof message.action === 'string' &&
        clusterDashboardContextMenuActions.has(message.action) &&
        typeof message.databaseName === 'string' &&
        (message.collectionName === undefined || typeof message.collectionName === 'string')
    );
}
