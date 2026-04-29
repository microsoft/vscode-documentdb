/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { StorageService, type StorageItem } from '../../../services/storageService';
import {
    CUSTOM_KUBECONFIG_PATH_KEY,
    DEFAULT_SOURCE_ID,
    ENABLED_CONTEXTS_KEY,
    FILTERED_NAMESPACES_KEY,
    HIDDEN_CONTEXTS_KEY,
    HIDDEN_SOURCE_IDS_KEY,
    INLINE_KUBECONFIG_SECRET_KEY,
    INLINE_KUBECONFIG_SECRET_PREFIX,
    KUBECONFIG_SOURCE_KEY,
    KUBECONFIG_SOURCES_KEY,
    MIGRATION_V2_DONE_KEY,
    type KubeconfigSourceRecord,
} from '../config';
import {
    isMigrationDone,
    KUBECONFIG_STORAGE_NAME,
    KUBECONFIG_STORAGE_WORKSPACE,
    markMigrationDone,
    resetSourceStoreCacheForMigration,
    setHiddenSourceIds,
} from './sourceStore';

/**
 * Legacy globalState key used while the v3 done flag was stored directly in
 * globalState. Kept as a constant so the migration can wipe it once and then
 * stop reading it.
 */
const LEGACY_MIGRATION_DONE_KEY = 'kubernetes-discovery.migration.v3Done';

interface SourceItemProperties extends Record<string, unknown> {
    readonly kind: 'default' | 'file' | 'inline';
    readonly path?: string;
    readonly order: number;
}

interface LegacyV2SourceRecord extends KubeconfigSourceRecord {
    readonly secretKey?: string;
}

let migrationCompletedThisSession = false;

/**
 * Migrates Kubernetes discovery storage forward to the StorageService-backed
 * v3 layout.
 *
 * - Wipes legacy v1 single-source globalState keys.
 * - If v2 stored sources as a single array under {@link KUBECONFIG_SOURCES_KEY},
 *   imports each record (and its inline YAML secret, if any) into StorageService.
 * - If no sources have ever been written and no v2 array exists, seeds the
 *   StorageService store with the singleton Default entry.
 * - Deletes legacy v2 keys and inline secrets.
 *
 * Idempotent. Safe to call from multiple plugin entry points; only the first
 * call after install / upgrade does any work.
 */
export async function ensureMigration(): Promise<void> {
    if (migrationCompletedThisSession) {
        return;
    }

    if (await isMigrationDone()) {
        migrationCompletedThisSession = true;
        return;
    }

    // Step 1: import any legacy hidden-source-ids array into StorageService
    //         BEFORE wiping the globalState entry below.
    const legacyHidden = ext.context.globalState.get<string[]>(HIDDEN_SOURCE_IDS_KEY);
    if (Array.isArray(legacyHidden) && legacyHidden.length > 0) {
        await setHiddenSourceIds(legacyHidden);
    }

    // Step 2: wipe v1 / v2 globalState keys (idempotent — safe even if absent).
    await ext.context.globalState.update(KUBECONFIG_SOURCE_KEY, undefined);
    await ext.context.globalState.update(CUSTOM_KUBECONFIG_PATH_KEY, undefined);
    await ext.context.globalState.update(ENABLED_CONTEXTS_KEY, undefined);
    await ext.context.globalState.update(HIDDEN_CONTEXTS_KEY, undefined);
    await ext.context.globalState.update(FILTERED_NAMESPACES_KEY, undefined);
    await ext.context.globalState.update(HIDDEN_SOURCE_IDS_KEY, undefined);
    await ext.context.globalState.update(LEGACY_MIGRATION_DONE_KEY, undefined);

    try {
        await ext.secretStorage.delete(INLINE_KUBECONFIG_SECRET_KEY);
    } catch {
        // Ignore — secret may already be absent.
    }

    // Step 3: import v2 array data, if any, into StorageService.
    const legacyArray = ext.context.globalState.get<LegacyV2SourceRecord[]>(KUBECONFIG_SOURCES_KEY);
    const importedAny = await importLegacyV2Array(legacyArray);

    // Step 4: clean up legacy v2 keys.
    await ext.context.globalState.update(KUBECONFIG_SOURCES_KEY, undefined);
    await ext.context.globalState.update(MIGRATION_V2_DONE_KEY, undefined);

    // Step 5: if nothing has been written yet (fresh install or v2 was empty),
    //         seed the StorageService store with the singleton Default record.
    if (!importedAny) {
        const existingItems =
            await StorageService.get(KUBECONFIG_STORAGE_NAME).getItems<SourceItemProperties>(
                KUBECONFIG_STORAGE_WORKSPACE,
            );
        if (existingItems.length === 0) {
            const defaultItem: StorageItem<SourceItemProperties> = {
                id: DEFAULT_SOURCE_ID,
                name: vscode.l10n.t('Default kubeconfig'),
                version: '1',
                properties: { kind: 'default', order: 0 },
            };
            await StorageService.get(KUBECONFIG_STORAGE_NAME).push(KUBECONFIG_STORAGE_WORKSPACE, defaultItem);
        }
    }

    // Step 6: stamp completion via StorageService and reset the source-store
    //         cache so the first read after migration sees fresh state.
    await markMigrationDone();
    resetSourceStoreCacheForMigration();
    migrationCompletedThisSession = true;
}

async function importLegacyV2Array(legacy: LegacyV2SourceRecord[] | undefined): Promise<boolean> {
    if (!Array.isArray(legacy) || legacy.length === 0) {
        return false;
    }

    const validRecords = legacy.filter(isValidLegacyRecord);
    if (validRecords.length === 0) {
        return false;
    }

    let imported = 0;
    for (let i = 0; i < validRecords.length; i++) {
        const record = validRecords[i];
        try {
            let secrets: string[] | undefined;
            if (record.kind === 'inline') {
                const secretKey = record.secretKey ?? `${INLINE_KUBECONFIG_SECRET_PREFIX}${record.id}`;
                try {
                    const yaml = await ext.secretStorage.get(secretKey);
                    if (yaml) {
                        secrets = [yaml];
                    }
                } catch {
                    // Ignore; record will be imported without YAML.
                }

                try {
                    await ext.secretStorage.delete(secretKey);
                } catch {
                    // Best effort.
                }
            }

            const item: StorageItem<SourceItemProperties> = {
                id: record.id,
                name: record.label,
                version: '1',
                properties: {
                    kind: record.kind,
                    path: record.kind === 'file' ? record.path : undefined,
                    order: i,
                },
                secrets,
            };
            await StorageService.get(KUBECONFIG_STORAGE_NAME).push(KUBECONFIG_STORAGE_WORKSPACE, item);
            imported++;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ext.outputChannel.warn(
                `[KubernetesDiscovery] Skipped legacy source "${record.label}" during v3 migration: ${message}`,
            );
        }
    }

    return imported > 0;
}

function isValidLegacyRecord(value: unknown): value is LegacyV2SourceRecord {
    if (value === null || typeof value !== 'object') return false;
    const r = value as Partial<LegacyV2SourceRecord>;
    if (typeof r.id !== 'string' || r.id.length === 0) return false;
    if (typeof r.label !== 'string' || r.label.length === 0) return false;
    if (r.kind !== 'default' && r.kind !== 'file' && r.kind !== 'inline') return false;
    if (r.kind === 'file' && (typeof r.path !== 'string' || r.path.length === 0)) return false;
    return true;
}

/**
 * Test-only: reset the in-process guard so unit tests can re-run the migration
 * against a freshly mocked globalState.
 *
 * @internal
 */
export function _resetMigrationGuardForTests(): void {
    migrationCompletedThisSession = false;
}
