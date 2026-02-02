/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { type TreeElement } from './TreeElement';

/**
 * Extends the standard TreeDataProvider with additional required methods for advanced tree functionality.
 *
 * ## Why This Interface Exists
 *
 * VS Code's built-in TreeDataProvider interface makes the getParent method optional, but this
 * method is required for critical functionality like TreeView.reveal(). This extended interface
 * ensures that all tree providers in our application properly implement:
 *
 * 1. getParent - Required for TreeView.reveal() and proper tree navigation
 * 2. findNodeById - Enables programmatic tree navigation and selection
 * 3. refresh - Standardizes how tree updates are handled
 *
 * ## Implementation Strategy
 *
 * Providers implementing this interface typically use TreeParentCache to efficiently track
 * parent-child relationships and implement the required methods. This provides a consistent
 * approach to tree navigation across different views in the extension.
 *
 * ## Benefits
 *
 * - Ensures consistent behavior across all tree views
 * - Guarantees reveal() functionality works in all trees
 * - Provides a standard way to find and manipulate nodes
 * - Simplifies integration with command handlers that need to access specific tree nodes
 */
export interface ExtendedTreeDataProvider<T extends TreeElement> extends vscode.TreeDataProvider<T> {
    /**
     * Gets the parent of a tree element. Required for TreeView.reveal functionality.
     *
     * @param element The element for which to find the parent
     * @returns The parent element, or undefined if the element is a root item
     */
    getParent(element: T): T | null | undefined;

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
    findNodeById(id: string, enableRecursiveSearch?: boolean): Promise<T | undefined>;

    /**
     * Finds a collection node by its cluster's stable identifier.
     *
     * This method is designed to work with the dual-ID architecture where:
     * - clusterId is the stable identifier (NEVER contains '/')
     * - treeId is the hierarchical path used for tree navigation
     *
     * ⚠️ IMPORTANT: clusterId is guaranteed to NOT contain '/' characters.
     * - Connections View: storageId (UUID)
     * - Azure Views: Sanitized Azure Resource ID (/ replaced with _)
     *
     * Each provider implements this differently:
     * - Connections View: Resolves the current tree path from storage using buildFullTreePath()
     * - Discovery/Azure Views: clusterId === treeId, use directly
     *
     * @param clusterId The stable cluster identifier (never contains '/')
     * @param databaseName The database name
     * @param collectionName The collection name
     * @returns A Promise that resolves to the found CollectionItem or undefined if not found
     */
    findCollectionByClusterId?(clusterId: string, databaseName: string, collectionName: string): Promise<T | undefined>;

    /**
     * Finds a cluster node by its stable cluster identifier.
     *
     * This method provides a simpler alternative to findCollectionByClusterId when you need
     * the cluster node itself (not a specific collection). Useful for:
     * - Building tree paths for databases/collections
     * - Accessing cluster metadata from webviews
     *
     * ⚠️ IMPORTANT: clusterId is guaranteed to NOT contain '/' characters.
     * - Connections View: storageId (UUID)
     * - Discovery View: Provider-prefixed ID (e.g., "azure-mongo-vcore-discovery_sanitizedId")
     * - Azure Views: Sanitized Azure Resource ID (/ replaced with _)
     *
     * @param clusterId The stable cluster identifier (never contains '/')
     * @returns A Promise that resolves to the cluster tree element or undefined if not found
     */
    findClusterNodeByClusterId?(clusterId: string): Promise<T | undefined>;

    /**
     * Refreshes the tree data.
     * This will trigger the view to update the changed element/root and its children recursively (if shown).
     *
     * @param element The element to refresh. If not provided, the entire tree will be refreshed.
     */
    refresh(element?: T): void;
}
