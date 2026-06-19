/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';

import { inferViewIdFromTreeId } from '../../documentdb/Views';
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { trackJourneyCorrelationId } from '../../utils/commandTelemetry';
import { ClusterViewController } from '../../webviews/documentdb/clusterView/clusterViewController';

/**
 * Opens the cluster dashboard / home page from a cluster tree node (context
 * menu or inline action). Resolves the coordinates the webview needs and
 * delegates to {@link openClusterViewInternal}.
 */
export async function openClusterView(context: IActionContext, node: ClusterItemBase): Promise<void> {
    // Added manually here as this function can be called bypassing our general command registration.
    trackJourneyCorrelationId(context, node);

    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    context.telemetry.properties.experience = node.experience?.api;

    // Extract viewId from the cluster model, or infer it from the treeId prefix.
    const viewId = node.cluster.viewId ?? inferViewIdFromTreeId(node.cluster.treeId);

    return openClusterViewInternal(context, {
        clusterId: node.cluster.clusterId,
        clusterDisplayName: node.cluster.name,
        viewId: viewId,
        clusterTreeId: node.cluster.treeId,
    });
}

/**
 * Opens the cluster dashboard from explicit coordinates. Used both by the
 * tree-node command above and by the double-click handler (which passes the
 * props object directly).
 */
export async function openClusterViewInternal(
    _context: IActionContext,
    props: {
        clusterId: string;
        clusterDisplayName: string;
        viewId: string;
        clusterTreeId: string;
    },
): Promise<void> {
    const view = new ClusterViewController({
        clusterId: props.clusterId,
        clusterDisplayName: props.clusterDisplayName,
        viewId: props.viewId,
        clusterTreeId: props.clusterTreeId,
    });

    view.revealToForeground();
}
