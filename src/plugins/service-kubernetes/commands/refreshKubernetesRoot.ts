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
