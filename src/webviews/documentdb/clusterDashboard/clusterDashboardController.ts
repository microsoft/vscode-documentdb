/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { API } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { openAppWebview, type AppWebviewController } from '../../_integration/openAppWebview';
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

function getPanelKey(clusterId: string, selectedDatabaseName?: string): string {
    return `${clusterId}\u0000${selectedDatabaseName ?? ''}`;
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
