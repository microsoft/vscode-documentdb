/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type WorkspaceResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { ext } from '../extensionVariables';

/**
 * Represents a generic item stored in the storage.
 * Each item has a unique `id`, a `name`, an optional `version`, optional `properties`, and optional `secrets`.
 * The `id` of the item is used as the key in storage and must be unique per storage location.
 *
 * @template T The type of the `properties` object. Defaults to a flexible record.
 */
export type StorageItem<T extends Record<string, unknown> = Record<string, unknown>> = {
    /**
     * Unique identifier for the item.
     */
    id: string;

    /**
     * Name of the item.
     */
    name: string;

    /**
     * Optional version string for the item's schema.
     */
    version?: string;

    /**
     * Optional properties associated with the item, conforming to the generic type `T`.
     */
    properties?: T;

    /**
     * Optional array of secrets associated with the item.
     * Secrets are stored securely using VSCode's SecretStorage API.
     */
    secrets?: string[];
};

/**
 * Storage is organized by workspace (acting as a "directory") and items are identified by their unique IDs.
 * Each item can have properties and optional secrets that are stored securely.
 * This interface is generic to support type-safe storage of different item structures.
 */
export interface Storage {
    /**
     * Retrieves all items from the storage along with their secrets for a specific workspace.
     * Items are stored using their `id` as a key within the workspace.
     *
     * @template T The expected type of the `properties` object for the items.
     * @param workspace - The workspace identifier acting as a directory for the items.
     *                    Can be a WorkspaceResourceType or any string value.
     * @returns A promise resolving to an array of storage items with their secrets loaded.
     */
    getItems<T extends Record<string, unknown>>(workspace: WorkspaceResourceType): Promise<StorageItem<T>[]>;

    /**
     * Retrieves a specific item from the storage along with its secrets for a given workspace.
     * The item is identified by its unique `id` within the workspace.
     *
     * @template T The expected type of the `properties` object for the item.
     * @param workspace - The workspace identifier acting as a directory for the items.
     *                    Can be a WorkspaceResourceType or any string value.
     * @param storageId - The unique `id` of the item to retrieve.
     * @returns A promise resolving to the storage item with its secrets loaded, or `undefined` if not found.
     */
    getItem<T extends Record<string, unknown>>(
        workspace: WorkspaceResourceType,
        storageId: string,
    ): Promise<StorageItem<T> | undefined>;

    /**
     * Stores an item and its secrets into storage for a specific workspace.
     * The item's `id` is used as the key and must be unique within the workspace.
     * Item properties are stored in globalState while secrets are stored securely
     * using VSCode's SecretStorage API.
     *
     * @template T The type of the `properties` object for the item.
     * @param workspace - The workspace identifier acting as a directory for the items.
     *                    Can be a WorkspaceResourceType or any string value.
     * @param item - The item to store, containing id, name, and optional properties and secrets.
     * @param overwrite - If `false` and an item with the same `id` exists, an error is thrown.
     *                    Defaults to `true`.
     * @returns A promise that resolves when the item has been stored.
     * @throws Error if `overwrite` is `false` and an item with the same `id` exists.
     */
    push<T extends Record<string, unknown>>(
        workspace: WorkspaceResourceType,
        item: StorageItem<T>,
        overwrite?: boolean,
    ): Promise<void>;

    /**
     * Deletes an item and its associated secrets from storage for a specific workspace.
     * Both the item data and any associated secrets are removed.
     *
     * @param workspace - The workspace identifier acting as a directory for the items.
     *                    Can be a WorkspaceResourceType or any string value.
     * @param itemId - The `id` of the item to delete.
     * @returns A promise that resolves when the item has been deleted.
     */
    delete(workspace: WorkspaceResourceType, itemId: string): Promise<void>;

    /**
     * Retrieves all item `id`s stored for a specific workspace.
     * This provides a list of all item identifiers without loading the full items.
     *
     * @param workspace - The workspace identifier acting as a directory for the items.
     *                    Can be a WorkspaceResourceType or any string value.
     * @returns An array of item `id`s stored in the specified workspace.
     */
    keys(workspace: WorkspaceResourceType): string[];
}

/**
 * Private implementation of Storage interface that manages items and their
 * associated secrets in VSCode's storage mechanisms.
 *
 * Items are stored in VSCode's globalState, and secrets are stored using SecretStorage.
 * Each item is uniquely identified by its `id` within a given workspace.
 *
 * This class cannot be instantiated directly - use StorageService.get() instead.
 */
class StorageImpl implements Storage {
    private readonly storageName: string;

    /**
     * Short-lived, per-workspace cache for `getItems` results.
     *
     * During extension activation several independent consumers (tree providers, post-migration
     * cleanup, the URI handler, …) each call `getItems` for the same workspace within a short
     * window. Every call fans out one secret-storage round trip per item, which under Remote-WSL
     * crosses the WSL2 <-> Windows boundary and is latency-dominated. Without coalescing, the same
     * zone is re-read several times back-to-back, stretching the launch read-path over seconds.
     *
     * Each entry holds the in-flight (or already-resolved) read promise plus the time it was
     * created. While an entry is in flight, concurrent callers share it (request coalescing); once
     * resolved, callers within {@link GET_ITEMS_CACHE_TTL_MS} reuse the snapshot instead of issuing
     * a fresh read. Writes (`push`/`delete`) invalidate the affected workspace immediately, so the
     * cache never serves data that is stale with respect to a local mutation. The TTL is only a
     * safety backstop that bounds how long any untracked external change could go unseen.
     */
    private readonly getItemsCache = new Map<
        string,
        { promise: Promise<StorageItem<Record<string, unknown>>[]>; timestamp: number }
    >();

    /**
     * How long a resolved `getItems` snapshot remains reusable. Chosen to comfortably cover the
     * activation read-storm while remaining short enough that a manual refresh shortly afterwards
     * re-reads storage. Local writes invalidate the cache regardless of this value.
     */
    private static readonly GET_ITEMS_CACHE_TTL_MS = 10_000;

    constructor(storageName: string) {
        this.storageName = storageName;

        // Cross-window/cross-extension SecretStorage mutations bypass our local push/delete cache
        // invalidation. Subscribe to onDidChange so a second VS Code window editing the same
        // profile (or anything else writing through SecretStorage) does not leave this window
        // serving a stale snapshot for up to TTL. We only invalidate when the changed key
        // belongs to this storage namespace; unrelated secret churn is ignored.
        ext.context.subscriptions.push(
            ext.secretStorage.onDidChange((event) => {
                const prefix = `${this.storageName}/`;
                if (!event.key.startsWith(prefix)) {
                    return;
                }
                // Key shape: `${storageName}/${workspace}/${id}/secrets`.
                // Extract the workspace segment and invalidate only that entry.
                const rest = event.key.substring(prefix.length);
                const slashIdx = rest.indexOf('/');
                if (slashIdx === -1) {
                    return;
                }
                const workspace = rest.substring(0, slashIdx);
                this.getItemsCache.delete(workspace);
            }),
        );
    }

    /**
     * Implementation of Storage.getItems that retrieves all items along with their secrets.
     *
     * Results are coalesced and briefly cached per workspace — see {@link getItemsCache} for the
     * rationale. Callers always receive a defensive copy of the cached snapshot so they cannot
     * mutate state shared with other concurrent consumers.
     */
    public async getItems<T extends Record<string, unknown>>(workspace: string): Promise<StorageItem<T>[]> {
        const items = await this.getOrLoadItems<T>(workspace);

        // Hand back a shallow copy (including a copied secrets array) so that callers sharing the
        // cached snapshot cannot affect one another by mutating the returned items.
        return items.map((item) => ({
            ...item,
            secrets: item.secrets ? [...item.secrets] : item.secrets,
        }));
    }

    /**
     * Returns the cached `getItems` promise for the workspace when it is still fresh, otherwise
     * starts a new read and caches it. A rejected read is evicted so the next call retries instead
     * of replaying the failure.
     */
    private getOrLoadItems<T extends Record<string, unknown>>(workspace: string): Promise<StorageItem<T>[]> {
        const cached = this.getItemsCache.get(workspace);
        if (cached && Date.now() - cached.timestamp < StorageImpl.GET_ITEMS_CACHE_TTL_MS) {
            return cached.promise as unknown as Promise<StorageItem<T>[]>;
        }

        const promise = this.loadItemsFromStorage<T>(workspace);
        const entry = {
            promise: promise as unknown as Promise<StorageItem<Record<string, unknown>>[]>,
            timestamp: Date.now(),
        };
        this.getItemsCache.set(workspace, entry);

        // Evict failed reads so we don't keep serving (or awaiting) a rejected promise.
        void promise.catch(() => {
            if (this.getItemsCache.get(workspace) === entry) {
                this.getItemsCache.delete(workspace);
            }
        });

        return promise;
    }

    /**
     * Reads all items and their secrets directly from storage, bypassing the cache.
     *
     * Secret reads are issued concurrently via `Promise.all`. Each `ext.secretStorage.get` is a
     * round trip to the main process (and, under Remote-WSL, across the WSL2 <-> Windows boundary),
     * so the per-item cost is dominated by latency rather than CPU. Awaiting them one-by-one in a
     * loop paid that latency N times sequentially; dispatching them together pipelines the round
     * trips so the total wait is roughly one round trip instead of N. VS Code serializes secret
     * access per-key (not globally) and caches the decrypted store in memory after the first read,
     * so distinct item keys do not block each other.
     */
    private async loadItemsFromStorage<T extends Record<string, unknown>>(
        workspace: string,
    ): Promise<StorageItem<T>[]> {
        const storageKeyPrefix = `${this.storageName}/${workspace}/`;
        const keys = ext.context.globalState.keys().filter((key) => key.startsWith(storageKeyPrefix));

        // Read each item's metadata from globalState (synchronous, in-memory) and keep only those
        // that exist, so secret reads line up 1:1 with the resolved items below.
        const itemsWithKeys = keys
            .map((key) => ({ key, item: ext.context.globalState.get<StorageItem<T>>(key) }))
            .filter((entry): entry is { key: string; item: StorageItem<T> } => entry.item !== undefined);

        // Issue all secret reads concurrently — see the method doc comment for why this matters.
        const secretsJsonList = await Promise.all(
            itemsWithKeys.map(({ key }) => ext.secretStorage.get(`${key}/secrets`)),
        );

        const items: StorageItem<T>[] = [];
        for (let i = 0; i < itemsWithKeys.length; i++) {
            const { key, item } = itemsWithKeys[i];

            // ensure that the real id is used, same as the one used in the storage
            item.id = key.substring(storageKeyPrefix.length);

            let secrets: string[] = [];
            const secretsJson = secretsJsonList[i];
            if (secretsJson) {
                try {
                    secrets = JSON.parse(secretsJson) as string[];
                } catch (error) {
                    console.error(l10n.t('Failed to parse secrets for key {0}:', key), error);
                    secrets = [];
                }
            }

            item.secrets = secrets;
            items.push(item);
        }

        return items;
    }

    /**
     * Implementation of Storage.getItem that retrieves a specific item along with its secrets.
     */
    public async getItem<T extends Record<string, unknown>>(
        workspace: string,
        storageId: string,
    ): Promise<StorageItem<T> | undefined> {
        const storageKey = `${this.storageName}/${workspace}/${storageId}`;
        const item = ext.context.globalState.get<StorageItem<T>>(storageKey);

        if (!item) {
            return undefined; // Item not found
        }

        // Read secrets associated with the item
        const secretKey = `${storageKey}/secrets`;
        const secretsJson = await ext.secretStorage.get(secretKey);

        let secrets: string[] = [];
        if (secretsJson) {
            try {
                secrets = JSON.parse(secretsJson) as string[];
            } catch (error) {
                console.error(l10n.t('Failed to parse secrets for key {0}:', storageKey), error);
                secrets = [];
            }
        }

        // Return the item with its secrets
        return { ...item, id: storageId, secrets };
    }

    /**
     * Implementation of Storage.push that stores an item and its secrets.
     */
    public async push<T extends Record<string, unknown>>(
        workspace: string,
        item: StorageItem<T>,
        overwrite: boolean = true,
    ): Promise<void> {
        const storageKey = `${this.storageName}/${workspace}/${item.id}`;

        // Check for existing item
        const existingItem = ext.context.globalState.get<StorageItem<T>>(storageKey);
        if (existingItem && !overwrite) {
            throw new Error(l10n.t('An item with id "{0}" already exists for workspace "{1}".', item.id, workspace));
        }

        // Save all secrets
        if (item.secrets && item.secrets.length > 0) {
            const secretKey = `${storageKey}/secrets`;
            const secretsJson = JSON.stringify(item.secrets);
            try {
                await ext.secretStorage.store(secretKey, secretsJson);
            } catch (error) {
                console.error(l10n.t('Failed to store secrets for key {0}:', secretKey), error);
                throw error;
            }
        }

        // Remove secrets from the item before storing in globalState
        const itemToStore = { ...item };
        delete itemToStore.secrets;

        // Save the item in globalState
        await ext.context.globalState.update(storageKey, itemToStore);

        // A mutation occurred: drop the cached snapshot so subsequent reads reflect this write.
        this.getItemsCache.delete(workspace);
    }

    /**
     * Implementation of Storage.delete that removes an item and its associated secrets.
     * Attempts to maintain atomicity by ensuring both the item and its secrets are deleted.
     *
     * @param workspace - The workspace identifier acting as a directory for the items.
     * @param itemId - The `id` of the item to delete.
     * @throws Error if deletion of the item or its secrets fails.
     */
    public async delete(workspace: string, itemId: string): Promise<void> {
        const storageKey = `${this.storageName}/${workspace}/${itemId}`;
        const secretKey = `${storageKey}/secrets`;

        // First check if the item exists
        const existingItem = ext.context.globalState.get<StorageItem>(storageKey);
        if (!existingItem) {
            return; // Item doesn't exist, nothing to delete
        }

        try {
            // First delete the item from globalState
            await ext.context.globalState.update(storageKey, undefined);

            // The stored set changed: invalidate the cached snapshot so reads re-resolve from truth.
            // (If secret deletion below fails and we restore the item, the next read still sees the
            // correct state because the cache has already been dropped.)
            this.getItemsCache.delete(workspace);

            try {
                // Then delete its secrets
                await ext.secretStorage.delete(secretKey);
            } catch (secretError) {
                // Try to restore the item since secret deletion failed
                try {
                    await ext.context.globalState.update(storageKey, existingItem);
                } catch {
                    // If restoration fails, we're in an inconsistent state, but we can't do much now. Throw the original error.
                }
                throw new Error(l10n.t('Failed to delete secrets for item "{0}".', itemId), { cause: secretError });
            }
        } catch (itemError) {
            if (itemError instanceof Error) {
                throw itemError; // Rethrow errors
            }
            throw new Error(l10n.t('Failed to delete item "{0}".', itemId));
        }
    }

    /**
     * Implementation of Storage.keys that lists all item IDs in a workspace.
     */
    public keys(workspace: string): string[] {
        const storageKeyPrefix = `${this.storageName}/${workspace}/`;
        const keys = ext.context.globalState
            .keys()
            .filter((key) => key.startsWith(storageKeyPrefix))
            .map((key) => key.substring(storageKeyPrefix.length));

        return keys;
    }
}

/**
 * A helper enum for common storage names used in StorageService.get().
 *
 * This enum provides a set of predefined constants that you can use instead of literal strings.
 * Using these constants helps prevent typos and saves time when specifying storage names.
 * For example, you can call StorageService.get(StorageNames.Workspace) to retrieve the workspace-specific storage.
 */
export enum StorageNames {
    Connections = 'connections',
    Default = 'default',
    Global = 'global',
    Workspace = 'workspace',
}

/**
 * Service for accessing and managing storage instances with different storage names.
 * Maintains a singleton pattern for each unique storage name to prevent duplication.
 *
 * This is the only public entry point for obtaining Storage instances.
 */
export class StorageService {
    private static instances: Map<string, Storage> = new Map();

    /**
     * Gets or creates a storage instance for the specified storage name.
     * If no name is provided, defaults to the default storage for the extension.
     * The name will be derived from the extension ID and the provided storage name.
     *
     * Storage instances are cached for reuse to maintain consistency.
     *
     * @param storageName - The name of the storage location. Optional.
     * @returns A Storage instance configured for the given storage name.
     */
    public static get(storageName?: string): Storage {
        const name = [ext.context.extension.id, storageName ?? 'default'].join('.');

        if (!this.instances.has(name)) {
            this.instances.set(name, new StorageImpl(name));
        }

        return this.instances.get(name)!;
    }
}
