/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { DISCOVERY_PROVIDER_ID } from '../config';
import { type KubernetesContextItem } from '../discovery-tree/KubernetesContextItem';
import { aliasFor, setAlias } from '../sources/aliasStore';

/**
 * Sets or clears the display alias for a Kubernetes context.
 *
 * The kubeconfig YAML is never modified; the alias is stored alongside the
 * source list and only affects the discovery tree label and the new-connection
 * wizard quick pick. The real context name continues to back saved
 * connections, port-forward metadata, telemetry, and output-channel logs.
 */
export async function renameKubernetesContext(context: IActionContext, node: KubernetesContextItem): Promise<void> {
    context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
    context.telemetry.properties.kubernetesContextAction = 'rename';

    if (!node?.contextInfo?.name || !node.sourceId) {
        throw new Error(vscode.l10n.t('No Kubernetes context selected.'));
    }

    const currentAlias = await aliasFor(node.sourceId, node.contextInfo.name);

    const input = await vscode.window.showInputBox({
        title: vscode.l10n.t('Rename Kubernetes context'),
        prompt: vscode.l10n.t(
            'Set a display name for "{0}". The kubeconfig file is not modified. Leave empty to clear the alias.',
            node.contextInfo.name,
        ),
        value: currentAlias ?? '',
        placeHolder: node.contextInfo.name,
    });

    if (input === undefined) {
        throw new UserCancelledError();
    }

    const trimmed = input.trim();
    await setAlias(node.sourceId, node.contextInfo.name, trimmed.length === 0 ? undefined : trimmed);
    context.telemetry.properties.kubernetesContextResult = trimmed.length === 0 ? 'cleared' : 'renamed';

    const { refreshKubernetesRoot } = await import('./refreshKubernetesRoot');
    refreshKubernetesRoot();
}
