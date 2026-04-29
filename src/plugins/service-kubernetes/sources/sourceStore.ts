/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash, randomUUID } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { StorageService, type StorageItem } from '../../../services/storageService';
import { DEFAULT_SOURCE_ID, type KubeconfigSourceRecord } from '../config';

/**
 * StorageService lookup name for kubeconfig sources. Each source is stored as
 * an individual {@link StorageItem} under the workspace below.
 */
export const KUBECONFIG_STORAGE_NAME = 'kubernetes-discovery';
export const KUBECONFIG_STORAGE_WORKSPACE = 'sources';

/**
 * Workspace within {@link KUBECONFIG_STORAGE_NAME} for plugin-wide settings —
 * single-row items like the hidden-source-ids list and the migration marker.
 */
export const KUBECONFIG_SETTINGS_WORKSPACE = 'settings';

const HIDDEN_SOURCES_ITEM_ID = 'hiddenSources';
const MIGRATION_ITEM_ID = 'migration';

interface HiddenSourcesProperties extends Record<string, unknown> {
    readonly ids: string[];
}

interface MigrationProperties extends Record<string, unknown> {
    readonly done: boolean;
    readonly version: string;
}

/**
 * Per-item properties stored alongside each kubeconfig source.
 *
 * We persist the source kind + path (for file sources) + an `order` field
 * so the tree renders sources in a stable insertion order independent of
 * `globalState.keys()` iteration semantics.
 */
interface SourceItemProperties extends Record<string, unknown> {
    readonly kind: 'default' | 'file' | 'inline';
    readonly path?: string;
    readonly order: number;
}

/**
 * Schema version embedded in every {@link StorageItem.version} field. Bump on
 * breaking shape changes so future migrations can target a known starting point.
 */
const SOURCE_ITEM_VERSION = '1';

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

let cache: KubeconfigSourceRecord[] | undefined;
let inflightLoad: Promise<KubeconfigSourceRecord[]> | undefined;

function invalidateCache(): void {
    cache = undefined;
    inflightLoad = undefined;
}

async function loadFromStorage(): Promise<KubeconfigSourceRecord[]> {
    const items =
        await StorageService.get(KUBECONFIG_STORAGE_NAME).getItems<SourceItemProperties>(KUBECONFIG_STORAGE_WORKSPACE);
    const records = items
        .filter(isValidStorageItem)
        .sort((a, b) => orderOf(a) - orderOf(b))
        .map(storageItemToRecord);
    return records;
}

async function ensureCache(): Promise<KubeconfigSourceRecord[]> {
    if (cache) {
        return cache;
    }
    if (!inflightLoad) {
        inflightLoad = loadFromStorage();
    }
    const loaded = await inflightLoad;
    cache = loaded;
    inflightLoad = undefined;
    return loaded;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resets the in-memory cache. Used by migration code so the first read after
 * a migration sees the freshly-written items rather than stale data.
 *
 * @internal
 */
export function resetSourceStoreCacheForMigration(): void {
    invalidateCache();
}

/**
 * Read the persisted list of kubeconfig sources, in display order. The default
 * source is no longer auto-inserted — once the user explicitly removes it, it
 * stays gone until they re-add it via {@link addDefaultSource}.
 */
export async function readSources(): Promise<KubeconfigSourceRecord[]> {
    return [...(await ensureCache())];
}

export async function getSource(id: string): Promise<KubeconfigSourceRecord | undefined> {
    return (await ensureCache()).find((s) => s.id === id);
}

/**
 * Adds (or reuses) the singleton Default source. Returns the existing record
 * if one is already present; otherwise creates one with the reserved id
 * {@link DEFAULT_SOURCE_ID} so saved connections that reference it via
 * `sourceId` keep working after a remove + re-add round trip.
 */
export async function addDefaultSource(): Promise<KubeconfigSourceRecord> {
    const sources = await ensureCache();
    const existing = sources.find((s) => s.kind === 'default');
    if (existing) {
        return existing;
    }

    const newRecord: KubeconfigSourceRecord = {
        id: DEFAULT_SOURCE_ID,
        kind: 'default',
        label: vscode.l10n.t('Default kubeconfig'),
    };
    await pushItem(newRecord, /* order */ -1);
    invalidateCache();
    return newRecord;
}

/**
 * Adds (or reuses) a file source.
 *
 * If a file source with the same absolute path already exists, returns
 * that record without creating a duplicate.
 */
export async function addFileSource(absolutePath: string): Promise<KubeconfigSourceRecord> {
    const normalizedPath = path.normalize(absolutePath);
    const sources = await ensureCache();

    const existing = sources.find((s) => s.kind === 'file' && s.path && path.normalize(s.path) === normalizedPath);
    if (existing) {
        return existing;
    }

    const baseLabel = path.basename(normalizedPath) || normalizedPath;
    const newRecord: KubeconfigSourceRecord = {
        id: randomUUID(),
        label: nextUniqueLabel(baseLabel, sources),
        kind: 'file',
        path: normalizedPath,
    };

    await pushItem(newRecord, await nextOrder(sources));
    invalidateCache();
    return newRecord;
}

/**
 * Adds (or reuses) an inline source backed by Secret Storage (via StorageService).
 *
 * If an inline source already exists whose stored YAML matches the provided
 * YAML (after trimming), the existing record is returned unchanged.
 */
export async function addInlineSource(yaml: string): Promise<KubeconfigSourceRecord> {
    const trimmed = yaml.trim();
    if (trimmed.length === 0) {
        throw new Error(vscode.l10n.t('Pasted kubeconfig YAML is empty.'));
    }

    const incomingHash = sha256(trimmed);
    const sources = await ensureCache();

    for (const record of sources) {
        if (record.kind !== 'inline') {
            continue;
        }
        const existingYaml = (await readInlineYaml(record)) ?? '';
        if (existingYaml.length > 0 && sha256(existingYaml.trim()) === incomingHash) {
            return record;
        }
    }

    const id = randomUUID();
    const newRecord: KubeconfigSourceRecord = {
        id,
        label: nextInlineLabel(sources),
        kind: 'inline',
    };

    await pushItem(newRecord, await nextOrder(sources), [trimmed]);
    invalidateCache();
    return newRecord;
}

export async function renameSource(id: string, newLabel: string): Promise<void> {
    const trimmed = newLabel.trim();
    if (trimmed.length === 0) {
        throw new Error(vscode.l10n.t('Source label cannot be empty.'));
    }

    const sources = await ensureCache();
    const record = sources.find((s) => s.id === id);
    if (!record) {
        return;
    }

    const order = sources.indexOf(record);
    const updated: KubeconfigSourceRecord = { ...record, label: trimmed };
    const secrets = await readSecretsForExistingItem(id);
    await pushItem(updated, order, secrets);
    invalidateCache();
}

export async function removeSource(id: string): Promise<KubeconfigSourceRecord | undefined> {
    const sources = await ensureCache();
    const target = sources.find((s) => s.id === id);
    if (!target) {
        return undefined;
    }

    await StorageService.get(KUBECONFIG_STORAGE_NAME).delete(KUBECONFIG_STORAGE_WORKSPACE, id);
    invalidateCache();

    // Drop the id from hidden list if present.
    const hidden = await readHiddenSourceIds();
    if (hidden.includes(id)) {
        await setHiddenSourceIds(hidden.filter((h) => h !== id));
    }
    return target;
}

/**
 * Resolve YAML contents for an inline source. Returns `undefined` when the
 * record is not inline or the secret has been cleared.
 */
export async function readInlineYaml(record: KubeconfigSourceRecord): Promise<string | undefined> {
    if (record.kind !== 'inline') {
        return undefined;
    }
    try {
        const item = await StorageService.get(KUBECONFIG_STORAGE_NAME).getItem<SourceItemProperties>(
            KUBECONFIG_STORAGE_WORKSPACE,
            record.id,
        );
        return item?.secrets?.[0];
    } catch {
        return undefined;
    }
}

/**
 * Returns the persisted list of hidden source ids (sources the user has
 * "deselected" via the manage UI). Stored as a single StorageService item
 * under the {@link KUBECONFIG_SETTINGS_WORKSPACE} so toggling visibility does
 * not have to rewrite the per-source items themselves.
 */
export async function readHiddenSourceIds(): Promise<string[]> {
    const item = await StorageService.get(KUBECONFIG_STORAGE_NAME).getItem<HiddenSourcesProperties>(
        KUBECONFIG_SETTINGS_WORKSPACE,
        HIDDEN_SOURCES_ITEM_ID,
    );
    const ids = item?.properties?.ids;
    if (!Array.isArray(ids)) {
        return [];
    }
    return ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/**
 * Persists the list of hidden source ids. Caller-supplied ids are deduped.
 * Pass an empty array to clear all hidden ids.
 */
export async function setHiddenSourceIds(ids: readonly string[]): Promise<void> {
    const sanitized = Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0)));
    const item: StorageItem<HiddenSourcesProperties> = {
        id: HIDDEN_SOURCES_ITEM_ID,
        name: 'Hidden kubeconfig sources',
        version: '1',
        properties: { ids: sanitized },
    };
    await StorageService.get(KUBECONFIG_STORAGE_NAME).push(KUBECONFIG_SETTINGS_WORKSPACE, item, /* overwrite */ true);
}

/**
 * Returns whether the v3 migration has run.
 */
export async function isMigrationDone(): Promise<boolean> {
    const item = await StorageService.get(KUBECONFIG_STORAGE_NAME).getItem<MigrationProperties>(
        KUBECONFIG_SETTINGS_WORKSPACE,
        MIGRATION_ITEM_ID,
    );
    return item?.properties?.done === true;
}

/**
 * Stamps the v3 migration as complete.
 */
export async function markMigrationDone(): Promise<void> {
    const item: StorageItem<MigrationProperties> = {
        id: MIGRATION_ITEM_ID,
        name: 'Kubernetes discovery migration',
        version: '1',
        properties: { done: true, version: '3' },
    };
    await StorageService.get(KUBECONFIG_STORAGE_NAME).push(KUBECONFIG_SETTINGS_WORKSPACE, item, /* overwrite */ true);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function pushItem(record: KubeconfigSourceRecord, order: number, secrets?: readonly string[]): Promise<void> {
    const item: StorageItem<SourceItemProperties> = {
        id: record.id,
        name: record.label,
        version: SOURCE_ITEM_VERSION,
        properties: {
            kind: record.kind,
            path: record.path,
            order,
        },
        secrets: secrets ? [...secrets] : undefined,
    };
    await StorageService.get(KUBECONFIG_STORAGE_NAME).push(KUBECONFIG_STORAGE_WORKSPACE, item, /* overwrite */ true);
}

async function readSecretsForExistingItem(id: string): Promise<readonly string[] | undefined> {
    const existing = await StorageService.get(KUBECONFIG_STORAGE_NAME).getItem<SourceItemProperties>(
        KUBECONFIG_STORAGE_WORKSPACE,
        id,
    );
    if (!existing?.secrets || existing.secrets.length === 0) {
        return undefined;
    }
    return existing.secrets;
}

async function nextOrder(sources: readonly KubeconfigSourceRecord[]): Promise<number> {
    if (sources.length === 0) {
        return 0;
    }
    const items =
        await StorageService.get(KUBECONFIG_STORAGE_NAME).getItems<SourceItemProperties>(KUBECONFIG_STORAGE_WORKSPACE);
    let highest = -1;
    for (const item of items) {
        const candidate = item.properties?.order;
        if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > highest) {
            highest = candidate;
        }
    }
    return highest + 1;
}

function isValidStorageItem(item: StorageItem<SourceItemProperties>): boolean {
    if (typeof item.id !== 'string' || item.id.length === 0) return false;
    if (typeof item.name !== 'string' || item.name.length === 0) return false;
    const props = item.properties;
    if (!props) return false;
    if (props.kind !== 'default' && props.kind !== 'file' && props.kind !== 'inline') return false;
    if (props.kind === 'file' && (typeof props.path !== 'string' || props.path.length === 0)) return false;
    return true;
}

function orderOf(item: StorageItem<SourceItemProperties>): number {
    const candidate = item.properties?.order;
    return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : Number.MAX_SAFE_INTEGER;
}

function storageItemToRecord(item: StorageItem<SourceItemProperties>): KubeconfigSourceRecord {
    const props = item.properties!;
    return {
        id: item.id,
        label: item.name,
        kind: props.kind,
        path: props.kind === 'file' ? props.path : undefined,
    };
}

function nextUniqueLabel(base: string, existing: readonly KubeconfigSourceRecord[]): string {
    const used = new Set(existing.map((s) => s.label));
    if (!used.has(base)) {
        return base;
    }
    for (let i = 2; i < 1000; i++) {
        const candidate = `${base} (${String(i)})`;
        if (!used.has(candidate)) {
            return candidate;
        }
    }
    return `${base} (${randomUUID().slice(0, 8)})`;
}

function nextInlineLabel(existing: readonly KubeconfigSourceRecord[]): string {
    const inlineCount = existing.filter((s) => s.kind === 'inline').length;
    return vscode.l10n.t('Pasted YAML {0}', String(inlineCount + 1));
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}
