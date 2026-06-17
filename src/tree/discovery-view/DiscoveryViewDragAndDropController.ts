/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { shortenPathMiddle } from '../../utils/shortenPathMiddle';
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
            ext.outputChannel.warn(
                `[DiscoveryDrop] No URI list found in drop data (expected 'text/uri-list' or 'application/vnd.code.uri-list'). Drop ignored.`,
            );
            return;
        }

        const uriListText = await uriListItem.asString();

        if (token.isCancellationRequested) {
            return;
        }

        // Categorize the dropped URIs so we can give a tailored explanation for
        // anything we can't reach (Windows-host files under WSL, remote files,
        // web URLs, UNC/network shares, unsaved editors, …) instead of failing
        // silently.
        const { usable, rejected } = categorizeDroppedUris(uriListText);

        for (const { uri, reason } of rejected) {
            ext.outputChannel.warn(`[DiscoveryDrop] Ignoring dropped URI "${uri.toString()}": ${reason}`);
        }

        if (usable.length === 0) {
            if (rejected.length === 0) {
                ext.outputChannel.warn(`[DiscoveryDrop] No URIs found in drop data. Raw list: ${uriListText.trim()}`);
                return;
            }

            // A single rejected item reads better without a bullet; only use
            // bullets when there are several reasons to list.
            const details =
                rejected.length === 1 ? rejected[0].reason : rejected.map(({ reason }) => `• ${reason}`).join('\n');
            void vscode.window.showErrorMessage(
                vscode.l10n.t('The dropped item could not be added as a kubeconfig source'),
                {
                    modal: true,
                    detail: vscode.l10n.t(
                        '{0}\n\nTip: copy the file into the same filesystem as the editor (for example your WSL or remote home directory), then drop it again, or use the "Add Kubeconfig Source" command to browse for it.',
                        details,
                    ),
                },
            );
            return;
        }

        const uris = usable;

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
 * A dropped URI that we cannot register as a kubeconfig source, paired with a
 * human-readable explanation of why.
 */
export interface RejectedDropUri {
    readonly uri: vscode.Uri;
    readonly reason: string;
}

/**
 * Result of inspecting a `text/uri-list` payload: the file URIs we can actually
 * read (`usable`) and the ones we cannot, each with a reason (`rejected`).
 */
export interface CategorizedDropUris {
    readonly usable: vscode.Uri[];
    readonly rejected: RejectedDropUri[];
}

/**
 * Authorities that still resolve to the local machine for a `file:` URI.
 */
function isLocalFileAuthority(authority: string): boolean {
    const normalized = authority.toLowerCase();
    return normalized === '' || normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

/**
 * Returns a human-readable explanation when a dropped URI cannot be used as a
 * kubeconfig source, or `undefined` when the URI is a readable local file.
 *
 * The extension host can only read files on its own filesystem. Several drop
 * sources produce URIs that point elsewhere:
 *
 * - `vscode-local` — a file on the Windows host while the editor runs in WSL.
 * - `vscode-remote` — a file on a different remote (SSH / container) host.
 * - `http(s)` — a link dragged from a browser.
 * - `ftp` / `sftp` / `smb` — a network location.
 * - `untitled` — an unsaved editor tab with no file on disk yet.
 * - `file` with a non-local authority — a UNC / network share (`\\server\share`).
 */
function explainUnsupportedUri(uri: vscode.Uri): string | undefined {
    const label = shortenPathMiddle(uri.fsPath || uri.toString());

    switch (uri.scheme.toLowerCase()) {
        case 'file':
            if (!isLocalFileAuthority(uri.authority)) {
                return vscode.l10n.t(
                    '"{0}" is on the network share "\\\\{1}", which the editor cannot read directly.',
                    label,
                    uri.authority,
                );
            }
            return undefined;
        case 'vscode-local':
            return vscode.l10n.t(
                '"{0}" is a file on your local (Windows) machine, which the editor running in WSL or a remote/container host cannot read directly.',
                label,
            );
        case 'vscode-remote':
            return vscode.l10n.t(
                '"{0}" is a file on a different remote host than the one the editor is connected to.',
                label,
            );
        case 'http':
        case 'https':
            return vscode.l10n.t('"{0}" is a web link, not a local file.', shortenPathMiddle(uri.toString()));
        case 'ftp':
        case 'ftps':
        case 'sftp':
        case 'smb':
            return vscode.l10n.t(
                '"{0}" is a network location, which the editor cannot read directly.',
                shortenPathMiddle(uri.toString()),
            );
        case 'untitled':
            return vscode.l10n.t('"{0}" is an unsaved editor. Save it to disk first, then drop the saved file.', label);
        default:
            return vscode.l10n.t('"{0}" uses the unsupported URI scheme "{1}".', label, uri.scheme);
    }
}

/**
 * Parses a `text/uri-list` payload (RFC 2483) and splits the entries into the
 * file URIs we can read (`usable`) and the ones we cannot, each annotated with a
 * reason (`rejected`).
 *
 * - Blank lines and `#`-prefixed comment lines are stripped per the RFC.
 * - Malformed lines are skipped silently rather than failing the whole drop.
 *
 * Exported for unit-testing only.
 */
export function categorizeDroppedUris(text: string): CategorizedDropUris {
    const usable: vscode.Uri[] = [];
    const rejected: RejectedDropUri[] = [];

    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));

    for (const line of lines) {
        let uri: vscode.Uri;
        try {
            uri = vscode.Uri.parse(line, true);
        } catch {
            // Malformed entry: skip silently to stay tolerant of odd drag sources.
            continue;
        }

        const reason = explainUnsupportedUri(uri);
        if (reason === undefined) {
            usable.push(uri);
        } else {
            rejected.push({ uri, reason });
        }
    }

    return { usable, rejected };
}

/**
 * Parses a `text/uri-list` payload into the readable local `file:` URIs only.
 *
 * Thin wrapper over {@link categorizeDroppedUris} kept for backward
 * compatibility. Exported for unit-testing only.
 */
export function parseUriList(text: string): vscode.Uri[] {
    return categorizeDroppedUris(text).usable;
}
