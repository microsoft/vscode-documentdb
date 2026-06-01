/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../extensionVariables';
import { DiscoveryService, type ProviderDescription } from './discoveryServices';

const HIDDEN_DISCOVERY_PROVIDER_IDS_KEY = 'hiddenDiscoveryProviderIds';
const LEGACY_ACTIVE_DISCOVERY_PROVIDER_IDS_KEY = 'activeDiscoveryProviderIds';
const LEGACY_AZURE_PROVIDER_ID = 'azure-discovery';
const CURRENT_AZURE_PROVIDER_ID = 'azure-mongo-vcore-discovery';

let migrationPromise: Promise<void> | undefined;
let hiddenProviderIdsCache: string[] | undefined;

export async function ensureDiscoveryProviderVisibilityMigrated(): Promise<void> {
    if (!migrationPromise) {
        migrationPromise = migrateDiscoveryProviderVisibility();
    }

    await migrationPromise;
}

export async function getHiddenDiscoveryProviderIds(): Promise<string[]> {
    await ensureDiscoveryProviderVisibilityMigrated();
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

export function resetDiscoveryProviderVisibilityMigrationForTests(): void {
    migrationPromise = undefined;
    hiddenProviderIdsCache = undefined;
}

async function migrateDiscoveryProviderVisibility(): Promise<void> {
    const existingHiddenProviderIds = ext.context.globalState.get<string[]>(HIDDEN_DISCOVERY_PROVIDER_IDS_KEY);

    if (Array.isArray(existingHiddenProviderIds)) {
        hiddenProviderIdsCache = normalizeProviderIds(existingHiddenProviderIds);
        return;
    }

    const legacyActiveProviderIds = ext.context.globalState.get<string[]>(LEGACY_ACTIVE_DISCOVERY_PROVIDER_IDS_KEY);
    if (Array.isArray(legacyActiveProviderIds)) {
        const activeProviderIds = new Set(legacyActiveProviderIds.map(normalizeProviderId));
        const hiddenProviderIds = DiscoveryService.listProviders()
            .map((provider) => provider.id)
            .filter((id) => !activeProviderIds.has(id));

        await tryWriteHiddenDiscoveryProviderIds(hiddenProviderIds);
        return;
    }

    await tryWriteHiddenDiscoveryProviderIds([]);
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

async function tryWriteHiddenDiscoveryProviderIds(providerIds: readonly string[]): Promise<void> {
    try {
        await writeHiddenDiscoveryProviderIds(providerIds);
    } catch (error) {
        hiddenProviderIdsCache = normalizeProviderIds(providerIds);
        const message = error instanceof Error ? error.message : String(error);
        ext.outputChannel.warn(`[DiscoveryProviderVisibility] Failed to migrate discovery visibility: ${message}`);
    }
}

/**
 * Deduplicates and renames legacy ids without dropping unknown providers.
 * Use this for storage round-trips so that hide preferences for plugins that
 * aren't currently registered (timing-dependent activation, future builds)
 * survive read/write cycles.
 */
function normalizeProviderIds(providerIds: readonly string[]): string[] {
    return Array.from(
        new Set(
            providerIds.filter((id): id is string => typeof id === 'string' && id.length > 0).map(normalizeProviderId),
        ),
    );
}

function normalizeProviderId(providerId: string): string {
    return providerId === LEGACY_AZURE_PROVIDER_ID ? CURRENT_AZURE_PROVIDER_ID : providerId;
}
