/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { DISCOVERY_PROVIDER_ID } from '../config';
import { type KubernetesKubeconfigSourceItem } from '../discovery-tree/KubernetesKubeconfigSourceItem';
import { renameSource } from '../sources/sourceStore';

/**
 * Renames a kubeconfig source. The default source is renameable just like
 * any other entry; the underlying record id stays unchanged so saved
 * connections that reference it via `sourceId` keep working.
 */
export async function renameKubeconfigSource(
    context: IActionContext,
    node: KubernetesKubeconfigSourceItem,
): Promise<void> {
    context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
    context.telemetry.properties.kubeconfigSourceAction = 'rename';

    if (!node?.source) {
        throw new Error(vscode.l10n.t('No kubeconfig source selected.'));
    }

    const newLabel = await vscode.window.showInputBox({
        title: vscode.l10n.t('Rename kubeconfig source'),
        prompt: vscode.l10n.t('Enter a new label for this kubeconfig source.'),
        value: node.source.label,
        validateInput: (value: string) => {
            if (value.trim().length === 0) {
                return vscode.l10n.t('Label cannot be empty.');
            }
            return undefined;
        },
    });

    if (newLabel === undefined) {
        throw new UserCancelledError();
    }

    await renameSource(node.source.id, newLabel);
    context.telemetry.properties.kubeconfigSourceResult = 'renamed';
    const { refreshKubernetesRoot } = await import('./refreshKubernetesRoot');
    refreshKubernetesRoot();
}
