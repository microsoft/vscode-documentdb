/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { getConfirmationAsInSettings } from '../../../utils/dialogs/getConfirmation';
import { DISCOVERY_PROVIDER_ID } from '../config';
import { type KubernetesKubeconfigSourceItem } from '../discovery-tree/KubernetesKubeconfigSourceItem';
import { PortForwardTunnelManager } from '../portForwardTunnel';
import { clearAliasesForSource } from '../sources/aliasStore';
import { removeSource } from '../sources/sourceStore';

/**
 * Removes a kubeconfig source after user confirmation.
 *
 * The default source is removable like any other; users can re-add it later
 * via the "+" inline icon. Active port-forward tunnels are stopped so the
 * next reconnect goes through a clean re-establishment.
 */
export async function removeKubeconfigSource(
    context: IActionContext,
    node: KubernetesKubeconfigSourceItem,
): Promise<void> {
    context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
    context.telemetry.properties.kubeconfigSourceAction = 'remove';

    if (!node?.source) {
        throw new Error(vscode.l10n.t('No kubeconfig source selected.'));
    }

    const confirmed = await getConfirmationAsInSettings(
        vscode.l10n.t('Remove kubeconfig source "{0}"?', node.source.label),
        vscode.l10n.t(
            'Saved connections that depend on this source will need to be reconfigured. Active port-forward tunnels for this source will be stopped.',
        ),
        node.source.label,
        { fallbackWord: 'remove' },
    );

    if (!confirmed) {
        throw new UserCancelledError();
    }

    // Stop only this source's tunnels so unrelated K8s connections in other sources keep working.
    try {
        PortForwardTunnelManager.getInstance().stopTunnelsForSource(node.source.id);
    } catch {
        // Tunnel manager may not be loaded; continue.
    }

    await removeSource(node.source.id);
    try {
        await clearAliasesForSource(node.source.id);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ext.outputChannel.warn(
            `[KubernetesDiscovery] Failed to clear aliases for removed source "${node.source.label}": ${message}`,
        );
    }
    context.telemetry.properties.kubeconfigSourceResult = 'removed';

    // Clear any cached error/recovery children for the removed source node.
    // The Default source uses a stable reserved id, so a remove + re-add round
    // trip would otherwise re-serve the previous failure cache for that node.
    // File / inline sources get fresh UUIDs on re-add, so their entries are
    // just orphaned map noise rather than a behavior bug, but clearing them
    // here keeps the cache bounded.
    try {
        ext.discoveryBranchDataProvider.resetNodeErrorState(node.id);
    } catch {
        // Discovery provider may not yet be wired during early activation.
    }

    const { refreshKubernetesRoot } = await import('./refreshKubernetesRoot');
    refreshKubernetesRoot();
    ext.outputChannel.appendLine(vscode.l10n.t('Removed kubeconfig source "{0}".', node.source.label));
}
