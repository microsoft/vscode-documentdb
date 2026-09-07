/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { openCollectionViewInternal } from '../../../commands/openCollectionView/openCollectionView';
import { API } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { openAppWebview, type AppWebviewController } from '../../_integration/openAppWebview';
import {
    CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS,
    type ClusterDashboardContextMenuContext,
    type ShowCollectionsMessage,
} from './clusterDashboardContextMenu';
import { type RouterContext } from './clusterDashboardRouter';
import { resolveNamespaceNode } from './resolveNamespaceNode';

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
const openPanels = new Map<string, OpenPanel>();

interface OpenPanel {
    readonly controller: AppWebviewController<ClusterDashboardWebviewConfigurationType>;
    readonly config: ClusterDashboardWebviewConfigurationType;
}

/**
 * What a context-menu entry does with the row it was opened on.
 *
 * `treeCommand` ids are the tree's own database/collection commands, so a drop from the
 * dashboard is the same drop as from the tree — same confirmation, same telemetry, same
 * refresh — rather than a second implementation of it.
 */
type RowAction =
    | { readonly kind: 'showCollections' }
    | { readonly kind: 'collectionView'; readonly initialTab?: 'tab_indexes' }
    | { readonly kind: 'treeCommand'; readonly commandId: string };

const ROW_ACTIONS: Readonly<Record<string, RowAction>> = {
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.viewCollections]: { kind: 'showCollections' },
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.openCollection]: { kind: 'collectionView' },
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.manageIndexes]: { kind: 'collectionView', initialTab: 'tab_indexes' },
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.copyReference]: {
        kind: 'treeCommand',
        commandId: 'vscode-documentdb.command.copyReference',
    },
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.openShell]: {
        kind: 'treeCommand',
        commandId: 'vscode-documentdb.command.shell.open',
    },
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.newPlayground]: {
        kind: 'treeCommand',
        commandId: 'vscode-documentdb.command.playground.new',
    },
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.deleteDatabase]: {
        kind: 'treeCommand',
        commandId: 'vscode-documentdb.command.dropDatabase',
    },
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.copyCollection]: {
        kind: 'treeCommand',
        commandId: 'vscode-documentdb.command.copyCollection',
    },
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.pasteCollection]: {
        kind: 'treeCommand',
        commandId: 'vscode-documentdb.command.pasteCollection',
    },
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.exportDocuments]: {
        kind: 'treeCommand',
        commandId: 'vscode-documentdb.command.exportDocuments',
    },
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.importDocuments]: {
        kind: 'treeCommand',
        commandId: 'vscode-documentdb.command.importDocuments',
    },
    [CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.deleteCollection]: {
        kind: 'treeCommand',
        commandId: 'vscode-documentdb.command.dropCollection',
    },
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

/**
 * Carries out one context-menu entry against the row it was opened on.
 *
 * The menu command already runs on the host with everything it needs, so the work happens
 * here rather than being relayed to the webview and mutated back through tRPC. The dashboard
 * reads its inventory from the server, so a row is not a tree node; the node is found again
 * from the stable `clusterId` and handed to the tree's own command unchanged.
 */
async function runRowAction(
    actionContext: IActionContext,
    action: RowAction,
    panel: OpenPanel,
    menuContext: ClusterDashboardContextMenuContext,
): Promise<void> {
    const databaseName = menuContext.clusterDashboardDatabase;
    const collectionName = menuContext.clusterDashboardCollection;

    actionContext.telemetry.properties.namespaceLevel = collectionName === undefined ? 'database' : 'collection';

    if (action.kind === 'showCollections') {
        const message: ShowCollectionsMessage = { type: 'clusterDashboard.showCollections', databaseName };
        await panel.controller.panel.webview.postMessage(message);
        return;
    }

    if (action.kind === 'collectionView') {
        if (collectionName === undefined) {
            return;
        }

        await openCollectionViewInternal(actionContext, {
            clusterId: panel.config.clusterId,
            clusterDisplayName: panel.config.clusterDisplayName,
            viewId: panel.config.viewId,
            databaseName,
            collectionName,
            initialTab: action.initialTab,
        });
        return;
    }

    actionContext.telemetry.properties.namespaceCommand = action.commandId;

    const node = await resolveNamespaceNode(panel.config.viewId, panel.config.clusterId, databaseName, collectionName);

    if (!node) {
        actionContext.telemetry.properties.failureReason = 'namespaceNodeNotFound';
        void vscode.window.showErrorMessage(
            l10n.t(
                'This action needs "{name}" to be present in the tree view, and it could not be found there. Expand this cluster in the tree and try again.',
                { name: collectionName ?? databaseName },
            ),
            { modal: true },
        );
        return;
    }

    await vscode.commands.executeCommand(action.commandId, node, null, { source: 'webview;clusterDashboard' });
}

export function registerClusterDashboardContextMenuCommands(context: vscode.ExtensionContext): void {
    for (const [commandId, action] of Object.entries(ROW_ACTIONS)) {
        context.subscriptions.push(
            vscode.commands.registerCommand(commandId, async (menuContext: unknown): Promise<void> => {
                if (!isContextMenuContext(menuContext)) {
                    return;
                }

                const panel = openPanels.get(
                    getPanelKey(menuContext.clusterDashboardClusterId, menuContext.clusterDashboardSelectedDatabase),
                );
                if (!panel || panel.controller.isDisposed) {
                    return;
                }

                await callWithTelemetryAndErrorHandling(
                    'clusterDashboard.contextMenuAction',
                    async (actionContext: IActionContext) => {
                        actionContext.telemetry.properties.contextMenuCommand = commandId;
                        await runRowAction(actionContext, action, panel, menuContext);
                    },
                );
            }),
        );
    }
}

export function openClusterDashboardWebview(
    initialData: ClusterDashboardWebviewConfigurationType,
): AppWebviewController<ClusterDashboardWebviewConfigurationType> {
    const panelKey = getPanelKey(initialData.clusterId, initialData.selectedDatabaseName);
    const existingPanel = openPanels.get(panelKey);
    if (existingPanel && !existingPanel.controller.isDisposed) {
        existingPanel.controller.revealToForeground();
        return existingPanel.controller;
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

    openPanels.set(panelKey, { controller, config: initialData });
    controller.onDisposed(() => {
        if (openPanels.get(panelKey)?.controller === controller) {
            openPanels.delete(panelKey);
        }
    });

    return controller;
}
