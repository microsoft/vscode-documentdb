/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { API } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { openAppWebview, type AppWebviewController } from '../../_integration/openAppWebview';
import {
    CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS,
    type ClusterDashboardContextMenuAction,
    type ClusterDashboardContextMenuContext,
    type ClusterDashboardContextMenuMessage,
} from './clusterDashboardContextMenu';
import { type RouterContext } from './clusterDashboardRouter';

/**
 * Azure resource facts for an Azure-backed cluster.
 *
 * Taken from the tree's `AzureClusterModel`, which the discovery views already populated
 * from ARM — so the dashboard shows the cluster's shape and resilience at no extra API
 * cost. Every field is optional: a local emulator, a self-hosted server, or a connection
 * added by connection string has none of them, and the header simply omits those rows.
 */
export type ClusterDashboardAzureInfo = {
    /** Azure region id, e.g. `westus2`. */
    location?: string;
    /** Compute tier, e.g. `M10`. */
    sku?: string;
    /** Number of shards/nodes. */
    nodeCount?: number;
    /** Provisioned disk size, in GB. */
    diskSize?: number;
    /** Whether in-region high availability (standby replicas per shard) is enabled. */
    enableHa?: boolean;
    /** Cross-region replication role, e.g. `Primary`. */
    replicaRole?: string;
};

export type ClusterDashboardWebviewConfigurationType = {
    /**
     * Stable cluster identifier used for client/credential lookups.
     * @see RouterContext.clusterId
     */
    clusterId: string;
    /** Human-readable cluster display name shown in the dashboard header. */
    clusterDisplayName: string;
    /**
     * Identifies which tree view this cluster belongs to.
     * @see Views enum
     */
    viewId: string;
    /** Polling cadence of the live health tiles, in milliseconds. */
    refreshIntervalMs: number;
    /**
     * Whether the thumbs-up / thumbs-down card may be offered, mirroring the Collection
     * View: true only when VS Code's telemetry level is `all`.
     */
    feedbackSignalsEnabled: boolean;
    /** Azure resource facts, when the cluster came from an Azure-backed tree node. */
    azure?: ClusterDashboardAzureInfo;
    /** Database selected from the tree when opening the dashboard, if any. */
    selectedDatabaseName?: string;
};

/**
 * Open dashboard panels keyed by cluster and selected database. A matching invocation reuses
 * its panel, while a different database can remain open beside it.
 */
const openPanels = new Map<string, AppWebviewController<ClusterDashboardWebviewConfigurationType>>();

const contextMenuActions: Readonly<Record<string, ClusterDashboardContextMenuAction>> = {
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.viewCollections]: 'viewCollections',
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.openCollection]: 'openCollection',
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.manageIndexes]: 'manageIndexes',
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.copyReference]: 'vscode-documentdb.command.copyReference',
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.openShell]: 'vscode-documentdb.command.shell.open',
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.newPlayground]: 'vscode-documentdb.command.playground.new',
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.deleteDatabase]: 'vscode-documentdb.command.dropDatabase',
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.copyCollection]: 'vscode-documentdb.command.copyCollection',
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.pasteCollection]: 'vscode-documentdb.command.pasteCollection',
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.exportDocuments]: 'vscode-documentdb.command.exportDocuments',
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.importDocuments]: 'vscode-documentdb.command.importDocuments',
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.deleteCollection]: 'vscode-documentdb.command.dropCollection',
};

function getPanelKey(clusterId: string, selectedDatabaseName?: string): string {
    return `${clusterId}\u0000${selectedDatabaseName ?? ''}`;
}

function isContextMenuContext(value: unknown): value is ClusterDashboardContextMenuContext {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const context = value as Partial<ClusterDashboardContextMenuContext>;
    return (
        typeof context.clusterDashboardClusterId === 'string' &&
        typeof context.clusterDashboardDatabase === 'string' &&
        (context.clusterDashboardSelectedDatabase === undefined ||
            typeof context.clusterDashboardSelectedDatabase === 'string') &&
        (context.clusterDashboardCollection === undefined || typeof context.clusterDashboardCollection === 'string')
    );
}

export function registerClusterDashboardContextMenuCommands(context: vscode.ExtensionContext): void {
    for (const [commandId, action] of Object.entries(contextMenuActions)) {
        context.subscriptions.push(
            vscode.commands.registerCommand(commandId, async (commandContext: unknown): Promise<void> => {
                if (!isContextMenuContext(commandContext)) {
                    return;
                }

                const panel = openPanels.get(
                    getPanelKey(
                        commandContext.clusterDashboardClusterId,
                        commandContext.clusterDashboardSelectedDatabase,
                    ),
                );
                if (!panel || panel.isDisposed) {
                    return;
                }

                const message: ClusterDashboardContextMenuMessage = {
                    type: 'clusterDashboard.contextMenu',
                    action,
                    databaseName: commandContext.clusterDashboardDatabase,
                    collectionName: commandContext.clusterDashboardCollection,
                };
                await panel.panel.webview.postMessage(message);
            }),
        );
    }
}

export function openClusterDashboardWebview(
    initialData: ClusterDashboardWebviewConfigurationType,
): AppWebviewController<ClusterDashboardWebviewConfigurationType> {
    const panelKey = getPanelKey(initialData.clusterId, initialData.selectedDatabaseName);
    const existingPanel = openPanels.get(panelKey);
    if (existingPanel && !existingPanel.isDisposed) {
        existingPanel.revealToForeground();
        return existingPanel;
    }

    const trpcContext: RouterContext = {
        dbExperience: API.DocumentDB,
        webviewName: 'clusterDashboard',
        clusterId: initialData.clusterId,
        clusterDisplayName: initialData.clusterDisplayName,
        viewId: initialData.viewId,
    };

    const controller = openAppWebview<ClusterDashboardWebviewConfigurationType>({
        title:
            initialData.selectedDatabaseName === undefined
                ? l10n.t('Dashboard: {clusterDisplayName}', { clusterDisplayName: initialData.clusterDisplayName })
                : l10n.t('Dashboard: {clusterDisplayName} / {databaseName}', {
                      clusterDisplayName: initialData.clusterDisplayName,
                      databaseName: initialData.selectedDatabaseName,
                  }),
        webviewName: 'clusterDashboard',
        panelViewType: 'vscode-documentdb-cluster-dashboard',
        config: initialData,
        context: trpcContext,
        viewColumn: vscode.ViewColumn.One,
        icon: {
            light: vscode.Uri.joinPath(ext.context.extensionUri, 'resources', 'icons', 'collection-view-light.svg'),
            dark: vscode.Uri.joinPath(ext.context.extensionUri, 'resources', 'icons', 'collection-view-dark.svg'),
        },
    });

    openPanels.set(panelKey, controller);
    controller.onDisposed(() => {
        if (openPanels.get(panelKey) === controller) {
            openPanels.delete(panelKey);
        }
    });

    return controller;
}
