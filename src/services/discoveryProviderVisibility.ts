/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../extensionVariables';
import { DiscoveryService, type ProviderDescription } from './discoveryServices';

const HIDDEN_DISCOVERY_PROVIDER_IDS_KEY = 'hiddenDiscoveryProviderIds';

/**
 * Legacy pre-0.9.0 opt-in allow-list key (see the module doc below). No longer read;
 * removed once by {@link removeLegacyActiveDiscoveryProviderIds}.
 */
const LEGACY_ACTIVE_DISCOVERY_PROVIDER_IDS_KEY = 'activeDiscoveryProviderIds';

let hiddenProviderIdsCache: string[] | undefined;

/**
 * Discovery-provider visibility — storage model and cross-version upgrade behavior.
 *
 * Current model (>= 0.9.0): OPT-OUT deny-list. Every registered provider is visible by
 * default; `hiddenDiscoveryProviderIds` records only the ones the user chose to hide.
 * Default (empty list) => all providers visible.
 *
 * Legacy model (<= 0.8.x): OPT-IN allow-list stored under `activeDiscoveryProviderIds`.
 * Default (empty list) => nothing visible; users explicitly activated providers.
 *
 * The 0.8.x -> 0.9.x upgrade is intentionally NOT migrated. The semantics are inverted
 * (opt-in allow-list -> opt-out deny-list), so the legacy `activeDiscoveryProviderIds`
 * value is ignored and left as-is in globalState. Upgraders therefore start with ALL
 * providers visible. This is by design and upgrade-safe: it only ever reveals more
 * providers, never hides one that was previously visible, so it is not a downgrade.
 *
 * A one-time active->hidden migration existed briefly during 0.9.0 development but was
 * dropped before release (never shipped), so no half-migrated state exists in the wild.
 * Do NOT reintroduce a migration without revisiting that product decision.
 */
export async function getHiddenDiscoveryProviderIds(): Promise<string[]> {
    return readHiddenDiscoveryProviderIds();
}

/**
 * One-time, best-effort cleanup of the stale pre-0.9.0 `activeDiscoveryProviderIds`
 * globalState key. Safe to run on every activation: it writes only when the key is
 * still present. The value is intentionally not migrated (see the module doc).
 *
 * TODO(#831): remove this function and {@link LEGACY_ACTIVE_DISCOVERY_PROVIDER_IDS_KEY}
 * ~6 months after 0.9.2, once users have upgraded past 0.8.x.
 */
export async function removeLegacyActiveDiscoveryProviderIds(): Promise<void> {
    // Best-effort: swallow storage errors so this cleanup can never disrupt activation.
    try {
        if (ext.context.globalState.get(LEGACY_ACTIVE_DISCOVERY_PROVIDER_IDS_KEY) !== undefined) {
            await ext.context.globalState.update(LEGACY_ACTIVE_DISCOVERY_PROVIDER_IDS_KEY, undefined);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ext.outputChannel.error(
            `Failed to remove legacy '${LEGACY_ACTIVE_DISCOVERY_PROVIDER_IDS_KEY}' discovery state: ${message}`,
        );
    }
}

export async function getVisibleDiscoveryProviders(): Promise<ProviderDescription[]> {
    const hiddenProviderIds = new Set(await getHiddenDiscoveryProviderIds());
    return DiscoveryService.listProviders().filter((provider) => !hiddenProviderIds.has(provider.id));
}

export async function getHiddenDiscoveryProviders(): Promise<ProviderDescription[]> {
    const hiddenProviderIds = new Set(await getHiddenDiscoveryProviderIds());
    return DiscoveryService.listProviders().filter((provider) => hiddenProviderIds.has(provider.id));
}

export async function hideDiscoveryProvider(providerId: string): Promise<string[]> {
    const hiddenProviderIds = await getHiddenDiscoveryProviderIds();
    const updated = hiddenProviderIds.includes(providerId) ? hiddenProviderIds : [...hiddenProviderIds, providerId];
    await writeHiddenDiscoveryProviderIds(updated);
    return readHiddenDiscoveryProviderIds();
}

export async function showDiscoveryProvider(providerId: string): Promise<string[]> {
    const hiddenProviderIds = await getHiddenDiscoveryProviderIds();
    const updated = hiddenProviderIds.filter((id) => id !== providerId);
    await writeHiddenDiscoveryProviderIds(updated);
    return readHiddenDiscoveryProviderIds();
}

export function resetDiscoveryProviderVisibilityCacheForTests(): void {
    hiddenProviderIdsCache = undefined;
}

function readHiddenDiscoveryProviderIds(): string[] {
    if (hiddenProviderIdsCache) {
        return [...hiddenProviderIdsCache];
    }

    const hiddenProviderIds = ext.context.globalState.get<string[]>(HIDDEN_DISCOVERY_PROVIDER_IDS_KEY, []);
    hiddenProviderIdsCache = normalizeProviderIds(hiddenProviderIds);
    return [...hiddenProviderIdsCache];
}

async function writeHiddenDiscoveryProviderIds(providerIds: readonly string[]): Promise<void> {
    // Persist the full normalized denylist (including ids for providers that
    // are not currently registered, e.g. a plugin loaded later or in a future
    // build). Filtering against `DiscoveryService.listProviders()` only at
    // read/filter time prevents a user's hide preference from being silently
    // forgotten when registration timing changes.
    const persistedProviderIds = normalizeProviderIds(providerIds);
    await ext.context.globalState.update(HIDDEN_DISCOVERY_PROVIDER_IDS_KEY, persistedProviderIds);
    hiddenProviderIdsCache = persistedProviderIds;
}

/**
 * Deduplicates ids and drops empty values without removing unknown providers,
 * so a hide preference for a plugin that isn't currently registered
 * (timing-dependent activation, future builds) survives read/write cycles.
 */
function normalizeProviderIds(providerIds: readonly string[]): string[] {
    return Array.from(new Set(providerIds.filter((id): id is string => typeof id === 'string' && id.length > 0)));
}
