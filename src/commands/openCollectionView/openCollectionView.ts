/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { ClusterSession } from '../../documentdb/ClusterSession';
import { Views } from '../../documentdb/Views';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { trackJourneyCorrelationId } from '../../utils/commandTelemetry';
import { CollectionViewController } from '../../webviews/documentdb/collectionView/collectionViewController';

export async function openCollectionView(context: IActionContext, node: CollectionItem) {
    // added manually here as this function can by called bypassing our general command registration
    trackJourneyCorrelationId(context, node);

    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    context.telemetry.properties.experience = node?.experience.api;

    // Extract viewId from the cluster model, or infer from treeId prefix
    // The viewId tells us which branch data provider owns this node
    const viewId = node.cluster.viewId ?? inferViewIdFromTreeId(node.cluster.treeId);

    return openCollectionViewInternal(context, {
        clusterId: node.cluster.clusterId,
        viewId: viewId,
        databaseName: node.databaseInfo.name,
        collectionName: node.collectionInfo.name,
    });
}

/**
 * Infers the viewId from the treeId prefix.
 * This is a fallback for cases where viewId is not explicitly set on the cluster model.
 */
function inferViewIdFromTreeId(treeId: string): string {
    if (treeId.startsWith(Views.ConnectionsView)) {
        return Views.ConnectionsView;
    } else if (treeId.startsWith(Views.DiscoveryView)) {
        return Views.DiscoveryView;
    } else if (treeId.startsWith(Views.AzureResourcesView)) {
        return Views.AzureResourcesView;
    } else if (treeId.startsWith(Views.AzureWorkspaceView)) {
        return Views.AzureWorkspaceView;
    }
    // Default fallback - this shouldn't happen in practice
    return Views.ConnectionsView;
}

export async function openCollectionViewInternal(
    _context: IActionContext,
    props: {
        clusterId: string;
        viewId: string;
        databaseName: string;
        collectionName: string;
    },
): Promise<void> {
    /**
     * We're starting a new "session" using the existing connection.
     * A session can cache data, handle paging, and convert data.
     */
    const sessionId = await ClusterSession.initNewSession(props.clusterId);

    // Enable feedback signals only when telemetry level is set to "all"
    // See: https://code.visualstudio.com/docs/setup/enterprise#_configure-telemetry-level
    let feedbackSignalsEnabled = false;
    try {
        const telemetryLevel = vscode.workspace.getConfiguration('telemetry').get<string>('telemetryLevel');
        feedbackSignalsEnabled = telemetryLevel === 'all';
    } catch {
        // If we fail to read telemetry settings, default to false
        feedbackSignalsEnabled = false;
    }

    const view = new CollectionViewController({
        sessionId: sessionId,
        clusterId: props.clusterId,
        viewId: props.viewId,
        databaseName: props.databaseName,
        collectionName: props.collectionName,
        feedbackSignalsEnabled: feedbackSignalsEnabled,
    });

    view.revealToForeground();
}
