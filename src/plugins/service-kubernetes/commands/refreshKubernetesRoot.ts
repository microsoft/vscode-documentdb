/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Views } from '../../../documentdb/Views';
import { ext } from '../../../extensionVariables';
import { DISCOVERY_PROVIDER_ID } from '../config';

/**
 * The Kubernetes root node id, mirroring what `KubernetesRootItem.id`
 * computes (`<discoveryView>/<kubernetes-discovery>`).
 */
export const KUBERNETES_ROOT_NODE_ID = `${Views.DiscoveryView}/${DISCOVERY_PROVIDER_ID}`;

/**
 * Forces the discovery tree to re-fetch the Kubernetes root's children.
 *
 * Mutating commands (add / rename / remove / manage kubeconfig sources) should
 * call this after a successful operation. Without the explicit
 * `resetNodeErrorState`, recovery children cached by
 * `BaseExtendedTreeDataProvider.failedChildrenCache` would be returned again
 * even though the underlying source list has changed.
 */
export function refreshKubernetesRoot(): void {
    ext.discoveryBranchDataProvider.resetNodeErrorState(KUBERNETES_ROOT_NODE_ID);
    ext.discoveryBranchDataProvider.refresh();
}

export async function revealKubernetesSource(sourceId: string): Promise<void> {
    const sourceNodeId = `${KUBERNETES_ROOT_NODE_ID}/${sanitizeKubernetesTreeId(sourceId)}`;
    const rootItems = await ext.discoveryBranchDataProvider.getChildren(undefined as never);
    const kubernetesRoot = rootItems?.find((item) => item.id === KUBERNETES_ROOT_NODE_ID);
    if (!kubernetesRoot) {
        ext.outputChannel.warn(`[KubernetesDiscovery] Could not reveal Kubernetes root.`);
        return;
    }

    const sourceNode = await ext.discoveryBranchDataProvider.findChildById(kubernetesRoot, sourceNodeId);
    if (!sourceNode) {
        ext.outputChannel.warn(`[KubernetesDiscovery] Could not reveal kubeconfig source "${sourceId}".`);
        return;
    }

    await ext.discoveryTreeView.reveal(sourceNode, { select: true, focus: true, expand: true });
}

function sanitizeKubernetesTreeId(value: string): string {
    return value.replace(/[/\\:@]/g, '_');
}
