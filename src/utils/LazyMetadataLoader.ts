/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';

import { CaseInsensitiveMap } from './CaseInsensitiveMap';

/**
 * Configuration interface for the LazyMetadataLoader.
 *
 * @template TMetadata The type of metadata being cached (e.g., ClusterModel)
 * @template TItem The type of resource items that will be updated (e.g., RUResourceItem, VCoreResourceItem)
 */
export interface LazyMetadataLoaderConfig<TMetadata, TItem> {
    /** Duration in milliseconds for how long the cache should remain valid */
    readonly cacheDuration: number;

    /**
     * Function to load metadata from the Azure API.
     * Should return a Map where keys are resource IDs and values are metadata objects.
     */
    readonly loadMetadata: (
        subscription: AzureSubscription,
        context: IActionContext,
    ) => Promise<Map<string, TMetadata>>;

    /**
     * Function to update a resource item with new metadata.
     * This is called when the cache is refreshed and items need to be updated.
     */
    readonly updateItem: (item: TItem, metadata: TMetadata | undefined) => void;

    /**
     * Callback function to refresh the item in the tree view.
     * This is typically the refresh method from the tree data provider.
     */
    readonly refreshCallback: (item: TItem) => void;
}

/**
 * LazyMetadataLoader is a helper class that manages lazy loading of detailed metadata for Azure resources.
 *
 * ## Purpose
 * This class exists to address a common pattern in tree data providers where:
 * 1. Initial resource information comes from the Azure Resources extension (basic info only)
 * 2. Detailed metadata needs to be loaded separately using dedicated Azure SDK clients
 * 3. Resource items need to be updated once the detailed metadata becomes available
 * 4. Cache needs to be managed with proper expiration and cleanup
 *
 * ## The Problem It Solves
 * Without this helper, each BranchDataProvider would need to implement:
 * - A flag to track if cache update has been requested
 * - A cache to store the detailed metadata
 * - A map to track items that need updating after cache refresh
 * - Cache expiration logic with setTimeout
 * - Coordination between cache loading and item updates
 *
 * ## How It Works
 * 1. Caller checks `needsCacheUpdate` to determine if background loading should be triggered
 * 2. Resource items are registered via `addItemForRefresh()` to be updated when metadata loads
 * 3. When `loadCacheAndRefreshItems()` completes, all registered items are updated and refreshed
 * 4. Cache automatically expires after the configured duration
 *
 * ## Usage Example
 * ```typescript
 * private readonly metadataLoader = new LazyMetadataLoader<ClusterModel, RUResourceItem>({
 *   cacheDuration: 5 * 60 * 1000, // 5 minutes
 *   loadMetadata: async (subscription, context) => {
 *     const client = await createCosmosDBManagementClient(context, subscription);
 *     const accounts = await client.databaseAccounts.list();
 *     const cache = new CaseInsensitiveMap<ClusterModel>();
 *     accounts.forEach(account => cache.set(account.id!, transformToClusterModel(account)));
 *     return cache;
 *   },
 *   updateItem: (item, metadata) => {
 *     item.cluster = { ...item.cluster, ...metadata };
 *   },
 *   refreshCallback: (item) => this.refresh(item),
 * });
 *
 * // In getResourceItem():
 * if (this.metadataLoader.needsCacheUpdate) {
 *   void this.metadataLoader.loadCacheAndRefreshItems(resource.subscription, context);
 * }
 * const metadata = this.metadataLoader.getCachedMetadata(resource.id);
 * const item = new RUResourceItem(subscription, { ...resource, ...metadata });
 * this.metadataLoader.addItemForRefresh(resource.id, item);
 * ```
 *
 * @template TMetadata The type of metadata being cached
 * @template TItem The type of resource items that will be updated
 */
export class LazyMetadataLoader<TMetadata, TItem> {
    private readonly config: LazyMetadataLoaderConfig<TMetadata, TItem>;

    /** Flag to track if cache update is needed */
    private cacheUpdateNeeded = true;

    /**
     * Cache for storing detailed metadata.
     * Uses CaseInsensitiveMap to handle Azure resource ID casing inconsistencies.
     */
    private readonly metadataCache = new CaseInsensitiveMap<TMetadata>();

    /**
     * Map of items that need to be refreshed when cache loading completes.
     * Uses CaseInsensitiveMap to handle Azure resource ID casing inconsistencies.
     */
    private readonly itemsToRefresh = new CaseInsensitiveMap<TItem>();

    /** Timer ID for cache expiration */
    private cacheExpirationTimer: NodeJS.Timeout | undefined;

    constructor(config: LazyMetadataLoaderConfig<TMetadata, TItem>) {
        this.config = config;
    }

    /**
     * Gets cached metadata for a resource.
     * Returns undefined if metadata is not yet available in cache.
     *
     * @param resourceId The Azure resource ID
     * @returns The cached metadata if available, undefined otherwise
     */
    getCachedMetadata(resourceId: string): TMetadata | undefined {
        return this.metadataCache.get(resourceId);
    }

    /**
     * Adds a resource item to be refreshed when the cache loading completes.
     * Items added here will have their metadata updated and UI refreshed once
     * the background cache loading finishes.
     *
     * @param resourceId The Azure resource ID
     * @param item The resource item that should be updated when metadata becomes available
     */
    addItemForRefresh(resourceId: string, item: TItem): void {
        this.itemsToRefresh.set(resourceId, item);
    }

    /**
     * Loads metadata from Azure and refreshes all registered items.
     * This method should be called by the BranchDataProvider when it has access to
     * subscription and context information.
     *
     * @param subscription The Azure subscription
     * @param context The action context for telemetry and error handling
     */
    async loadCacheAndRefreshItems(subscription: AzureSubscription, context: IActionContext): Promise<void> {
        try {
            // Mark cache update as no longer needed to prevent multiple concurrent loads
            this.cacheUpdateNeeded = false;

            // Load metadata using the provided function
            const newMetadata = await this.config.loadMetadata(subscription, context);

            // Update the cache
            this.metadataCache.clear();
            newMetadata.forEach((metadata, resourceId) => {
                this.metadataCache.set(resourceId, metadata);
            });

            // Update and refresh all registered items
            this.itemsToRefresh.forEach((item, resourceId) => {
                const metadata = this.metadataCache.get(resourceId);
                this.config.updateItem(item, metadata);
                this.config.refreshCallback(item);
            });

            // Clear the items to refresh map
            this.itemsToRefresh.clear();

            // Set up cache expiration
            this.setupCacheExpiration();
        } catch (error) {
            console.error('Failed to load metadata cache:', error);

            // ensure we don't attempt to refresh again.
            // This lazy metadata support is non-essential, so we can safely ignore errors and ignore the results.
            this.cacheUpdateNeeded = false;
            throw error;
        }
    }

    /**
     * Clears all cached data and resets the loader state.
     * Useful when subscription changes or manual cache invalidation is needed.
     */
    clearCache(): void {
        this.metadataCache.clear();
        this.itemsToRefresh.clear();
        this.cacheUpdateNeeded = true;

        if (this.cacheExpirationTimer) {
            clearTimeout(this.cacheExpirationTimer);
            this.cacheExpirationTimer = undefined;
        }
    }

    /**
     * Sets up automatic cache expiration using setTimeout.
     */
    private setupCacheExpiration(): void {
        // Clear any existing timer
        if (this.cacheExpirationTimer) {
            clearTimeout(this.cacheExpirationTimer);
        }

        // Set up new expiration timer
        this.cacheExpirationTimer = setTimeout(() => {
            this.metadataCache.clear();
            this.cacheUpdateNeeded = true;
            this.cacheExpirationTimer = undefined;
            console.debug('Metadata cache expired and cleared');
        }, this.config.cacheDuration);
    }

    /**
     * Checks if cache loading is needed.
     * Useful for conditional logic in the calling code.
     */
    get needsCacheUpdate(): boolean {
        return this.cacheUpdateNeeded;
    }

    /**
     * Gets the current size of the metadata cache.
     * Useful for debugging and telemetry.
     */
    get cacheSize(): number {
        return this.metadataCache.size;
    }

    /**
     * Disposes the loader and cleans up resources.
     * Should be called when the loader is no longer needed.
     */
    dispose(): void {
        this.clearCache();
    }
}
