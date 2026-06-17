/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { shortenPathMiddle } from '../../../utils/shortenPathMiddle';
import { DISCOVERY_PROVIDER_ID } from '../config';
import { getContexts, loadKubeConfig } from '../kubernetesClient';
import { tryAddFileSource } from '../sources/sourceStore';
import { refreshKubernetesRoot, revealKubernetesSource } from './refreshKubernetesRoot';

// Re-exported for unit tests that exercise the display-path shortening behavior.
export { shortenPathMiddle };

/**
 * Handles a batch of file URIs dropped onto the discovery tree by trying to
 * register each as a kubeconfig source.
 *
 * Nothing is imported automatically: the user is first shown a modal listing the
 * dropped file(s), with the option to preview them, and may cancel. Only after
 * an explicit confirmation do we proceed. For each confirmed URI we:
 *   1. Skip non-file schemes with an output-channel note (e.g., `untitled:` from
 *      a drag from an unsaved editor tab — there's nothing meaningful we can do).
 *   2. Skip directories with a per-file warning toast.
 *   3. Parse + validate the file as a kubeconfig via {@link loadKubeConfig}.
 *      Files that fail to parse, or that have zero contexts, are skipped with
 *      a per-file warning toast so the user knows which file was rejected.
 *   4. Call {@link tryAddFileSource}, which is the atomic source of truth: it
 *      returns `{ record, created }`. We trust `created` rather than racing a
 *      separate snapshot of the cache (which a concurrent drop or a concurrent
 *      wizard add could invalidate between snapshot and write).
 *   5. If `created` is `false` we log a single audit-trail line to the output
 *      channel and continue without an aggregate toast or a refresh.
 *
 * On success we refresh the Kubernetes root and reveal the first added source
 * so the user immediately sees the result of their drop. If every dropped file
 * was either invalid or a duplicate, no aggregate toast fires (matching the
 * existing per-file-only feedback pattern for the all-invalid case).
 */
export async function handleKubeconfigFileDrop(uris: readonly vscode.Uri[]): Promise<void> {
    await callWithTelemetryAndErrorHandling('kubernetes.dropKubeconfigFile', async (context: IActionContext) => {
        context.telemetry.properties.discoveryProviderId = DISCOVERY_PROVIDER_ID;
        context.telemetry.measurements.fileCount = uris.length;

        // The controller already filters to readable local files, but keep a
        // defensive scheme check for any direct callers.
        const fileUris = uris.filter((uri) => {
            if (uri.scheme !== 'file') {
                ext.outputChannel.warn(
                    `[KubernetesDiscovery] Dropped URI "${uri.toString()}" has scheme "${uri.scheme}", not "file" — skipped.`,
                );
                return false;
            }
            return true;
        });

        if (fileUris.length === 0) {
            return;
        }

        // Nothing is imported automatically: confirm the dropped file(s) with the
        // user first (with an option to preview them) so the drop is an explicit,
        // reviewable action rather than a silent side effect.
        const confirmation = await confirmKubeconfigDrop(fileUris);
        context.telemetry.properties.dropConfirmation = confirmation;
        if (confirmation !== 'import') {
            // Preview opens the file(s) and then deliberately exits — the user can
            // drop them again to import. Cancel does nothing. Either way we stop
            // here without importing.
            ext.outputChannel.appendLine(
                confirmation === 'preview'
                    ? '[KubernetesDiscovery] Previewed dropped kubeconfig file(s); not importing. Drop again to import.'
                    : '[KubernetesDiscovery] Kubeconfig drop cancelled by the user.',
            );
            return;
        }

        let added = 0;
        let alreadyRegistered = 0;
        let invalid = 0;
        let firstAddedSourceId: string | undefined;
        let firstAddedLabel: string | undefined;

        for (const uri of fileUris) {
            const absPath = uri.fsPath;
            const baseName = path.basename(absPath) || absPath;

            // Skip non-files (directories, missing).
            try {
                const stat = await fs.promises.stat(absPath);
                if (!stat.isFile()) {
                    invalid++;
                    void vscode.window.showWarningMessage(
                        vscode.l10n.t('Cannot add "{0}" as a kubeconfig source: not a regular file.', baseName),
                    );
                    continue;
                }
            } catch (error) {
                invalid++;
                const message = error instanceof Error ? error.message : String(error);
                ext.outputChannel.warn(`[KubernetesDiscovery] Could not stat dropped path "${absPath}": ${message}`);
                void vscode.window.showWarningMessage(vscode.l10n.t('Cannot read "{0}": {1}', baseName, message));
                continue;
            }

            // Parse + validate.
            try {
                const kubeConfig = await loadKubeConfig(absPath);
                const contexts = getContexts(kubeConfig);
                if (contexts.length === 0) {
                    invalid++;
                    void vscode.window.showWarningMessage(
                        vscode.l10n.t('"{0}" does not contain any Kubernetes contexts.', baseName),
                    );
                    continue;
                }
            } catch (error) {
                invalid++;
                const message = error instanceof Error ? error.message : String(error);
                ext.outputChannel.error(
                    `[KubernetesDiscovery] Dropped file "${absPath}" is not a valid kubeconfig: ${message}`,
                );
                void vscode.window.showWarningMessage(
                    vscode.l10n.t('"{0}" is not a valid kubeconfig: {1}', baseName, message),
                );
                continue;
            }

            // tryAddFileSource is the single source of truth for dedup: it tells
            // us via the `created` flag whether storage actually changed. This
            // is race-safe against concurrent adds (another drop, or the Add
            // Source wizard running in parallel) that a snapshot-and-compare
            // approach could miss.
            const { record, created } = await tryAddFileSource(absPath);
            if (!created) {
                alreadyRegistered++;
                ext.outputChannel.appendLine(
                    vscode.l10n.t('Kubeconfig source for "{0}" is already registered; skipping.', baseName),
                );
                continue;
            }

            added++;
            firstAddedSourceId = firstAddedSourceId ?? record.id;
            firstAddedLabel = firstAddedLabel ?? record.label;
            ext.outputChannel.appendLine(
                vscode.l10n.t('Added kubeconfig source "{0}" via drag-and-drop.', record.label),
            );
        }

        context.telemetry.measurements.confirmedFileCount = fileUris.length;
        context.telemetry.measurements.addedCount = added;
        context.telemetry.measurements.alreadyRegisteredCount = alreadyRegistered;
        context.telemetry.measurements.invalidCount = invalid;

        if (added === 0) {
            // Nothing actually changed in storage. Per-file warnings (for
            // rejected files) and per-file output-channel notes (for dedup
            // hits) are already enough; no aggregate toast.
            return;
        }

        if (added === 1) {
            void vscode.window.showInformationMessage(
                vscode.l10n.t('Added kubeconfig source "{0}" via drag-and-drop.', firstAddedLabel ?? ''),
            );
        } else {
            void vscode.window.showInformationMessage(
                vscode.l10n.t('Added {0} kubeconfig sources via drag-and-drop.', String(added)),
            );
        }

        // Refresh the tree so the new source(s) appear.
        refreshKubernetesRoot();

        // Best-effort reveal of the first added source. Failure here is
        // cosmetic; the source is added either way.
        if (firstAddedSourceId !== undefined) {
            try {
                await revealKubernetesSource(firstAddedSourceId);
            } catch {
                // Cosmetic only — swallow.
            }
        }
    });
}

/**
 * The user's decision for a kubeconfig drop.
 *
 * - `import` — proceed with registering the source(s).
 * - `preview` — open the file(s) in the editor and stop; the user can drop them
 *   again later to import. Keeps the flow simple (no re-prompt).
 * - `cancelled` — do nothing.
 */
type DropConfirmation = 'import' | 'preview' | 'cancelled';

/**
 * Asks the user to confirm importing the dropped kubeconfig file(s).
 *
 * The modal lists the dropped file(s) as bullet points (a single file uses a
 * dedicated singular message — the common case) and offers three choices:
 *
 * - **Import** — proceed with registering the source(s).
 * - **Preview** — open every dropped file in the editor and exit the flow; the
 *   user can drop the file(s) again to import them.
 * - **Cancel** (the modal's implicit dismiss) — do nothing.
 */
async function confirmKubeconfigDrop(fileUris: readonly vscode.Uri[]): Promise<DropConfirmation> {
    const displayPaths = fileUris.map((uri) => shortenPathMiddle(uri.fsPath));
    const single = fileUris.length === 1;

    const message = single
        ? vscode.l10n.t('Add the dropped kubeconfig file as a Kubernetes discovery source?')
        : vscode.l10n.t(
              'Add the {0} dropped kubeconfig files as Kubernetes discovery sources?',
              String(fileUris.length),
          );

    const fileList = single ? displayPaths[0] : displayPaths.map((p) => `• ${p}`).join('\n');
    const detail = vscode.l10n.t(
        '{0}\n\nNothing is imported until you choose Import. Choose Preview to open the file(s) without importing.',
        fileList,
    );

    const importItem: vscode.MessageItem = { title: vscode.l10n.t('Import') };
    const previewItem: vscode.MessageItem = { title: vscode.l10n.t('Preview') };

    const choice = await vscode.window.showInformationMessage(
        message,
        { modal: true, detail },
        importItem,
        previewItem,
    );

    if (choice === importItem) {
        return 'import';
    }
    if (choice === previewItem) {
        await previewKubeconfigFiles(fileUris);
        return 'preview';
    }
    // Cancel / dismissed.
    return 'cancelled';
}

/**
 * Opens each dropped file in a non-preview editor tab so the user can inspect
 * the contents before importing. Failures are logged but never block the flow.
 */
async function previewKubeconfigFiles(fileUris: readonly vscode.Uri[]): Promise<void> {
    for (const uri of fileUris) {
        try {
            await vscode.window.showTextDocument(uri, { preview: false, preserveFocus: true });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ext.outputChannel.warn(`[KubernetesDiscovery] Could not open "${uri.fsPath}" for preview: ${message}`);
        }
    }
}
