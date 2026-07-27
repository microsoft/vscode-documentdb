/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';

import { inferViewIdFromTreeId } from '../../documentdb/Views';
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { trackJourneyCorrelationId } from '../../utils/commandTelemetry';
import { openClusterDashboardWebview } from '../../webviews/documentdb/clusterDashboard/clusterDashboardController';

/** Refresh cadence of the dashboard's live tiles. Not user-configurable yet (preview). */
const DASHBOARD_REFRESH_INTERVAL_MS = 5000;

export function openClusterDashboard(context: IActionContext, node: ClusterItemBase): void {
    // added manually here as this function can be called bypassing our general command registration
    trackJourneyCorrelationId(context, node);

    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    context.telemetry.properties.experience = node?.experience.api;

    // Extract viewId from the cluster model, or infer from treeId prefix
    // The viewId tells us which branch data provider owns this node
    const viewId = node.cluster.viewId ?? inferViewIdFromTreeId(node.cluster.treeId);

    const view = openClusterDashboardWebview({
        clusterId: node.cluster.clusterId,
        clusterDisplayName: node.cluster.name,
        viewId: viewId,
        refreshIntervalMs: DASHBOARD_REFRESH_INTERVAL_MS,
    });

    view.revealToForeground();
}
