/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { dispose } from '../utils/vscodeUtils';
import { type ExtendedTreeDataProvider } from './ExtendedTreeDataProvider';
import { type TreeElement } from './TreeElement';
import { isTreeElementWithContextValue, type TreeElementWithContextValue } from './TreeElementWithContextValue';
import { isTreeElementWithRetryChildren } from './TreeElementWithRetryChildren';
import { TreeParentCache } from './TreeParentCache';

/**
 * Base implementation of the ExtendedTreeDataProvider interface that provides
 * parent-child relationship caching, error handling, and state management.
 *
 * ## Key Features
 *
 * 1. **Tree Navigation**
 *    - Efficient parent-child relationship tracking for TreeView.reveal() functionality
 *    - Node lookup by ID for programmatic navigation
 *    - Refresh handling that maintains proper object identity
 *
 * 2. **Error Management**
 *    - Automatic caching of failed operations to prevent repeated connection attempts
 *    - Recovery mechanisms with helper action nodes
 *    - Granular error state reset capabilities
 *
 * 3. **State Processing**
 *    - Automatic context value propagation for UI integration
 *    - Consistent state handling wrapper application
 *    - Parent-child relationship registration
 *
 * ## Implementation Guide
 *
 * When extending this class, implementers should:
 *
 * 1. **Implement getChildren()**
 *    ```typescript
 *    async getChildren(element?: TreeElement): Promise<TreeElement[] | null | undefined> {
 *        return callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
 *            // Handle root elements specially
 *            if (!element) {
 *                // Clear the parent cache when refreshing at root level
 *                this.clearParentCache();
 *                // Initialize root items
 *                return rootItems;
 *            }
 *
 *            // For child elements, use the helper method
 *            return this.wrapGetChildrenWithErrorAndStateHandling(
 *                element,
 *                context,
 *                async () => element.getChildren?.(),
 *                { contextValue: 'yourViewName' }
 *            );
 *        });
 *    }
 *    ```
 *
 * 2. **Use refresh() for tree updates**
 *    ```typescript
 *    // Refresh a specific node
 *    this.refresh(element);
 *
 *    // Refresh the entire tree
 *    this.refresh();
 *    ```
 *
 * 3. **Reset error states when needed**
 *    ```typescript
 *    // Clear error state for a specific node
 *    this.resetNodeErrorState(nodeId);
 *    ```
 *
 * 4. **Use cache management helpers**
 *    ```typescript
 *    // Clear the parent cache (typically at root level)
 *    this.clearParentCache();
 *
 *    // Register a node in the cache
 *    this.registerNodeInCache(node);
 *
 *    // Register a parent-child relationship
 *    this.registerRelationshipInCache(parentNode, childNode);
 *    ```
 *
 * The primary pattern is to use `wrapGetChildrenWithErrorAndStateHandling()` which provides
 * a complete workflow for fetching and processing tree children, including error handling,
 * parent-child relationship registration, and state management.
 *
 * @template T The tree element type that extends TreeElement
 */
export abstract class BaseExtendedTreeDataProvider<T extends TreeElement>
    extends vscode.Disposable
    implements ExtendedTreeDataProvider<T>
{
    /**
     * Cache for tracking parent-child relationships to support the getParent method.
     *
     * This cache enables:
     * - Efficient implementation of tree.reveal() functionality to navigate to specific nodes
     * - Finding nodes by ID without traversing the entire tree each time
     * - Proper cleanup when refreshing parts of the tree
     *
     * Note: Do not access this cache directly. Use the provided helper methods:
     * - clearParentCache(): Clear the entire cache
     * - registerNodeInCache(): Register a node in the cache
     * - registerRelationshipInCache(): Register a parent-child relationship
     */
    private readonly parentCache = new TreeParentCache<T>();

    /**
     * Caches the full set of children for nodes that failed to load properly.
     *
     * This cache prevents repeated attempts to fetch children for nodes that have previously failed,
     * such as when a user enters invalid credentials. By storing the failed children, we avoid unnecessary
     * repeated calls until the error state is explicitly cleared.
     *
     * Key: Node ID (parent)
     * Value: Array of TreeElement representing the failed children (usually includes an error node)
     */
    protected readonly failedChildrenCache = new Map<string, T[]>();

    /**
     * Event emitter for notifying VS Code when tree data changes.
     *
     * From vscode.TreeDataProvider<T>:
     * An optional event to signal that an element or root has changed.
     * This will trigger the view to update the changed element/root and its children recursively (if shown).
     * To signal that root has changed, do not pass any argument or pass `undefined` or `null`.
     */
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void | T | T[] | null | undefined>();

    /**
     * Collection of disposable resources that should be cleaned up when this provider is disposed.
     * Derived classes can add their own disposables to this array.
     */
    protected readonly disposables: vscode.Disposable[] = [];

    /**
     * Event fired when tree data changes. Required by vscode.TreeDataProvider.
     */
    get onDidChangeTreeData(): vscode.Event<void | T | T[] | null | undefined> {
        return this.onDidChangeTreeDataEmitter.event;
    }

    constructor() {
        super(() => this.dispose());
    }

    /**
     * Clears the parent-child relationship cache.
     *
     * This should be called when refreshing at the root level to ensure clean state
     * and prevent stale relationships from affecting tree navigation.
     */
    protected clearParentCache(): void {
        this.parentCache.clear();
    }

    /**
     * Registers a node in the parent cache.
     *
     * @param node The node to register
     */
    protected registerNodeInCache(node: T): void {
        if (node.id) {
            this.parentCache.registerNode(node);
        }
    }

    /**
     * Registers a parent-child relationship in the cache.
     *
     * @param parent The parent node
     * @param child The child node
     */
    protected registerRelationshipInCache(parent: T, child: T): void {
        if (parent.id && child.id) {
            this.parentCache.registerRelationship(parent, child);
        }
    }

    /**
     * Gets the parent of a tree element. Required for TreeView.reveal functionality.
     *
     * @param element The element for which to find the parent
     * @returns The parent element, or undefined if the element is a root item
     */
    getParent(element: T): T | null | undefined {
        return this.parentCache.getParent(element);
    }

    /**
     * Gets the tree item representation for VS Code. Required by vscode.TreeDataProvider.
     *
     * Note: Due to caching done by the TreeElementStateManager,
     * changes to the TreeItem added here might get lost.
     *
     * @param element The tree element to convert to a tree item
     * @returns Promise resolving to the tree item representation
     */
    async getTreeItem(element: T): Promise<vscode.TreeItem> {
        return element.getTreeItem();
    }

    /**
     * Removes a node's error state from the failed children cache.
     * This allows the node to be refreshed and its children to be re-fetched on the next refresh call.
     * If not reset, the cached error children will always be returned for this node.
     *
     * @param nodeId The ID of the node to clear from the failed children cache.
     */
    resetNodeErrorState(nodeId: string): void {
        this.failedChildrenCache.delete(nodeId);
    }

    /**
     * Finds a node in the tree by its ID.
     *
     * Note: By default, this method only searches in the nodes that are known, i.e., nodes that have been processed
     * by the data provider. Hidden nodes, such as those that haven't been expanded and their children,
     * will not be discovered. However, if `enableRecursiveSearch` is set to `true`, the method will perform
     * a more intensive search by automatically expanding nodes as needed. This can be time-consuming for
     * large trees or deeply nested structures.
     *
     * @param id The ID of the node to find
     * @param enableRecursiveSearch Optional boolean to enable a deeper search with automatic node expansion
     * @returns A Promise that resolves to the found node or undefined if not found
     */
    async findNodeById(id: string, enableRecursiveSearch?: boolean): Promise<T | undefined> {
        if (enableRecursiveSearch) {
            // Pass this.getChildren as the second parameter to enable recursive search
            return this.parentCache.findNodeById(
                id,
                this.getChildren.bind(this) as (element: T) => Promise<T[] | null | undefined>,
            );
        } else {
            // If recursive search is not enabled, we only search in the known nodes
            return this.parentCache.findNodeById(id);
        }
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
    refresh(element?: T): void {
        if (element?.id) {
            // We have an element with an ID

            // Handle potential stale reference issue:
            // VS Code's TreeView API relies on object identity (reference equality),
            // not just ID equality. Find the current reference before clearing the cache.
            void this.findAndRefreshCurrentElement(element);
        } else {
            // No element or no ID, refresh the entire tree
            this.clearParentCache();
            this.onDidChangeTreeDataEmitter.fire(element);
        }
    }

    /**
     * Helper method to find the current instance of an element by ID and refresh it.
     * This addresses the issue where stale references won't properly refresh the tree.
     *
     * @param element Potentially stale element reference
     */
    protected async findAndRefreshCurrentElement(element: T): Promise<void> {
        try {
            // First try to find the current instance with this ID
            const currentElement = await this.findNodeById(element.id!);

            // AFTER finding the element, update the cache:
            // 1. Clear the cache for this ID to remove any stale references
            // (drops the element and its children)
            this.parentCache.clear(element.id!);
            // 2. Re-register the node (but not its children)
            if (currentElement?.id) {
                this.registerNodeInCache(currentElement);
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
     * Helper method for appending context values to tree items.
     *
     * This method provides a consistent way for derived classes to add context values
     * to tree elements, ensuring proper formatting and preservation of existing values.
     *
     * @param treeItem The tree item to modify
     * @param contextValuesToAppend The context values to append
     */
    protected appendContextValues(treeItem: TreeElementWithContextValue, ...contextValuesToAppend: string[]): void {
        const contextValues: string[] = contextValuesToAppend;

        // Keep original contextValues if any
        if (treeItem.contextValue) {
            contextValues.push(treeItem.contextValue);
        }

        treeItem.contextValue = createContextValue(contextValues);
    }

    /**
     * Wraps element's getChildren call with error caching, child processing, and state handling.
     *
     * This method provides a complete workflow for fetching and processing tree children:
     * 1. Error state caching to prevent repeated failures
     * 2. Child fetching with proper error detection
     * 3. Helper node creation for error recovery
     * 4. Context value appending for UI features
     * 5. Parent-child relationship registration for navigation
     * 6. State handling wrapping for proper updates
     *
     * @param element The tree element to get children for
     * @param context The action context for telemetry
     * @param childrenFetchFunc Function to call to fetch children
     * @param options Configuration options for error handling and child processing
     * @returns Processed children array, or null/undefined if none
     *
     * @example
     * // Basic usage with full child processing:
     * const children = await this.wrapGetChildrenWithErrorAndStateHandling(
     *   element,
     *   context,
     *   async () => element.getChildren?.(),
     *   { contextValue: Views.ConnectionsView }
     * );
     * return children; // Already fully processed
     *
     * @example
     * // With helper nodes (Connections provider):
     * const children = await this.wrapGetChildrenWithErrorAndStateHandling(
     *   element,
     *   context,
     *   async () => element.getChildren?.(),
     *   {
     *     contextValue: Views.ConnectionsView,
     *     createHelperNodes: (el) => [
     *       createGenericElementWithContext({
     *         contextValue: 'error',
     *         id: `${el.id}/updateCredentials`,
     *         label: vscode.l10n.t('Click here to update credentials'),
     *         iconPath: new vscode.ThemeIcon('key'),
     *         commandId: 'vscode-documentdb.command.connectionsView.updateCredentials',
     *         commandArgs: [el],
     *       }) as TreeElement,
     *     ]
     *   }
     * );
     * return children; // Already fully processed
     */
    protected async wrapGetChildrenWithErrorAndStateHandling(
        element: T,
        context: IActionContext,
        childrenFetchFunc: () => Promise<T[] | null | undefined>,
        options: {
            detectErrorState?: (element: T, children: T[] | null | undefined) => boolean;
            createHelperNodes?: (element: T) => T[];
            contextValue?: string; // For automatic context value appending
        } = {},
    ): Promise<T[] | null | undefined> {
        // 1. Check if we have cached error children for this element
        //
        // This prevents repeated attempts to fetch children for nodes that have previously failed
        // (e.g., due to invalid credentials or connection issues).
        if (element.id && this.failedChildrenCache.has(element.id)) {
            context.telemetry.properties.usedCachedErrorNode = 'true';
            return this.failedChildrenCache.get(element.id);
        }

        // 2. Fetch the children of the current element
        const children = await childrenFetchFunc();
        context.telemetry.measurements.childrenCount = children?.length ?? 0;

        // 3. Check if the returned children contain an error node
        // This means the operation failed (e.g., authentication)
        const hasError = options.detectErrorState
            ? options.detectErrorState(element, children)
            : isTreeElementWithRetryChildren(element) && element.hasRetryNode(children);

        if (hasError && element.id) {
            // 4. Optionally create helper nodes to provide user-friendly error recovery actions
            if (options.createHelperNodes) {
                const helperNodes = options.createHelperNodes(element);
                children?.push(...helperNodes);
            }

            // 5. Store the complete error state (error nodes + helper nodes) in our cache for future refreshes
            this.failedChildrenCache.set(element.id, children ?? []);
            context.telemetry.properties.cachedErrorNode = 'true';
        }

        // 6. Process children when contextValue is provided (automatic child processing)
        if (options.contextValue && children) {
            return children.map((child) => {
                if (child.id) {
                    if (isTreeElementWithContextValue(child)) {
                        this.appendContextValues(child, options.contextValue!);
                    }

                    // Register parent-child relationship in the cache
                    if (element.id && child.id) {
                        this.registerRelationshipInCache(element, child);
                    }

                    return ext.state.wrapItemInStateHandling(child, () => this.refresh(child)) as T;
                }
                return child;
            });
        }

        return children;
    }

    /**
     * Wraps element's getChildren call with error caching to prevent repeated failures.
     *
     * This method standardizes the error handling pattern used across all tree data providers,
     * implementing a consistent approach to:
     *
     * 1. **Error State Caching**: Checks for cached error states to prevent repeated failed attempts
     * 2. **Children Fetching**: Calls the provided function to fetch children from the element
     * 3. **Error Detection**: Uses configurable logic to detect when children contain error states
     * 4. **Helper Node Creation**: Optionally creates helper action nodes for user-friendly error recovery
     * 5. **Telemetry Tracking**: Sets telemetry properties to track caching behavior and error states
     *
     * @deprecated Use wrapGetChildrenWithErrorAndStateHandling instead for enhanced functionality
     * @param element The tree element to get children for
     * @param context The action context for telemetry
     * @param childrenFetchFunc Function to call to fetch children - typically () => element.getChildren?.()
     * @param options Configuration options for error detection and helper nodes
     * @returns Promise resolving to the children array, including any error nodes and helper nodes
     */
    protected async wrapGetChildrenWithErrorHandling(
        element: T,
        context: IActionContext,
        childrenFetchFunc: () => Promise<T[] | null | undefined>,
        options: {
            detectErrorState?: (element: T, children: T[] | null | undefined) => boolean;
            createHelperNodes?: (element: T) => T[];
        } = {},
    ): Promise<T[] | null | undefined> {
        // Delegate to the enhanced method without child processing
        return this.wrapGetChildrenWithErrorAndStateHandling(element, context, childrenFetchFunc, options);
    }

    /**
     * Disposes of all resources held by this provider.
     * This includes the event emitter and any disposables registered by derived classes.
     */
    dispose(): void {
        this.onDidChangeTreeDataEmitter.dispose();
        dispose(this.disposables);
    }

    /**
     * Abstract method that must be implemented by derived classes to provide the actual tree structure.
     *
     * @param element The parent element for which to get children, or undefined for root elements
     * @returns Promise resolving to an array of child elements, null, or undefined
     */
    abstract getChildren(element?: T): Promise<T[] | null | undefined>;
}
