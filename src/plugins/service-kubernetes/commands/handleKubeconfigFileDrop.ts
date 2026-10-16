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
import { DISCOVERY_PROVIDER_ID, type KubeconfigSourceRecord } from '../config';
import { getContexts, loadKubeConfig } from '../kubernetesClient';
import { tryAddFileSource } from '../sources/sourceStore';
import { refreshKubernetesRoot, revealKubernetesSource } from './refreshKubernetesRoot';

// Re-exported for unit tests that exercise the display-path shortening behavior.
export { shortenPathMiddle };

/**
 * Upper bound on the size of a file we'll attempt to import as a kubeconfig.
 * Real kubeconfigs are a few KB; 5 MB is generous headroom while still guarding
 * against an accidental drop of a huge file that would otherwise be read and
 * YAML-parsed in full.
 */
const MAX_KUBECONFIG_BYTES = 5 * 1024 * 1024;

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
 *
 * Every successfully processed file (added or already-registered) gets an
 * explicit modal that also selects the relevant node in the tree, mirroring the
 * "Add Kubeconfig Source" / "Save to DocumentDB Connections" UX: a new file
 * confirms the freshly added node, a duplicate explains that the existing node
 * was selected instead of silently doing nothing. For a single dropped file
 * this reliably reveals the right node; for several, the modals appear in
 * sequence and the last revealed node stays selected. Files that fail
 * validation only produce their per-file warning.
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
            // drop them again to import. Note this so the no-op isn't surprising;
            // an explicit cancel needs no log.
            if (confirmation === 'preview') {
                ext.outputChannel.appendLine(
                    '[KubernetesDiscovery] Previewed dropped kubeconfig file(s); not importing. Drop again to import.',
                );
            }
            return;
        }

        let added = 0;
        let alreadyRegistered = 0;
        const invalidReasons: Array<{ name: string; reason: string }> = [];
        const processed: Array<{ record: KubeconfigSourceRecord; created: boolean }> = [];

        for (const uri of fileUris) {
            const absPath = uri.fsPath;
            const baseName = path.basename(absPath) || absPath;

            // Skip non-files (directories, missing).
            try {
                const stat = await fs.promises.stat(absPath);
                if (!stat.isFile()) {
                    invalidReasons.push({ name: baseName, reason: vscode.l10n.t('It is not a regular file.') });
                    continue;
                }

                // A real kubeconfig is a few KB at most. Reject anything wildly
                // larger before we read and YAML-parse it, so an accidental drop
                // of a huge file (e.g. a multi-hundred-MB log or data dump) fails
                // fast with a clear message instead of stalling the parser.
                if (stat.size > MAX_KUBECONFIG_BYTES) {
                    invalidReasons.push({
                        name: baseName,
                        reason: vscode.l10n.t(
                            'The file is {0} MB, which is far larger than any kubeconfig (limit {1} MB).',
                            (stat.size / (1024 * 1024)).toFixed(1),
                            String(MAX_KUBECONFIG_BYTES / (1024 * 1024)),
                        ),
                    });
                    continue;
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                ext.outputChannel.warn(`[KubernetesDiscovery] Could not stat dropped path "${absPath}": ${message}`);
                invalidReasons.push({
                    name: baseName,
                    reason: vscode.l10n.t('The file could not be read: {0}', message),
                });
                continue;
            }

            // Parse + validate.
            try {
                const kubeConfig = await loadKubeConfig(absPath);
                const contexts = getContexts(kubeConfig);
                if (contexts.length === 0) {
                    invalidReasons.push({
                        name: baseName,
                        reason: vscode.l10n.t('It does not contain any Kubernetes contexts.'),
                    });
                    continue;
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                // Keep the full parser error (which can include a code frame full of
                // raw bytes for a binary file) in the output channel only — the modal
                // gets a clean, concise reason instead of a wall of garbage.
                ext.outputChannel.error(
                    `[KubernetesDiscovery] Dropped file "${absPath}" is not a valid kubeconfig: ${message}`,
                );
                invalidReasons.push({
                    name: baseName,
                    reason: vscode.l10n.t(
                        'It is not a valid kubeconfig (it may be a binary file or contain invalid YAML).',
                    ),
                });
                continue;
            }

            // tryAddFileSource is the single source of truth for dedup: it tells
            // us via the `created` flag whether storage actually changed. This
            // is race-safe against concurrent adds (another drop, or the Add
            // Source wizard running in parallel) that a snapshot-and-compare
            // approach could miss.
            const { record, created } = await tryAddFileSource(absPath);
            processed.push({ record, created });
            if (created) {
                added++;
            } else {
                alreadyRegistered++;
            }
        }

        context.telemetry.measurements.confirmedFileCount = fileUris.length;
        context.telemetry.measurements.addedCount = added;
        context.telemetry.measurements.alreadyRegisteredCount = alreadyRegistered;
        context.telemetry.measurements.invalidCount = invalidReasons.length;

        // Surface every rejected file in a single modal (mirrors the preview-failure
        // modal). Shown first so problems are acknowledged before any success modals.
        await notifyInvalidDroppedFiles(invalidReasons);

        if (processed.length === 0) {
            // Every dropped file failed validation; the modal above explained why.
            // Nothing to reveal or refresh.
            return;
        }

        // Refresh once so any newly added node exists in the tree before we
        // reveal it. Duplicates already exist, so a refresh is only needed when
        // something was actually added.
        if (added > 0) {
            refreshKubernetesRoot();
        }

        // Give every processed file an explicit modal that also selects the
        // relevant node — no silent skips. For a single dropped file this lands
        // on exactly the right node; for several, the modals appear in sequence.
        for (const { record, created } of processed) {
            await notifyAndRevealDroppedSource(record, created);
        }
    });
}

/**
 * Reports the dropped files that failed validation in a single modal warning,
 * matching the preview-failure modal. A single failure shows the file name in
 * the title and the reason as the detail; multiple failures are listed as
 * bullets. Full technical details (e.g. the raw YAML parser error for a binary
 * file) stay in the output channel and are deliberately kept out of the dialog.
 */
async function notifyInvalidDroppedFiles(invalid: ReadonlyArray<{ name: string; reason: string }>): Promise<void> {
    if (invalid.length === 0) {
        return;
    }

    const single = invalid.length === 1;
    const message = single
        ? vscode.l10n.t('Could not add "{0}" as a kubeconfig source.', invalid[0].name)
        : vscode.l10n.t('Could not add {0} of the dropped files as kubeconfig sources.', String(invalid.length));
    const detail = single ? invalid[0].reason : invalid.map(({ name, reason }) => `• ${name}: ${reason}`).join('\n');

    await vscode.window.showWarningMessage(message, { modal: true, detail });
}

/**
 * Reveals (and thereby selects) a dropped source's node in the Services view,
 * then shows a modal confirming the outcome.
 *
 * Mirrors the "Add Kubeconfig Source" UX: a newly added file confirms the new
 * node, while an already-registered file explains that the existing node was
 * selected instead of silently doing nothing. Revealing is best-effort — a
 * failure here is cosmetic and never blocks the confirmation.
 */
async function notifyAndRevealDroppedSource(record: KubeconfigSourceRecord, created: boolean): Promise<void> {
    try {
        await revealKubernetesSource(record.id);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ext.outputChannel.warn(
            `[KubernetesDiscovery] Failed to reveal kubeconfig source "${record.label}": ${message}`,
        );
    }

    if (created) {
        ext.outputChannel.appendLine(vscode.l10n.t('Added kubeconfig source "{0}" via drag-and-drop.', record.label));
        await vscode.window.showInformationMessage(vscode.l10n.t('Added kubeconfig source "{0}".', record.label), {
            modal: true,
            detail: vscode.l10n.t('The new source has been selected in the Services view.'),
        });
        return;
    }

    ext.outputChannel.appendLine(
        vscode.l10n.t('Kubeconfig source "{0}" already exists; selected the existing one.', record.label),
    );
    await vscode.window.showInformationMessage(vscode.l10n.t('A kubeconfig source for this file already exists.'), {
        modal: true,
        detail: vscode.l10n.t(
            'The existing source has been selected in the Services view.\n\nSelected source name:\n"{0}"',
            record.label,
        ),
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
 * the contents before importing.
 *
 * Files that can't be opened as text (e.g. a binary such as an image) are
 * collected and surfaced in a single visible warning rather than failing
 * silently — such a file is almost certainly not a kubeconfig. The per-file
 * reason is still written to the output channel for diagnostics.
 */
async function previewKubeconfigFiles(fileUris: readonly vscode.Uri[]): Promise<void> {
    const failed: string[] = [];
    for (const uri of fileUris) {
        try {
            await vscode.window.showTextDocument(uri, { preview: false, preserveFocus: true });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ext.outputChannel.warn(`[KubernetesDiscovery] Could not open "${uri.fsPath}" for preview: ${message}`);
            failed.push(uri.fsPath);
        }
    }

    if (failed.length === 0) {
        return;
    }

    void vscode.window.showWarningMessage(
        failed.length === 1
            ? vscode.l10n.t('Could not open "{0}" for preview.', path.basename(failed[0]))
            : vscode.l10n.t('Could not open {0} of the dropped files for preview.', String(failed.length)),
        {
            modal: true,
            detail:
                failed.length === 1
                    ? vscode.l10n.t('It looks like a binary file rather than a kubeconfig.')
                    : vscode.l10n.t('They look like binary files rather than kubeconfigs.'),
        },
    );
}
