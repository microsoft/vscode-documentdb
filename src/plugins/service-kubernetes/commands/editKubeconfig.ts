/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { DISCOVERY_PROVIDER_ID } from '../config';
import { type KubernetesKubeconfigSourceItem } from '../discovery-tree/KubernetesKubeconfigSourceItem';
import { describeDefaultKubeconfigPath, resolveExistingDefaultKubeconfigPath } from '../kubernetesClient';

/**
 * Opens a kubeconfig source in the editor so the user can inspect or edit it
 * (also useful when a source fails to load).
 *
 * Supported for sources backed by a real on-disk file:
 *   - **file** sources open their stored path.
 *   - **default** sources open the resolved kubeconfig (`KUBECONFIG` env var or
 *     `~/.kube/config`) — the same file kubectl edits by default.
 *
 * Pasted (inline) sources have no on-disk file and use the read-only "View
 * Kubeconfig" action instead.
 */
export async function editKubeconfig(context: IActionContext, node: KubernetesKubeconfigSourceItem): Promise<void> {
    context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
    context.telemetry.properties.kubeconfigSourceAction = 'edit';

    if (!node?.source) {
        throw new Error(vscode.l10n.t('No kubeconfig source selected.'));
    }

    context.telemetry.properties.kubeconfigSourceKind = node.source.kind;

    let filePath: string;
    if (node.source.kind === 'file') {
        if (!node.source.path) {
            context.telemetry.properties.kubeconfigSourceResult = 'notAFileSource';
            void vscode.window.showWarningMessage(
                vscode.l10n.t('Only file-based kubeconfig sources can be opened in the editor.'),
            );
            return;
        }
        filePath = node.source.path;
    } else if (node.source.kind === 'default') {
        // The default source maps to a real file on disk; resolve the first
        // existing path and bail out with a clear modal when there is nothing
        // to open (e.g. the user has never created a kubeconfig).
        const resolved = resolveExistingDefaultKubeconfigPath();
        if (!resolved) {
            context.telemetry.properties.kubeconfigSourceResult = 'defaultPathMissing';
            void vscode.window.showErrorMessage(
                vscode.l10n.t(
                    'No kubeconfig file was found at the default location: {0}',
                    describeDefaultKubeconfigPath(),
                ),
                {
                    modal: true,
                    detail: vscode.l10n.t(
                        'Set the KUBECONFIG environment variable or create a kubeconfig at the default path, then try again.',
                    ),
                },
            );
            return;
        }
        filePath = resolved;
    } else {
        context.telemetry.properties.kubeconfigSourceResult = 'notAFileSource';
        void vscode.window.showWarningMessage(
            vscode.l10n.t('Only file-based kubeconfig sources can be opened in the editor.'),
        );
        return;
    }

    if (!fs.existsSync(filePath)) {
        context.telemetry.properties.kubeconfigSourceResult = 'fileMissing';
        void vscode.window.showErrorMessage(vscode.l10n.t('The kubeconfig file no longer exists: {0}', filePath), {
            modal: true,
        });
        return;
    }

    try {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        await vscode.window.showTextDocument(document, { preview: false });
        context.telemetry.properties.kubeconfigSourceResult = 'opened';
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ext.outputChannel.error(`[KubernetesDiscovery] Failed to open kubeconfig "${filePath}" in editor: ${message}`);
        context.telemetry.properties.kubeconfigSourceResult = 'openFailed';
        void vscode.window.showErrorMessage(vscode.l10n.t('Failed to open kubeconfig in editor: {0}', message));
    }
}
