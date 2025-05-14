/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Helper class for caching parent-child relationships in tree data providers.
 * This enables implementation of the getParent method required for TreeView.reveal functionality.
 */
export class TreeParentCache<T> {
    private readonly nodeCache = new Map<string, T>();
    private readonly childToParentMap = new Map<string, string>();

    /**
     * Records a parent-child relationship in the cache.
     *
     * @param parent The parent node
     * @param child The child node
     * @param getNodeId Function to extract a node's ID
     */
    registerRelationship(parent: T, child: T, getNodeId: (node: T) => string | undefined): void {
        const parentId = getNodeId(parent);
        const childId = getNodeId(child);

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
     * @param getNodeId Function to extract a node's ID
     */
    registerNode(node: T, getNodeId: (node: T) => string | undefined): void {
        const nodeId = getNodeId(node);

        if (nodeId) {
            this.nodeCache.set(nodeId, node);
        }
    }

    /**
     * Gets the parent of a node from the cache.
     *
     * @param element The node to find the parent for
     * @param getNodeId Function to extract a node's ID
     * @returns The parent node if found, otherwise undefined
     */
    getParent(element: T, getNodeId: (node: T) => string | undefined): T | undefined {
        const elementId = getNodeId(element);

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
     * @param getNodeId Function to extract a node's ID
     * @param getChildrenFunc Optional function to get children of a node for deep searching
     * @returns A Promise that resolves to the found node or undefined if not found
     */
    async findNodeById(
        id: string,
        getNodeId: (node: T) => string | undefined,
        getChildrenFunc?: (element: T) => Promise<T[] | null | undefined>,
    ): Promise<T | undefined> {
        // Direct cache lookup
        const item = this.nodeCache.get(id);
        if (item) return item;

        // Try to find in child nodes if getChildrenFunc is provided
        if (getChildrenFunc) {
            for (const [key, value] of this.nodeCache.entries()) {
                if (key.startsWith(id)) {
                    const child = await this.findChildById(value, id, getNodeId, getChildrenFunc);
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
     * @param getNodeId - Function to extract a node's ID
     * @param getChildrenFunc - Function to get children of a node
     * @returns A Promise that resolves to the found node or undefined if not found
     */
    async findChildById(
        element: T,
        id: string,
        getNodeId: (node: T) => string | undefined,
        getChildrenFunc: (element: T) => Promise<T[] | null | undefined>,
    ): Promise<T | undefined> {
        const elementId = getNodeId(element);
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
                const childId = getNodeId(child);
                if (!childId) continue;

                if (childId.toLowerCase() === id.toLowerCase()) {
                    return child;
                } else if (this.isAncestorOf(child, id, getNodeId)) {
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
     * @param getNodeId - Function to extract a node's ID
     * @returns true if element is an ancestor of the node with the given ID, false otherwise
     */
    private isAncestorOf(element: T, id: string, getNodeId: (node: T) => string | undefined): boolean {
        const elementId = getNodeId(element);
        if (!elementId || id === undefined) {
            return false;
        }
        const ancestorPath = elementId + '/';
        return id.toLowerCase().startsWith(ancestorPath.toLowerCase());
    }
}
