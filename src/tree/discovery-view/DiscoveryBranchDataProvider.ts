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
    // eslint-disable-next-line @typescript-eslint/require-await
    private async getRootItems(): Promise<TreeElement[] | null | undefined> {
        // Reset the set of root items
        this.currentRootItems = new WeakSet<TreeElement>();

        // Clear the parent cache when retrieving root items
        this.parentCache.clear();

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
                this.parentCache.registerNode(wrappedInStateHandling);
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
                        this.parentCache.registerRelationship(element, wrappedChild);
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
}
