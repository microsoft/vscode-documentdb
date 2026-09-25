/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { DISCOVERY_PROVIDER_ID } from '../config';
import { type KubernetesKubeconfigSourceItem } from '../discovery-tree/KubernetesKubeconfigSourceItem';
import { getSource, readInlineYaml } from '../sources/sourceStore';

/**
 * URI scheme backing the read-only view of pasted (inline) kubeconfig sources.
 *
 * Documents opened from a {@link vscode.TextDocumentContentProvider} scheme are
 * read-only by design, so the YAML never has to be written to disk — it is read
 * straight from VS Code Secret Storage on demand. This keeps the credential
 * material out of the file system entirely.
 */
export const KUBECONFIG_VIEW_SCHEME = 'documentdb-kubeconfig';

/**
 * Read-only content provider for inline kubeconfig sources. The source id is
 * carried in the URI query (`?id=<sourceId>`); the path component is purely
 * cosmetic and drives the editor tab title.
 */
class InlineKubeconfigContentProvider implements vscode.TextDocumentContentProvider {
    public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const id = new URLSearchParams(uri.query).get('id');
        if (!id) {
            return `# ${vscode.l10n.t('No kubeconfig source was specified.')}`;
        }

        const record = await getSource(id);
        if (!record) {
            return `# ${vscode.l10n.t('Kubeconfig source not found.')}`;
        }

        const yaml = await readInlineYaml(record);
        if (yaml === undefined) {
            return `# ${vscode.l10n.t('This kubeconfig source has no stored content.')}`;
        }

        return yaml;
    }
}

/**
 * Registers the read-only inline kubeconfig content provider. Call once during
 * extension activation and add the returned disposable to the subscriptions.
 */
export function registerInlineKubeconfigContentProvider(): vscode.Disposable {
    return vscode.workspace.registerTextDocumentContentProvider(
        KUBECONFIG_VIEW_SCHEME,
        new InlineKubeconfigContentProvider(),
    );
}

/**
 * Opens a pasted (inline) kubeconfig source in a read-only editor so the user
 * can inspect the stored YAML. To change it, the user copies the content, edits
 * it elsewhere, and re-adds the source via "Paste kubeconfig YAML from clipboard".
 *
 * File and default sources are backed by real on-disk files and use the
 * editable "Edit Kubeconfig" action instead.
 */
export async function viewKubeconfig(context: IActionContext, node: KubernetesKubeconfigSourceItem): Promise<void> {
    context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
    context.telemetry.properties.kubeconfigSourceAction = 'view';

    if (!node?.source) {
        throw new Error(vscode.l10n.t('No kubeconfig source selected.'));
    }

    if (node.source.kind !== 'inline') {
        context.telemetry.properties.kubeconfigSourceResult = 'notAnInlineSource';
        void vscode.window.showWarningMessage(
            vscode.l10n.t('Only pasted kubeconfig sources can be viewed. Use "Edit Kubeconfig" for file sources.'),
            { modal: true },
        );
        return;
    }

    const uri = vscode.Uri.from({
        scheme: KUBECONFIG_VIEW_SCHEME,
        path: `${node.source.label}.yaml`,
        query: `id=${node.source.id}`,
    });

    try {
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.languages.setTextDocumentLanguage(document, 'yaml');
        await vscode.window.showTextDocument(document, { preview: false });
        context.telemetry.properties.kubeconfigSourceResult = 'viewed';
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ext.outputChannel.error(
            `[KubernetesDiscovery] Failed to view kubeconfig source "${node.source.label}": ${message}`,
        );
        context.telemetry.properties.kubeconfigSourceResult = 'viewFailed';
        void vscode.window.showErrorMessage(vscode.l10n.t('Failed to view kubeconfig: {0}', message), { modal: true });
    }
}
