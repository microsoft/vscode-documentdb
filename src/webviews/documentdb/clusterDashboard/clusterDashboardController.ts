/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { API } from '../../../DocumentDBExperiences';
import { openAppWebview, type AppWebviewController } from '../../_integration/openAppWebview';
import { type RouterContext } from './clusterDashboardRouter';
import { clearObservedOperations } from './operationHistory';

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
};

/**
 * Open dashboard panels keyed by `clusterId`, so a second invocation reveals the
 * existing panel instead of opening a duplicate that would double the polling load.
 */
const openPanels = new Map<string, AppWebviewController<ClusterDashboardWebviewConfigurationType>>();

export function openClusterDashboardWebview(
    initialData: ClusterDashboardWebviewConfigurationType,
): AppWebviewController<ClusterDashboardWebviewConfigurationType> {
    const existingPanel = openPanels.get(initialData.clusterId);
    if (existingPanel && !existingPanel.isDisposed) {
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
        title: l10n.t('Dashboard: {clusterDisplayName}', { clusterDisplayName: initialData.clusterDisplayName }),
        webviewName: 'clusterDashboard',
        config: initialData,
        context: trpcContext,
        viewColumn: vscode.ViewColumn.One,
    });

    openPanels.set(initialData.clusterId, controller);
    controller.onDisposed(() => {
        if (openPanels.get(initialData.clusterId) === controller) {
            openPanels.delete(initialData.clusterId);

            // The operation history is scoped to one dashboard session ("what has run since I
            // opened this"), but it lives in a host-side store keyed by cluster. Without this,
            // reopening the panel would present the previous session's operations as if they
            // had been observed by the new one, and the entries would be retained for the
            // lifetime of the extension host. Guarded by the identity check above so a panel
            // that has already been superseded cannot clear the live panel's history.
            clearObservedOperations(initialData.clusterId);
        }
    });

    return controller;
}
