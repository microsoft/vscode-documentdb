/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    createContextValue,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { DiscoveryService } from '../../services/discoveryServices';
import { type ExtendedTreeDataProvider } from '../ExtendedTreeDataProvider';
import { type TreeElement } from '../TreeElement';
import { isTreeElementWithContextValue, type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { isTreeElementWithRetryChildren } from '../TreeElementWithErrorCache';
import { TreeParentCache } from '../TreeParentCache';

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
export class DiscoveryBranchDataProvider extends vscode.Disposable implements ExtendedTreeDataProvider<TreeElement> {
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

    /**
     * Caches nodes whose getChildren() call has failed.
     *
     * This cache prevents repeated attempts to fetch children for nodes that have previously failed,
     * such as when a user enters invalid credentials. By storing the failed nodes, we avoid unnecessary
     * repeated calls until the error state is explicitly cleared.
     *
     * Key: Node ID (parent)
     * Value: Array of TreeElement representing the failed children (usually an error node)
     */
    private readonly errorNodeCache = new Map<string, TreeElement[]>();

    /**
     * Cache for tracking parent-child relationships to support the getParent method.
     */
    private readonly parentCache = new TreeParentCache<TreeElement>();

    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
        void | TreeElement | TreeElement[] | null | undefined
    >();

    /**
     * From vscode.TreeDataProvider<T>:
     *
     * An optional event to signal that an element or root has changed.
     * This will trigger the view to update the changed element/root and its children recursively (if shown).
     * To signal that root has changed, do not pass any argument or pass `undefined` or `null`.
     */
    get onDidChangeTreeData(): vscode.Event<void | TreeElement | TreeElement[] | null | undefined> {
        return this.onDidChangeTreeDataEmitter.event;
    }

    /**
     * Removes a node's error state from the failed node cache.
     * This allows the node to be refreshed and its children to be re-fetched on the next refresh call.
     * If not reset, the cached error children will always be returned for this node.
     * @param nodeId The ID of the node to clear from the failed node cache.
     */
    resetNodeErrorState(nodeId: string): void {
        this.errorNodeCache.delete(nodeId);
    }

    constructor() {
        super(() => {
            this.onDidChangeTreeDataEmitter.dispose();
        });
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

    appendContextValue(treeItem: TreeElementWithContextValue, contextValueToAppend: string): void {
        // all items returned from this view need that context value assigned
        const contextValues: string[] = [contextValueToAppend];

        // keep original contextValues if any
        if (treeItem.contextValue) {
            contextValues.push(treeItem.contextValue);
        }

        treeItem.contextValue = createContextValue(contextValues);
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
                this.appendContextValue(rootItem, Views.DiscoveryView);
                this.appendContextValue(rootItem, 'rootItem');
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
            if (element.id && this.errorNodeCache.has(element.id)) {
                context.telemetry.properties.usedCachedErrorNode = 'true';
                return this.errorNodeCache.get(element.id);
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
                    this.errorNodeCache.set(element.id, children ?? []);
                    context.telemetry.properties.cachedErrorNode = 'true';
                }

                // Wrap each child with state handling for refresh support
                return children.map((child) => {
                    if (isTreeElementWithContextValue(child)) {
                        this.appendContextValue(child, Views.DiscoveryView);
                    }

                    const wrappedChild = ext.state.wrapItemInStateHandling(child, () =>
                        this.refresh(child),
                    ) as TreeElement;

                    // Register parent-child relationship in the cache
                    if (element.id && wrappedChild.id) {
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

    async getTreeItem(element: TreeElement): Promise<vscode.TreeItem> {
        /** note that due to caching done by the TreeElementStateManager,
         * changes to the TreeItem added here might get lost */
        return element.getTreeItem();
    }

    /**
     * Refreshes the tree data.
     * This will trigger the view to update the changed element/root and its children recursively (if shown).
     *
     * @param element The element to refresh. If not provided, the entire tree will be refreshed.
     *
     * Note: This implementation handles both current and stale element references.
     * If a stale reference is provided but has an ID, it will attempt to find the current
     * reference in the tree before refreshing.
     */
    refresh(element?: TreeElement): void {
        if (element?.id) {
            // We have an element with an ID

            // Handle potential stale reference issue:
            // VS Code's TreeView API relies on object identity (reference equality),
            // not just ID equality. Find the current reference before clearing the cache.
            void this.findAndRefreshCurrentElement(element);
        } else {
            // No element or no ID, refresh the entire tree
            this.parentCache.clear();
            this.onDidChangeTreeDataEmitter.fire(element);
        }
    }

    /**
     * Helper method to find the current instance of an element by ID and refresh it.
     * This addresses the issue where stale references won't properly refresh the tree.
     *
     * @param element Potentially stale element reference
     */
    private async findAndRefreshCurrentElement(element: TreeElement): Promise<void> {
        try {
            // First try to find the current instance with this ID
            const currentElement = await this.findNodeById(element.id!);

            // AFTER finding the element, update the cache:
            // 1. Clear the cache for this ID to remove any stale references
            // (drops the element and its children)
            this.parentCache.clear(element.id!);
            // 2. Re-register the node (but not its children)
            if (currentElement?.id) {
                this.parentCache.registerNode(currentElement);
            }

            if (currentElement) {
                // We found the current instance, use it for refresh
                this.onDidChangeTreeDataEmitter.fire(currentElement);
            } else {
                // Current instance not found, fallback to using the provided element
                // This may not work if it's truly a stale reference, but we've tried our best
                this.onDidChangeTreeDataEmitter.fire(element);
            }
        } catch (error) {
            // If anything goes wrong during the lookup, still attempt the refresh with the original element
            // and clear the cache for this ID
            console.log(`Error finding current element for refresh: ${error}`);
            this.parentCache.clear(element.id!);
            this.onDidChangeTreeDataEmitter.fire(element);
        }
    }

    /**
     * Gets the parent of a tree element. Required for TreeView.reveal functionality.
     *
     * @param element The element for which to find the parent
     * @returns The parent element, or undefined if the element is a root item
     */
    getParent(element: TreeElement): TreeElement | null | undefined {
        return this.parentCache.getParent(element);
    }

    /**
     * Finds a node in the tree by its ID.
     *
     * @param id The ID of the node to find
     * @returns A Promise that resolves to the found node or undefined if not found
     */
    async findNodeById(id: string): Promise<TreeElement | undefined> {
        return this.parentCache.findNodeById(id, async (element) => {
            if (!element.getChildren) {
                return undefined;
            }
            return element.getChildren();
        });
    }
}
