/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TreeElement } from './TreeElement';

/**
 * Helper class for caching parent-child relationships in tree data providers.
 * This enables implementation of the getParent method required for TreeView.reveal functionality.
 */
export class TreeParentCache<T extends TreeElement> {
    private readonly nodeCache = new Map<string, T>();
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

        // Try to find in child nodes if getChildrenFunc is provided
        if (getChildrenFunc) {
            for (const [key, value] of this.nodeCache.entries()) {
                if (key.startsWith(id)) {
                    const child = await this.findChildById(value, id, getChildrenFunc);
                    if (child) return child;
                }
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
