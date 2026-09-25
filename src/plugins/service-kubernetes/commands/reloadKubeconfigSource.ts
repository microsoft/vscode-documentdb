/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { DISCOVERY_PROVIDER_ID } from '../config';
import { type KubernetesKubeconfigSourceItem } from '../discovery-tree/KubernetesKubeconfigSourceItem';
import { getContexts, loadConfiguredKubeConfig } from '../kubernetesClient';

/**
 * Reloads a single kubeconfig source from its underlying storage.
 *
 * Wired to the "Reload" action that replaces the previous generic "Retry"
 * recovery child on {@link KubernetesKubeconfigSourceItem}. Compared with the
 * generic {@link import('../../../commands/retryAuthentication/retryAuthentication').retryAuthentication}
 * helper, this command:
 *
 *   - Clears the cached failed children for the source so the next fetch is fresh.
 *   - Runs a probe load under a status-bar progress indicator so the user
 *     sees that their action actually did something (the primary complaint
 *     against the old "Retry" label was that it appeared to be a no-op).
 *   - Stays silent on the happy path — the refreshed tree node is the
 *     confirmation. On failure / zero-contexts we defer to the modal that
 *     {@link KubernetesKubeconfigSourceItem.createKubeconfigRecoveryChildren}
 *     raises during the tree refresh, so the user does not see two redundant
 *     messages.
 *   - Refreshes the discovery tree node so the visible children reflect the
 *     latest load result.
 */
export async function reloadKubeconfigSource(
    context: IActionContext,
    node: KubernetesKubeconfigSourceItem,
): Promise<void> {
    context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
    context.telemetry.properties.kubeconfigSourceAction = 'reload';

    if (!node?.source) {
        throw new Error(vscode.l10n.t('No kubeconfig source selected.'));
    }

    const sourceLabel = node.source.label;
    const sourceId = node.source.id;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Window,
            title: vscode.l10n.t('Reloading kubeconfig source "{0}"…', sourceLabel),
        },
        async () => {
            try {
                const kubeConfig = await loadConfiguredKubeConfig(sourceId);
                const contexts = getContexts(kubeConfig);
                context.telemetry.properties.kubeconfigSourceResult =
                    contexts.length === 0 ? 'reloadedEmpty' : 'reloaded';
                context.telemetry.measurements.contextCount = contexts.length;

                // Success is silent on purpose: the refreshed tree node (with its
                // up-to-date children) is the confirmation. For zero-context or
                // load-failure cases we also stay quiet here; the tree refresh below
                // re-runs getChildren() and KubernetesKubeconfigSourceItem
                // .createKubeconfigRecoveryChildren raises a single modal describing
                // exactly what is wrong.
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                context.telemetry.properties.kubeconfigSourceResult = 'failed';
                context.telemetry.measurements.contextCount = 0;
                ext.outputChannel.error(
                    `[KubernetesDiscovery] Reload failed for kubeconfig source "${sourceLabel}": ${errorMessage}`,
                );
                // Swallow: the tree refresh below surfaces the user-visible warning.
            }
        },
    );

    ext.discoveryBranchDataProvider.resetNodeErrorState(node.id);
    ext.discoveryBranchDataProvider.refresh(node);
}
