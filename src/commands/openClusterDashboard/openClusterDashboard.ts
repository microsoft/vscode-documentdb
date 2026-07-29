/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { CredentialCache } from '../../documentdb/CredentialCache';
import { inferViewIdFromTreeId } from '../../documentdb/Views';
import { type AzureClusterModel } from '../../tree/azure-views/models/AzureClusterModel';
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { trackJourneyCorrelationId } from '../../utils/commandTelemetry';
import {
    openClusterDashboardWebview,
    type ClusterDashboardAzureInfo,
} from '../../webviews/documentdb/clusterDashboard/clusterDashboardController';

/** Refresh cadence of the dashboard's live tiles. Not user-configurable yet (preview). */
const DASHBOARD_REFRESH_INTERVAL_MS = 5000;

/**
 * Reads the Azure resource facts off a cluster node, when it has any.
 *
 * The properties live on `AzureClusterModel` subtypes and are already populated by the
 * discovery views from ARM, so this is a read rather than a fetch. The cast mirrors
 * `ClusterItemBase.getTreeItem`, which surfaces the same facts in the node tooltip.
 * Returns `undefined` for a non-Azure cluster so the header omits the rows entirely
 * rather than rendering a row of dashes.
 */
function extractAzureInfo(node: ClusterItemBase): ClusterDashboardAzureInfo | undefined {
    const azureProps = node.cluster as unknown as Partial<AzureClusterModel>;

    const info: ClusterDashboardAzureInfo = {
        location: azureProps.location,
        sku: azureProps.sku,
        nodeCount: azureProps.nodeCount,
        diskSize: azureProps.diskSize,
        enableHa: azureProps.enableHa,
        replicaRole: azureProps.replicaRole,
    };

    return Object.values(info).some((value) => value !== undefined) ? info : undefined;
}

export function openClusterDashboard(context: IActionContext, node: ClusterItemBase): void {
    // added manually here as this function can be called bypassing our general command registration
    trackJourneyCorrelationId(context, node);

    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    context.telemetry.properties.experience = node?.experience.api;

    // Verify credentials are available before opening the panel. Without this, a
    // never-expanded connection opens a dashboard that cannot connect and then re-fails
    // its poll every few seconds with no sign-in affordance. Matches openInteractiveShell.
    if (!CredentialCache.hasCredentials(node.cluster.clusterId)) {
        void vscode.window.showErrorMessage(
            l10n.t('Not signed in to {0}. Please authenticate first.', node.cluster.name),
        );
        return;
    }

    // Extract viewId from the cluster model, or infer from treeId prefix
    // The viewId tells us which branch data provider owns this node
    const viewId = node.cluster.viewId ?? inferViewIdFromTreeId(node.cluster.treeId);

    const view = openClusterDashboardWebview({
        clusterId: node.cluster.clusterId,
        clusterDisplayName: node.cluster.name,
        viewId: viewId,
        refreshIntervalMs: DASHBOARD_REFRESH_INTERVAL_MS,
        azure: extractAzureInfo(node),
    });

    view.revealToForeground();
}
