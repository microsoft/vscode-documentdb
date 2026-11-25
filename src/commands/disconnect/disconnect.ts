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
import { refreshAuthenticationNode } from '../retryAuthentication/retryAuthentication';

function isClusterNode(node: TreeElement | undefined): node is ClusterItemBase {
    return node instanceof ClusterItemBase;
}

export async function disconnect(context: IActionContext, node?: TreeElement): Promise<void> {
    context.telemetry.suppressAll = true; // connection.disconnect owns this operation's telemetry.
    if (!isClusterNode(node)) {
        throw new UserCancelledError();
    }

    const { clusterId } = node.cluster;
    if (!ClustersClient.exists(clusterId) || ClustersClient.getLatchReason(clusterId)) {
        throw new UserCancelledError();
    }

    await teardownConnection(clusterId, 'userDisconnected', () => refreshAuthenticationNode(node));
}

export function connectDisconnected(_context: IActionContext, node?: TreeElement): void {
    if (!isClusterNode(node) || ClustersClient.getLatchReason(node.cluster.clusterId) !== 'userDisconnected') {
        return;
    }

    ClustersClient.unlatch(node.cluster.clusterId);
    ext.state.notifyChildrenChanged(node.id);
}
