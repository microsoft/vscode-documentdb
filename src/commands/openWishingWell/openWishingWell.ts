/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { inferViewIdFromTreeId } from '../../documentdb/Views';
import { ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { CollectionItem } from '../../tree/documentdb/CollectionItem';
import { DatabaseItem } from '../../tree/documentdb/DatabaseItem';
import { type TreeCluster } from '../../tree/models/BaseClusterModel';
import { openWishingWellWebview } from '../../webviews/documentdb/wishingWell/wishingWellController';

/**
 * Opens the Wishing Well. From the Command Palette it is not tied to a connection; from a cluster,
 * database or collection it wishes on that, so queries and tools land in the right place.
 */
export async function openWishingWell(context: IActionContext, node?: unknown): Promise<void> {
    if (!(node instanceof ClusterItemBase) && !(node instanceof DatabaseItem) && !(node instanceof CollectionItem)) {
        context.telemetry.properties.activationSource = 'commandPalette';
        openWishingWellWebview();
        return;
    }

    context.telemetry.properties.activationSource = 'treeContextMenu';
    context.telemetry.properties.nodeType =
        node instanceof CollectionItem ? 'collection' : node instanceof DatabaseItem ? 'database' : 'cluster';

    const cluster: TreeCluster = node.cluster as TreeCluster;
    if (node instanceof ClusterItemBase) {
        if (!(await node.connect())) {
            // `connect()` already explained why, or the user cancelled.
            context.telemetry.properties.result = node.lastConnectionOutcome === 'canceled' ? 'Canceled' : 'Failed';
            return;
        }
    } else {
        // Database and collection nodes only render after their cluster connected.
        await ClustersClient.getClient(cluster.clusterId);
    }

    openWishingWellWebview({
        clusterId: cluster.clusterId,
        clusterDisplayName: cluster.name,
        viewId: cluster.viewId ?? inferViewIdFromTreeId(cluster.treeId),
        databaseName: node instanceof ClusterItemBase ? undefined : node.databaseInfo.name,
        collectionName: node instanceof CollectionItem ? node.collectionInfo.name : undefined,
    });
}
