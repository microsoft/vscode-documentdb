/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TreeElement } from './TreeElement';

/**
 * Helper class for caching parent-child relationships in tree data providers.
 * This enables implementation of the getParent method required for TreeView.reveal functionality.
 *
 * ## Purpose and Benefits
 *
 * VS Code's TreeDataProvider interface includes an optional getParent method that enables
 * important functionality like tree.reveal(). However, implementing this method requires
 * tracking parent-child relationships, which complicates tree providers. This class solves
 * this problem by abstracting parent-child relationship tracking into a reusable component.
 *
 * ## Integration with Tree Providers
 *
 * This cache is used by tree data providers like:
 *
 * 1. ConnectionsBranchDataProvider - For the Connections view showing database clusters and connections
 * 2. DiscoveryBranchDataProvider - For the Discovery view showing various database discovery mechanisms
 *
 * These providers maintain their tree structure by registering nodes and relationships during
 * their getChildren() calls, which enables them to later resolve parent nodes and perform
 * node lookups by ID.
 *
 * ## Cache Design Considerations
 *
 * - Hierarchical ID structure is supported (paths with '/' separators)
 * - Explicit relationship tracking allows non-hierarchical relationships
 * - Optimized for fast parent lookups and node finding operations
 * - Selective cache clearing for refreshing specific branches
 *
 * ## Advantages over Base Class Approach
 *
 * This composition-based approach offers more flexibility than inheritance:
 * - Providers can selectively implement required functionality
 * - Multiple inheritance issues are avoided
 * - Implementation is consistent between different provider types
 * - Allows for separate evolution of caching and tree provider logic
 */
export class TreeParentCache<T extends TreeElement> {
    /**
     * Stores nodes by their ID for quick lookup operations.
     * This cache is the primary source for node retrieval operations and enables
     * findNodeById to efficiently return existing nodes.
     */
    private readonly nodeCache = new Map<string, T>();

    /**
     * Maps child node IDs to their parent node IDs.
     * This mapping enables the getParent method to quickly find a node's parent
     * without having to traverse the entire tree structure.
     */
    private readonly childToParentMap = new Map<string, string>();

    /**
     * Records a parent-child relationship in the cache.
     *
     * @param parent The parent node
     * @param child The child node
     */
    registerRelationship(parent: T, child: T): void {
        const parentId = parent.id;
        const childId = child.id;

        if (parentId && childId) {
            this.nodeCache.set(parentId, parent);
            this.nodeCache.set(childId, child);
            this.childToParentMap.set(childId, parentId);
        }
    }

    /**
     * Registers a node in the cache (typically used for root nodes that don't have parents)
     *
     * @param node The node to register
     */
    registerNode(node: T): void {
        const nodeId = node.id;

        if (nodeId) {
            this.nodeCache.set(nodeId, node);
        }
    }

    /**
     * Gets the parent of a node from the cache.
     *
     * @param element The node to find the parent for
     * @returns The parent node if found, otherwise undefined
     */
    getParent(element: T): T | undefined {
        const elementId = element.id;

        if (!elementId) {
            return undefined;
        }

        // Explicit relationship lookup
        if (this.childToParentMap.has(elementId)) {
            const parentId = this.childToParentMap.get(elementId);
            if (parentId) {
                return this.nodeCache.get(parentId);
            }
        }

        // ID-based parent lookup (assuming hierarchical IDs with '/' separator)
        const lastSlashIndex = elementId.lastIndexOf('/');
        if (lastSlashIndex > 0) {
            const parentId = elementId.substring(0, lastSlashIndex);
            return this.nodeCache.get(parentId);
        }

        return undefined;
    }

    /**
     * Clears the entire cache or prunes entries related to a specific node.
     *
     * @param nodeId Optional ID of a node to prune; if not provided, the entire cache is cleared
     */
    clear(nodeId?: string): void {
        if (!nodeId) {
            this.nodeCache.clear();
            this.childToParentMap.clear();
            return;
        }

        // Prune the specific node and its descendants
        this.pruneCache(nodeId);
    }

    private pruneCache(elementId: string): void {
        // Remove the element itself
        this.nodeCache.delete(elementId);
        this.childToParentMap.delete(elementId);

        // Remove all descendants (elements whose IDs start with elementId/)
        const prefix = `${elementId}/`;
        const keysToDelete: string[] = [];

        this.nodeCache.forEach((_, key) => {
            if (key.startsWith(prefix)) {
                keysToDelete.push(key);
            }
        });

        keysToDelete.forEach((key) => {
            this.nodeCache.delete(key);
            this.childToParentMap.delete(key);
        });
    }

    /**
     * Finds and returns a tree node by its ID.
     * @param id - The ID of the node to find
     * @param getChildrenFunc Optional function to get children of a node for deep searching
     * @returns A Promise that resolves to the found node or undefined if not found
     */
    async findNodeById(
        id: string,
        getChildrenFunc?: (element: T) => Promise<T[] | null | undefined>,
    ): Promise<T | undefined> {
        // Direct cache lookup
        const item = this.nodeCache.get(id);
        if (item) return item;

        // Try to find the best starting point if getChildrenFunc is provided
        if (getChildrenFunc) {
            // we'll try to find the best starting point by looking for the node
            // with the given id, this means one with the longest path that matches
            // the beginning of the id

            // Find all potential ancestor nodes
            const potentialAncestors: { key: string; node: T }[] = [];

            for (const [key, value] of this.nodeCache.entries()) {
                // Check if this cached node is an ancestor of our target
                if (id.startsWith(key)) {
                    potentialAncestors.push({ key, node: value });
                }
            }

            // Sort by path length descending to start from the deepest common ancestor
            potentialAncestors.sort((a, b) => b.key.length - a.key.length);

            // Try each potential ancestor, starting with the deepest one
            // The first one will most likely be the best candidate
            // because it has the longest path that matches the beginning of the id
            // but let's keep the loop just in case
            for (const { node } of potentialAncestors) {
                const child = await this.findChildById(node, id, getChildrenFunc);
                if (child) return child;
            }
        }

        return undefined;
    }

    /**
     * Recursively searches for a child element with the specified ID within the tree structure.
     *
     * @param element - The tree element from which to start the search
     * @param id - The ID of the child element to find
     * @param getChildrenFunc - Function to get children of a node
     * @returns A Promise that resolves to the found node or undefined if not found
     */
    async findChildById(
        element: T,
        id: string,
        getChildrenFunc: (element: T) => Promise<T[] | null | undefined>,
    ): Promise<T | undefined> {
        const elementId = element.id;
        if (!elementId || !id.startsWith(elementId)) {
            return undefined;
        }

        let node = element;
        // eslint-disable-next-line no-constant-condition
        outerLoop: while (true) {
            const children = await getChildrenFunc(node);

            if (!children) {
                return undefined;
            }

            for (const child of children) {
                const childId = child.id;
                if (!childId) continue;

                if (childId.toLowerCase() === id.toLowerCase()) {
                    return child;
                } else if (this.isAncestorOf(child, id)) {
                    node = child;
                    continue outerLoop;
                }
            }

            return undefined;
        }
    }

    /**
     * Checks if an element is an ancestor of a node with the given ID.
     *
     * @param element - The potential ancestor element
     * @param id - The ID to check against
     * @returns true if element is an ancestor of the node with the given ID, false otherwise
     */
    private isAncestorOf(element: T, id: string): boolean {
        const elementId = element.id;
        if (!elementId || id === undefined) {
            return false;
        }
        const ancestorPath = elementId + '/';
        return id.toLowerCase().startsWith(ancestorPath.toLowerCase());
    }
}
