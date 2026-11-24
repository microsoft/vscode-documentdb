/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { teardownConnection } from '../../documentdb/connectionTeardown';
import { ext } from '../../extensionVariables';
import { ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { type TreeElement } from '../../tree/TreeElement';

export async function disconnect(context: IActionContext, node?: TreeElement): Promise<void> {
    context.telemetry.suppressAll = true; // connection.disconnect owns this operation's telemetry.
    if (!(node instanceof ClusterItemBase)) {
        throw new UserCancelledError();
    }

    const { clusterId } = node.cluster;
    if (!ClustersClient.exists(clusterId) || ClustersClient.getLatchReason(clusterId)) {
        throw new UserCancelledError();
    }

    await teardownConnection(clusterId, 'userDisconnected', () => ext.state.notifyChildrenChanged(node.id));
}

export function connectDisconnected(_context: IActionContext, node?: TreeElement): void {
    if (
        !(node instanceof ClusterItemBase) ||
        ClustersClient.getLatchReason(node.cluster.clusterId) !== 'userDisconnected'
    ) {
        return;
    }

    ClustersClient.unlatch(node.cluster.clusterId);
    ext.state.notifyChildrenChanged(node.id);
}
