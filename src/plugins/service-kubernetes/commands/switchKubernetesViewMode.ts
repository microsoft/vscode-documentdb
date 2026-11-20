/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { LiveConfigService } from '../../../services/LiveConfigService';
import { DISCOVERY_PROVIDER_ID, type KubernetesViewMode } from '../config';

/**
 * Persists the global Kubernetes discovery {@link KubernetesViewMode} and refreshes the tree.
 */
async function setKubernetesViewMode(context: IActionContext, mode: KubernetesViewMode): Promise<void> {
    context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
    context.telemetry.properties.kubernetesViewMode = mode;

    await LiveConfigService.setKubernetesViewMode(mode);

    const { refreshKubernetesRoot } = await import('./refreshKubernetesRoot');
    refreshKubernetesRoot();
}

/**
 * Switches the Kubernetes discovery tree to the hierarchical "tree" view
 * (context → namespaces → DocumentDB clusters).
 */
export async function switchToKubernetesTreeView(context: IActionContext): Promise<void> {
    await setKubernetesViewMode(context, 'tree');
}

/**
 * Switches the Kubernetes discovery tree to the flat "list" view
 * (context → DocumentDB clusters, with the namespace shown in the description).
 */
export async function switchToKubernetesFlatListView(context: IActionContext): Promise<void> {
    await setKubernetesViewMode(context, 'list');
}
