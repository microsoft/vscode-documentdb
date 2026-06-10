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

/**
 * Opens a file-based kubeconfig source in the editor so the user can inspect or
 * fix it (useful when a source fails to load). Only file sources have an
 * on-disk path; pasted (inline) and default sources are not supported here.
 */
export async function openKubeconfigInEditor(
    context: IActionContext,
    node: KubernetesKubeconfigSourceItem,
): Promise<void> {
    context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
    context.telemetry.properties.kubeconfigSourceAction = 'openInEditor';

    if (!node?.source) {
        throw new Error(vscode.l10n.t('No kubeconfig source selected.'));
    }

    if (node.source.kind !== 'file' || !node.source.path) {
        context.telemetry.properties.kubeconfigSourceResult = 'notAFileSource';
        void vscode.window.showWarningMessage(
            vscode.l10n.t('Only file-based kubeconfig sources can be opened in the editor.'),
        );
        return;
    }

    const filePath = node.source.path;
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
