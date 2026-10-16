/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * One-time legacy emulator migration (Local Quick Start design §4).
 *
 * The dedicated "DocumentDB Local" emulator storage zone and its tree node are being
 * retired in favour of regular connections + the Quick Start managed instance. On the
 * first activation after the update we **copy** every connection from the `Emulators`
 * storage zone into a new "Local Connections (Legacy)" folder in the regular `Clusters`
 * zone, preserving credentials, auth config and (normalized) `emulatorConfiguration`.
 *
 * This relies on the storage-zone decoupling: a connection's operations are routed by the
 * tree model's `storageZone` (set to `Clusters` by `FolderItem` for the migrated copies),
 * NOT by `emulatorConfiguration.isEmulator`. The copies therefore keep `isEmulator: true`
 * so local TLS-allow-invalid still works, while connect/rename/delete/move correctly target
 * the `Clusters` zone.
 *
 * Safety properties (so a migration bug can never orphan a user's local connections):
 * - The original `Emulators` zone is **kept** as a deprecated, read-only rollback path
 *   (§4.5) — we never delete it here.
 * - Folder + copied-connection ids are **deterministic**, and a retry **creates only the
 *   missing** copies (it never overwrites an existing one), so a partial run that retries on
 *   the next launch is idempotent (no duplicates) and never reverts a user's later edits.
 * - The completion flag is only set after **all** connections copy successfully; until
 *   then the legacy emulator tree node stays visible, so nothing is ever hidden while
 *   still un-migrated.
 *
 * Scope note: per §4 ("into that folder"), Emulators-zone **sub-folders are flattened** —
 * every connection is copied directly under the single legacy folder. No data is lost (the
 * originals remain in the Emulators zone); only the folder organization is not reproduced.
 */

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import {
    ConnectionStorageService,
    isConnection,
    isFolder,
    ItemType,
    StorageZone,
    type StoredItem,
} from './connectionStorageService';

/** globalState flag recording that the one-time migration has fully completed. */
const MIGRATION_COMPLETED_KEY = 'documentdb.localQuickStart.legacyEmulatorMigration.completed';

/** Stable id of the destination folder, so retries reuse it instead of duplicating. */
const LEGACY_FOLDER_ID = 'vscode-documentdb.legacyLocalConnectionsFolder';

/** Base name of the destination folder (a numeric suffix is added on a name clash). */
const LEGACY_FOLDER_BASE_NAME = 'Local Connections (Legacy)';

/** Whether the one-time legacy emulator migration has completed (gates the tree node). */
export function isLegacyEmulatorMigrationComplete(): boolean {
    return ext.context.globalState.get<boolean>(MIGRATION_COMPLETED_KEY, false);
}

/** Deterministic id for a copied connection, so retries overwrite rather than duplicate. */
function legacyConnectionId(originalId: string): string {
    return `legacy_${originalId}`;
}

/**
 * Pick a root-level folder name that does not clash with an existing user folder in the
 * Clusters zone (excluding our own deterministic folder so retries don't keep re-suffixing).
 */
async function uniqueLegacyFolderName(): Promise<string> {
    const rootFolders = await ConnectionStorageService.getChildren(undefined, StorageZone.Clusters, ItemType.Folder);
    const takenNames = new Set(rootFolders.filter((f) => f.id !== LEGACY_FOLDER_ID).map((f) => f.name));
    if (!takenNames.has(LEGACY_FOLDER_BASE_NAME)) {
        return LEGACY_FOLDER_BASE_NAME;
    }
    for (let i = 2; ; i++) {
        const candidate = `${LEGACY_FOLDER_BASE_NAME} (${i})`;
        if (!takenNames.has(candidate)) {
            return candidate;
        }
    }
}

/**
 * Run the one-time migration. Best-effort and non-blocking: wrapped in
 * `callWithTelemetryAndErrorHandling` so it never throws into activation; on any failure
 * the completion flag is left unset so the next launch retries (idempotently) and the
 * legacy node stays visible meanwhile.
 */
export async function migrateLegacyEmulatorConnections(): Promise<void> {
    if (isLegacyEmulatorMigrationComplete()) {
        return;
    }

    await callWithTelemetryAndErrorHandling('documentDB.quickstart.legacyMigration', async (context) => {
        context.errorHandling.suppressDisplay = true;
        context.telemetry.properties.outcome = 'started';

        const allItems = await ConnectionStorageService.getAllItems(StorageZone.Emulators);
        const emulatorConnections = allItems.filter(isConnection);
        context.telemetry.measurements.itemsFound = allItems.length;
        context.telemetry.measurements.connectionsFound = emulatorConnections.length;

        if (emulatorConnections.length === 0) {
            // Nothing to migrate — mark done so we never run again, and refresh so the
            // (now retired) legacy node disappears.
            await ext.context.globalState.update(MIGRATION_COMPLETED_KEY, true);
            ext.connectionsBranchDataProvider?.refresh();
            context.telemetry.properties.outcome = 'nothingToMigrate';
            return;
        }

        // Reuse an existing legacy folder from a prior (partial) run so a retry never
        // overwrites a user rename; only create it the first time. Guard that the id still
        // refers to a folder — if corruption/a bug ever made it a connection, fall back to a
        // fresh folder rather than parenting copies under a non-folder (which the storage
        // cleanup would later treat as orphaned and delete).
        const existing = await ConnectionStorageService.get(LEGACY_FOLDER_ID, StorageZone.Clusters);
        const existingFolder = existing && isFolder(existing) ? existing : undefined;
        const folderName = existingFolder?.name ?? (await uniqueLegacyFolderName());
        context.telemetry.properties.folderReused = String(!!existingFolder);
        if (!existingFolder) {
            context.telemetry.properties.folderSuffixed = String(folderName !== LEGACY_FOLDER_BASE_NAME);
            await ConnectionStorageService.saveFolder(StorageZone.Clusters, { id: LEGACY_FOLDER_ID, name: folderName });
        }

        let failed = 0;
        const copyMissing = async (connections: ReadonlyArray<StoredItem>): Promise<void> => {
            for (const connection of connections) {
                if (!isConnection(connection)) {
                    continue;
                }
                const destId = legacyConnectionId(connection.id);
                // Create-if-missing: never overwrite an already-copied legacy connection
                // (preserves a user's later edits) and never duplicate it.
                if (await ConnectionStorageService.get(destId, StorageZone.Clusters)) {
                    continue;
                }
                try {
                    await ConnectionStorageService.saveConnection(
                        StorageZone.Clusters,
                        {
                            id: destId,
                            name: connection.name,
                            properties: {
                                ...connection.properties,
                                // Re-home under the legacy folder (replaces any Emulators-zone parent).
                                parentId: LEGACY_FOLDER_ID,
                                // Normalize the emulator flag exactly like LocalEmulatorsItem renders it,
                                // so local TLS-allow-invalid keeps working in the Clusters zone. Zone
                                // routing is handled separately by the tree model's storageZone.
                                emulatorConfiguration: {
                                    isEmulator: true,
                                    disableEmulatorSecurity:
                                        !!connection.properties.emulatorConfiguration?.disableEmulatorSecurity,
                                },
                            },
                            secrets: {
                                connectionString: connection.secrets.connectionString,
                                nativeAuthConfig: connection.secrets.nativeAuthConfig,
                                entraIdAuthConfig: connection.secrets.entraIdAuthConfig,
                            },
                        },
                        false /* never overwrite — the get() above guarantees this is a new copy */,
                    );
                } catch (error) {
                    failed++;
                    ext.outputChannel.warn(
                        `[LegacyMigration] Failed to migrate emulator connection "${connection.name}": ${
                            error instanceof Error ? error.message : String(error)
                        }`,
                    );
                }
            }
        };

        await copyMissing(emulatorConnections);
        // Reconciliation pass: re-read the Emulators zone and copy anything added after the
        // initial snapshot (e.g. a localhost deep-link handled during this run), so we never
        // set the completion flag — and hide the legacy node — while a source connection is
        // still un-copied (closes the activation-window race).
        const finalConnections = (await ConnectionStorageService.getAllItems(StorageZone.Emulators)).filter(
            isConnection,
        );
        await copyMissing(finalConnections);

        // Converged only when every current emulator connection has a Clusters copy.
        let stillMissing = 0;
        for (const connection of finalConnections) {
            if (!(await ConnectionStorageService.get(legacyConnectionId(connection.id), StorageZone.Clusters))) {
                stillMissing++;
            }
        }
        context.telemetry.measurements.connectionsMigrated = finalConnections.length - stillMissing;
        context.telemetry.measurements.connectionsFailed = failed;

        // Refresh so the copies appear immediately.
        ext.connectionsBranchDataProvider?.refresh();

        if (failed > 0 || stillMissing > 0) {
            // Leave the flag unset: retry next launch (idempotent), keep the legacy node visible.
            context.telemetry.properties.outcome = 'partial';
            return;
        }

        // The Emulators zone is intentionally KEPT as a read-only rollback path (§4.5).
        await ext.context.globalState.update(MIGRATION_COMPLETED_KEY, true);
        ext.connectionsBranchDataProvider?.refresh();
        context.telemetry.properties.outcome = 'completed';

        void vscode.window.showInformationMessage(
            l10n.t("Your local connections have been moved to '{0}' in the Connections view.", folderName),
        );
    });
}
