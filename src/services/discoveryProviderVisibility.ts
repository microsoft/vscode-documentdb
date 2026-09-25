/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../extensionVariables';
import { DiscoveryService, type ProviderDescription } from './discoveryServices';

const HIDDEN_DISCOVERY_PROVIDER_IDS_KEY = 'hiddenDiscoveryProviderIds';

let hiddenProviderIdsCache: string[] | undefined;

/**
 * Provider visibility uses a single, simple model: every registered discovery
 * provider is visible by default, and the persisted `hiddenDiscoveryProviderIds`
 * list tracks only the providers the user has chosen to hide. There is no
 * migration path — older state keys are simply ignored, so everyone starts with
 * all providers visible and can hide the ones they don't want.
 */
export async function getHiddenDiscoveryProviderIds(): Promise<string[]> {
    return readHiddenDiscoveryProviderIds();
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
