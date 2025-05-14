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
     * @param id The ID of the node to find
     * @returns A Promise that resolves to the found node or undefined if not found
     */
    findNodeById(id: string): Promise<T | undefined>;

    /**
     * Refreshes the tree data.
     * This will trigger the view to update the changed element/root and its children recursively (if shown).
     *
     * @param element The element to refresh. If not provided, the entire tree will be refreshed.
     */
    refresh(element?: T): void;
}
