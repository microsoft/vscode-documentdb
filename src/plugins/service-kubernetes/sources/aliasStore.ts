/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StorageService, type StorageItem } from '../../../services/storageService';
import { KUBECONFIG_STORAGE_NAME } from './sourceStore';

/**
 * StorageService workspace under {@link KUBECONFIG_STORAGE_NAME} for context
 * display aliases. Aliases are display-only — the kubeconfig YAML and the
 * `contextName` baked into saved connections are never modified.
 */
export const KUBECONFIG_ALIASES_WORKSPACE = 'aliases';

const ALIASES_ITEM_ID = 'contextAliases';

/**
 * Per-context display alias keyed by `(sourceId, contextName)`. The alias is
 * a free-form string that overrides only the display label in the discovery
 * tree and the new-connection wizard. The underlying Kubernetes context name
 * is unchanged everywhere else (clusterId, port-forward metadata, telemetry).
 */
export interface ContextAliasEntry {
    readonly sourceId: string;
    readonly contextName: string;
    readonly alias: string;
}

interface AliasesProperties extends Record<string, unknown> {
    readonly entries: ContextAliasEntry[];
}

let cache: ContextAliasEntry[] | undefined;
let inflight: Promise<ContextAliasEntry[]> | undefined;

function invalidate(): void {
    cache = undefined;
    inflight = undefined;
}

async function loadFromStorage(): Promise<ContextAliasEntry[]> {
    const item = await StorageService.get(KUBECONFIG_STORAGE_NAME).getItem<AliasesProperties>(
        KUBECONFIG_ALIASES_WORKSPACE,
        ALIASES_ITEM_ID,
    );
    const raw = item?.properties?.entries;
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.filter(isValidEntry);
}

async function ensureCache(): Promise<ContextAliasEntry[]> {
    if (cache) {
        return cache;
    }
    if (!inflight) {
        inflight = loadFromStorage();
    }
    const loaded = await inflight;
    cache = loaded;
    inflight = undefined;
    return loaded;
}

async function persist(entries: ContextAliasEntry[]): Promise<void> {
    const item: StorageItem<AliasesProperties> = {
        id: ALIASES_ITEM_ID,
        name: 'Kubernetes context aliases',
        version: '1',
        properties: { entries },
    };
    await StorageService.get(KUBECONFIG_STORAGE_NAME).push(KUBECONFIG_ALIASES_WORKSPACE, item, /* overwrite */ true);
    invalidate();
}

/**
 * Returns the alias for the given `(sourceId, contextName)` pair, or `undefined`
 * when no alias is set or the stored value is empty after trimming.
 */
export async function aliasFor(sourceId: string, contextName: string): Promise<string | undefined> {
    const entries = await ensureCache();
    const match = entries.find((e) => e.sourceId === sourceId && e.contextName === contextName);
    if (!match) {
        return undefined;
    }
    const trimmed = match.alias.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Returns all aliases for the given source, as a `Map<contextName, alias>`.
 * Empty aliases are excluded so callers can short-circuit on `Map.get`.
 */
export async function aliasMapForSource(sourceId: string): Promise<Map<string, string>> {
    const entries = await ensureCache();
    const map = new Map<string, string>();
    for (const entry of entries) {
        if (entry.sourceId !== sourceId) continue;
        const trimmed = entry.alias.trim();
        if (trimmed.length > 0) {
            map.set(entry.contextName, trimmed);
        }
    }
    return map;
}

/**
 * Returns the full list of stored entries (defensive copy). Useful for the
 * wizard which iterates all sources at once.
 */
export async function readAliases(): Promise<ContextAliasEntry[]> {
    return [...(await ensureCache())];
}

/**
 * Sets or clears the alias for `(sourceId, contextName)`. Passing `undefined`
 * or an empty/whitespace-only string removes any existing entry.
 */
export async function setAlias(sourceId: string, contextName: string, alias: string | undefined): Promise<void> {
    const trimmed = alias?.trim() ?? '';
    const entries = await ensureCache();
    const filtered = entries.filter((e) => !(e.sourceId === sourceId && e.contextName === contextName));

    if (trimmed.length === 0) {
        if (filtered.length === entries.length) {
            return; // No change.
        }
        await persist(filtered);
        return;
    }

    filtered.push({ sourceId, contextName, alias: trimmed });
    await persist(filtered);
}

/**
 * Drops every alias keyed to the given source id. Called when a source is
 * removed (right-click Remove or Manage UI trash button).
 */
export async function clearAliasesForSource(sourceId: string): Promise<void> {
    const entries = await ensureCache();
    const filtered = entries.filter((e) => e.sourceId !== sourceId);
    if (filtered.length === entries.length) {
        return;
    }
    await persist(filtered);
}

/**
 * Drops aliases for the given source whose `contextName` is no longer present
 * in `knownContextNames`. Best-effort: callers may invoke fire-and-forget.
 */
export async function pruneAliasesForSource(sourceId: string, knownContextNames: readonly string[]): Promise<void> {
    const known = new Set(knownContextNames);
    const entries = await ensureCache();
    const filtered = entries.filter((e) => e.sourceId !== sourceId || known.has(e.contextName));
    if (filtered.length === entries.length) {
        return;
    }
    await persist(filtered);
}

/**
 * Test-only hook: reset the in-process cache so unit tests can run against a
 * freshly mocked StorageService.
 *
 * @internal
 */
export function _resetAliasCacheForTests(): void {
    invalidate();
}

function isValidEntry(value: unknown): value is ContextAliasEntry {
    if (!value || typeof value !== 'object') return false;
    const e = value as Partial<ContextAliasEntry>;
    return (
        typeof e.sourceId === 'string' &&
        e.sourceId.length > 0 &&
        typeof e.contextName === 'string' &&
        e.contextName.length > 0 &&
        typeof e.alias === 'string'
    );
}
