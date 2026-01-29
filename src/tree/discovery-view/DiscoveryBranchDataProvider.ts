/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { DiscoveryService } from '../../services/discoveryServices';
import { BaseExtendedTreeDataProvider } from '../BaseExtendedTreeDataProvider';
import { type TreeElement } from '../TreeElement';
import { isTreeElementWithContextValue } from '../TreeElementWithContextValue';
import { isTreeElementWithRetryChildren } from '../TreeElementWithRetryChildren';

/**
 * Tree data provider for the Discovery view.
 *
 * This provider manages the display of database discovery mechanisms from registered providers.
 * It presents a hierarchical view of discovery sources like Azure resources, local deployments,
 * and other database instances.
 *
 * ## TreeParentCache Integration
 *
 * While this provider maintains its own complex caching for in-flight promises and root items,
 * it leverages TreeParentCache specifically for parent-child relationship management:
 *
 * 1. registerNode is used when creating root items (discovery providers)
 * 2. registerRelationship is used when wrapping child elements with state handling
 * 3. getParent implementation delegates to the cache for efficient parent lookup
 * 4. findNodeById uses the cache with a custom getChildrenFunc for deep searches
 *
 * This separation of concerns allows the provider to focus on discovery-specific logic while
 * delegating parent-child relationship tracking to the specialized cache.
 *
 * ## Performance Optimizations
 *
 * The combination of TreeParentCache with this provider's existing caching mechanisms
 * (getChildrenPromises) provides efficient tree operations even for slow-loading discovery
 * sources that may involve network requests.
 */
export class DiscoveryBranchDataProvider extends BaseExtendedTreeDataProvider<TreeElement> {
    /**
     * Tracks the current root items in the tree.
     *
     * Why is this needed?
     * We need to be able to attach a certain `contextValue` to root items so that context menus can be shown correctly.
     * This WeakSet allows us to efficiently check if a given element is a root item when building its TreeItem.
     * This was the easiest way to achieve this without modifying the tree item structure itself.
     */
    private currentRootItems: WeakSet<TreeElement>;

    /**
     * Tracks in-flight promises for getChildren calls.
     *
     * Why is this needed?
     * Discovery branch providers can take a long time to load their children (e.g., network calls).
     * To avoid issuing multiple concurrent calls for the same element while a previous call is still executing,
     * we store the in-flight promise here. If another request comes in for the same element, we return the same promise.
     * This avoids duplicate work and ensures only one request is in progress per element at a time.
     */
    private getChildrenPromises = new Map<TreeElement, Promise<TreeElement[] | null | undefined>>();

    constructor() {
        super();
    }

    async getChildren(element: TreeElement): Promise<TreeElement[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.DiscoveryView;

            if (!element) {
                context.telemetry.properties.parentNodeContext = 'root';
                const rootItems = await this.getRootItems();

                context.telemetry.measurements.activeDiscoveryProviders = rootItems?.length ?? 0;

                return rootItems;
            }

            context.telemetry.properties.parentNodeContext = (await element.getTreeItem()).contextValue;
            return this.getElementChildren(context, element);
        });
    }

    /**
     * Helper to get root items for the tree.
     * Root items here are all the regiestered and enabled discovery providers.
     */

    private async getRootItems(): Promise<TreeElement[] | null | undefined> {
        // Reset the set of root items
        this.currentRootItems = new WeakSet<TreeElement>();

        // Clear the parent cache when retrieving root items
        this.clearParentCache();

        await this.renameLegacyProviders();
        await this.addDiscoveryProviderPromotionIfNeeded('azure-mongo-ru-discovery');

        // Get the list of active discovery provider IDs from global state
        const activeDiscoveryProviderIds = ext.context.globalState.get<string[]>('activeDiscoveryProviderIds', []);

        const rootItems: TreeElement[] = [];

        // Iterate through all registered discovery providers
        for (const { id } of DiscoveryService.listProviders()) {
            // Only include providers that are currently activated
            if (!activeDiscoveryProviderIds.includes(id)) {
                continue;
            }

            // Retrieve the provider instance
            const discoveryProvider = DiscoveryService.getProvider(id);

            if (!discoveryProvider) {
                throw new Error(`Discovery provider with id ${id} not found`);
            }

            // Get the root item for this provider
            const rootItem = discoveryProvider.getDiscoveryTreeRootItem(Views.DiscoveryView);

            if (isTreeElementWithContextValue(rootItem)) {
                this.appendContextValues(rootItem, Views.DiscoveryView, 'rootItem');
            }

            // Wrap the root item with state handling for refresh support
            const wrappedInStateHandling = ext.state.wrapItemInStateHandling(rootItem, () =>
                this.refresh(rootItem),
            ) as TreeElement;

            // Track this as a root item for context menu support (see getTreeItem)
            this.currentRootItems.add(wrappedInStateHandling);

            // Register root item in the parent cache
            if (wrappedInStateHandling.id) {
                this.registerNodeInCache(wrappedInStateHandling);
            }

            rootItems.push(wrappedInStateHandling);
        }

        // If there are no root items, return null to indicate an empty tree
        if (rootItems.length === 0) {
            return null;
        }

        // Sort root items by their id for consistent ordering
        return rootItems.sort((a, b) => a.id?.localeCompare(b.id ?? '') ?? 0);
    }

    /**
     * Helper to get children for a given element.
     */
    private async getElementChildren(
        context: IActionContext,
        element: TreeElement,
    ): Promise<TreeElement[] | null | undefined> {
        // If the element can provide children
        if (element.getChildren) {
            // Avoid duplicate concurrent calls for the same element by caching in-flight promises
            if (this.getChildrenPromises.has(element)) {
                return this.getChildrenPromises.get(element);
            }

            // 1. Check if we have a cached error for this element
            //
            // This prevents repeated attempts to fetch children for nodes that have previously failed
            // (e.g., due to invalid credentials or connection issues).
            if (element.id && this.failedChildrenCache.has(element.id)) {
                context.telemetry.properties.usedCachedErrorNode = 'true';
                return this.failedChildrenCache.get(element.id);
            }

            // Start fetching children
            const promise = (async () => {
                // 2. Fetch the children of the current element
                const children = await element.getChildren!();
                context.telemetry.measurements.childrenCount = children?.length ?? 0;

                if (!children) {
                    return [];
                }

                // 3. Check if the returned children contain an error node
                // This means the operation failed (eg. authentication)
                if (isTreeElementWithRetryChildren(element) && element.hasRetryNode(children)) {
                    // Store the error node(s) in our cache for future refreshes
                    this.failedChildrenCache.set(element.id, children ?? []);
                    context.telemetry.properties.cachedErrorNode = 'true';
                }

                // Wrap each child with state handling for refresh support
                return children.map((child) => {
                    if (isTreeElementWithContextValue(child)) {
                        this.appendContextValues(child, Views.DiscoveryView);
                    }

                    const wrappedChild = ext.state.wrapItemInStateHandling(child, () =>
                        this.refresh(child),
                    ) as TreeElement;

                    // Register parent-child relationship in the cache
                    // Note: The check for `typeof wrappedChild.id === 'string'` is necessary because `wrapItemInStateHandling`
                    // can process temporary nodes that don't have an `id` property, which would otherwise cause a runtime error.
                    if (element.id && typeof wrappedChild.id === 'string') {
                        this.registerRelationshipInCache(element, wrappedChild);
                    }

                    return wrappedChild;
                }) as TreeElement[];
            })();

            // Store the in-flight promise
            this.getChildrenPromises.set(element, promise);

            try {
                // Await and return the result
                return await promise;
            } finally {
                // Clean up the promise cache
                this.getChildrenPromises.delete(element);
            }
        }

        // If the element does not have children, return null
        return null;
    }

    /**
     * Adds a discovery provider promotion if the user has already explored discovery.
     * This method is public only for testing purposes.
     *
     * Logic:
     * - If promotion already shown: skip
     * - If user has NO active providers: skip (they never used discovery OR removed all)
     * - If provider doesn't exist: skip
     * - If user has active providers: add this provider to promote it to existing users
     */
    public async addDiscoveryProviderPromotionIfNeeded(providerId: string): Promise<void> {
        const promotionFlagKey = `discoveryProviderPromotionProcessed:${providerId}`;
        const promotionProcessed = ext.context.globalState.get<boolean>(promotionFlagKey, false);

        if (promotionProcessed) {
            // Already shown/processed previously — do nothing.
            return;
        }

        // Read current active provider IDs
        const activeProviderIds = ext.context.globalState.get<string[]>('activeDiscoveryProviderIds', []);

        // If there are no active discovery providers, mark the promotion as shown
        // and return early. The goal is to only show the promotion to users who have
        // already added discovery providers (indicating they've explored the feature).
        // We can't distinguish between new users and users who removed all providers,
        // so we err on the side of not promoting to avoid cluttering the UI for new users.
        if (!activeProviderIds || activeProviderIds.length === 0) {
            try {
                await ext.context.globalState.update(promotionFlagKey, true);
            } catch {
                // ignore storage errors for this best-effort write
            }
            return;
        }

        // Only proceed if the provider is actually available
        const provider = DiscoveryService.getProvider(providerId);
        if (!provider) {
            // Provider not registered with DiscoveryService; skip for now.
            return;
        }

        // If not present, register it
        if (!activeProviderIds.includes(providerId)) {
            const updated = [...activeProviderIds, providerId];
            try {
                await ext.context.globalState.update('activeDiscoveryProviderIds', updated);
            } catch (error) {
                console.error(`Failed to update activeDiscoveryProviderIds: ${(error as Error).message}`);
            }
        }

        // Mark that we've added/shown the promotion for this provider so we don't repeat it
        try {
            await ext.context.globalState.update(promotionFlagKey, true);
        } catch {
            // ignore
        }
    }

    private async renameLegacyProviders(): Promise<void> {
        try {
            const activeProviderIds = ext.context.globalState.get<string[]>('activeDiscoveryProviderIds', []);
            if (activeProviderIds.includes('azure-discovery')) {
                {
                    const updated = ext.context.globalState
                        .get<string[]>('activeDiscoveryProviderIds', [])
                        .filter((id) => id !== 'azure-discovery');
                    updated.push('azure-mongo-vcore-discovery');
                    await ext.context.globalState.update('activeDiscoveryProviderIds', updated);
                }
            }
        } catch {
            // ignore storage errors for this best-effort write
        }
    }

    /**
     * Finds a collection node by its cluster's stable identifier.
     *
     * For Discovery View, the collection's full ID is:
     *   `${parentPath}/${clusterId}/${databaseName}/${collectionName}`
     *
     * Since clusterId is sanitized (no '/'), we can identify the collection by searching
     * for a node whose ID ends with `/${clusterId}/${databaseName}/${collectionName}`.
     *
     * This method traverses the tree from root, expanding nodes as needed. The tree's
     * hierarchical structure ensures efficient traversal.
     *
     * ## Performance Optimization
     *
     * To avoid unnecessarily loading all discovery providers, this method first queries
     * `DiscoveryService.findProviderForClusterId()` to determine which provider "owns"
     * this clusterId. Each provider implements `ownsClusterId()` to check if the clusterId
     * matches its resource patterns (e.g., `_mongoClusters_` for vCore, `_databaseAccounts_`
     * for RU). If a matching provider is found, only that branch is searched.
     *
     * This prevents triggering network calls and authentication to all providers when we can
     * determine the correct one from the cluster's resource pattern.
     *
     * @param clusterId The stable cluster identifier (sanitized, no '/' characters)
     * @param databaseName The database name
     * @param collectionName The collection name
     * @returns A Promise that resolves to the found CollectionItem or undefined if not found
     */
    async findCollectionByClusterId(
        clusterId: string,
        databaseName: string,
        collectionName: string,
    ): Promise<TreeElement | undefined> {
        // The collection's ID ends with this suffix (clusterId has no '/' so this is unique)
        const targetSuffix = `/${clusterId}/${databaseName}/${collectionName}`;

        // Recursive search helper that expands the tree
        const searchInNode = async (node: TreeElement): Promise<TreeElement | undefined> => {
            // Check if this node matches
            if (node.id?.endsWith(targetSuffix)) {
                return node;
            }

            // Get children and search recursively
            const children = await this.getChildren(node);
            if (children) {
                for (const child of children) {
                    const result = await searchInNode(child);
                    if (result) {
                        return result;
                    }
                }
            }
            return undefined;
        };

        // Get root items (discovery providers)
        const rootItems = await this.getChildren(undefined as unknown as TreeElement);
        if (!rootItems) {
            return undefined;
        }

        // Ask the DiscoveryService which provider owns this clusterId
        // Each provider implements ownsClusterId() to check if the clusterId matches its patterns
        const targetProvider = DiscoveryService.findProviderForClusterId(clusterId);

        if (targetProvider) {
            // Search only in the targeted provider branch
            const targetRoot = rootItems.find((item) => item.id?.includes(targetProvider.id));
            if (targetRoot) {
                ext.outputChannel.trace(
                    `[DiscoveryView] findCollectionByClusterId: Targeting provider "${targetProvider.id}" for clusterId="${clusterId}"`,
                );
                const result = await searchInNode(targetRoot);
                if (result) {
                    return result;
                }
            }
        }

        // Fallback: search all providers if targeted search failed or couldn't determine provider
        ext.outputChannel.trace(
            `[DiscoveryView] findCollectionByClusterId: Searching all providers for clusterId="${clusterId}"`,
        );
        for (const rootItem of rootItems) {
            const result = await searchInNode(rootItem);
            if (result) {
                return result;
            }
        }

        return undefined;
    }
}
