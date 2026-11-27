/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { l10n, window } from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { teardownConnection } from '../../documentdb/connectionTeardown';
import { Views } from '../../documentdb/Views';
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
    const reason = ClustersClient.getLatchReason(clusterId);
    if (!ClustersClient.exists(clusterId) || reason) {
        if (
            node.cluster.viewId !== Views.ConnectionsView &&
            node.cluster.viewId !== Views.DiscoveryView &&
            !(
                node.cluster.viewId === Views.AzureResourcesView &&
                /\bruBranch\b|\bdocumentDbBranch\b/i.test(node.contextValue)
            )
        ) {
            throw new UserCancelledError();
        }
        refreshAuthenticationNode(node);
        if (reason === 'connectionRemoved' || reason === 'credentialsChanged' || reason === 'identityChanged') {
            context.errorHandling.suppressDisplay = true;
            void window.showErrorMessage(
                reason === 'connectionRemoved'
                    ? l10n.t('This connection was removed. Choose another connection.')
                    : l10n.t('This connection changed. Refresh the tree and try again.'),
                { modal: true },
            );
        }
        return;
    }

    await teardownConnection(clusterId, 'userDisconnected', () => refreshAuthenticationNode(node));
}

export function connectDisconnected(context: IActionContext, node?: TreeElement): void {
    if (!isClusterNode(node)) {
        return;
    }
    const reason = ClustersClient.getLatchReason(node.cluster.clusterId);
    if (reason !== 'userDisconnected') {
        if (
            node.cluster.viewId !== Views.ConnectionsView &&
            node.cluster.viewId !== Views.DiscoveryView &&
            !(
                node.cluster.viewId === Views.AzureResourcesView &&
                /\bruBranch\b|\bdocumentDbBranch\b/i.test(node.contextValue)
            )
        ) {
            return;
        }
        refreshAuthenticationNode(node);
        if (reason === 'connectionRemoved' || reason === 'credentialsChanged' || reason === 'identityChanged') {
            context.errorHandling.suppressDisplay = true;
            void window.showErrorMessage(
                reason === 'connectionRemoved'
                    ? l10n.t('This connection was removed. Choose another connection.')
                    : l10n.t('This connection changed. Refresh the tree and try again.'),
                { modal: true },
            );
        }
        return;
    }

    ClustersClient.unlatch(node.cluster.clusterId);
    ext.state.notifyChildrenChanged(node.id);
}
