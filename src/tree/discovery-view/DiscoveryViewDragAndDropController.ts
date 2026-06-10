/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type TreeElement } from '../TreeElement';

/**
 * Drag-and-drop controller for the Discovery tree view.
 *
 * Today we only support DROP (not drag): users can drop kubeconfig files from
 * the OS file manager or from VS Code's Explorer view onto any node of the
 * discovery tree to register them as new Kubernetes kubeconfig sources. This
 * mirrors the UX users expect from other VS Code views (e.g., dropping a
 * `.vsix` onto the Extensions view).
 *
 * The controller is intentionally plugin-agnostic: it parses the URI list and
 * delegates to the Kubernetes plugin via dynamic import so the discovery view
 * has no compile-time dependency on a single discovery provider. Adding drop
 * support for additional providers later only requires extending the delegation
 * below — no change to the controller's MIME-type contract.
 */
export class DiscoveryViewDragAndDropController implements vscode.TreeDragAndDropController<TreeElement> {
    public readonly dropMimeTypes: readonly string[] = ['text/uri-list', 'application/vnd.code.uri-list'];

    // Discovery tree items are not currently draggable elsewhere; required by the
    // interface so we declare an empty list.
    public readonly dragMimeTypes: readonly string[] = [];

    public async handleDrop(
        _target: TreeElement | undefined,
        dataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken,
    ): Promise<void> {
        const uriListItem = dataTransfer.get('text/uri-list') ?? dataTransfer.get('application/vnd.code.uri-list');
        if (!uriListItem) {
            return;
        }

        const uriListText = await uriListItem.asString();
        if (token.isCancellationRequested) {
            return;
        }

        const uris = parseUriList(uriListText);
        if (uris.length === 0) {
            return;
        }

        // Dynamic import so the discovery view stays decoupled from any specific
        // discovery plugin. Future providers can chain additional handlers here.
        const { handleKubeconfigFileDrop } =
            await import('../../plugins/service-kubernetes/commands/handleKubeconfigFileDrop');
        if (token.isCancellationRequested) {
            return;
        }
        await handleKubeconfigFileDrop(uris);
    }
}

/**
 * Parses a `text/uri-list` payload (RFC 2483) into `vscode.Uri` values.
 *
 * - Blank lines and `#`-prefixed comment lines are stripped per the RFC.
 * - Only `file://` URIs are kept; other schemes (e.g., `http`, `untitled`) are
 *   dropped here so the delegate doesn't have to filter again.
 * - Malformed lines are skipped silently rather than failing the whole drop.
 *
 * Exported for unit-testing only.
 */
export function parseUriList(text: string): vscode.Uri[] {
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
        .map((line) => {
            try {
                return vscode.Uri.parse(line, true);
            } catch {
                return undefined;
            }
        })
        .filter((uri): uri is vscode.Uri => uri !== undefined && uri.scheme === 'file');
}
