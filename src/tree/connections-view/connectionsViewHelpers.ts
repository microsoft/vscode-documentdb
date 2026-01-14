/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { ConnectionStorageService, ConnectionType } from '../../services/connectionStorageService';
import { revealConnectionsViewElement } from '../api/revealConnectionsViewElement';

/**
 * Builds a tree path for the Connections View based on the provided parameters.
 * This path format is required for proper tree navigation and element identification.
 *
 * This function builds the correct path string that matches the actual tree structure
 * of the Connections View. Any structural changes to the tree view will require
 * updates to this function.
 *
 * **Common Use Cases:**
 * - Creating paths for revealing elements in the tree
 * - Building node IDs for finding specific elements
 * - Constructing paths for tree navigation commands
 *
 * **Path Structure:**
 * - Root: Always starts with the ConnectionsView identifier
 * - Emulator section: Adds 'localEmulators' for emulator connections
 * - Connection: The storage ID of the connection
 * - Database: Optional database name
 * - Collection: Optional collection name (only valid with database)
 *
 * @param storageId - The ID of the connection in storage
 * @param isEmulator - Whether the connection is to a local emulator
 * @param database - Optional database name to include in the path
 * @param collection - Optional collection name to include in the path
 * @returns The constructed tree path string
 *
 * @example
 * ```typescript
 * // Path to a specific collection
 * const path = buildConnectionsViewTreePath('conn123', false, 'myDatabase', 'myCollection');
 * // Result: 'connectionsView/conn123/myDatabase/myCollection'
 *
 * // Path to an emulator connection
 * const emulatorPath = buildConnectionsViewTreePath('emulator456', true);
 * // Result: 'connectionsView/localEmulators/emulator456'
 * ```
 */
export function buildConnectionsViewTreePath(
    storageId: string,
    isEmulator: boolean,
    database?: string,
    collection?: string,
): string {
    let treePath = `${Views.ConnectionsView}`;

    // Add 'Local Emulators' node to the path, if needed
    if (isEmulator) {
        treePath += '/localEmulators';
    }

    // Add the storage ID
    treePath += `/${storageId}`;

    // Add database if provided
    if (database) {
        treePath += `/${database}`;

        // Add collection only if database is present
        if (collection) {
            treePath += `/${collection}`;
        }
    }

    return treePath;
}

/**
 * Builds a tree path for a folder or connection, including the full parent folder hierarchy.
 * This is necessary for proper tree reveal of nested folders.
 *
 * For nested structures like:
 * - Root
 *   - FolderA (id: 'a123')
 *     - FolderB (id: 'b456')
 *
 * The tree path for FolderB would be: `connectionsView/a123/b456`
 *
 * @param itemId - The storage ID of the item to build a path for
 * @param connectionType - The connection type (Clusters or Emulators)
 * @returns The full tree path including parent folder IDs
 */
export async function buildFullTreePath(itemId: string, connectionType: ConnectionType): Promise<string> {
    const isEmulator = connectionType === ConnectionType.Emulators;
    let treePath: string = Views.ConnectionsView;

    if (isEmulator) {
        treePath += '/localEmulators';
    }

    // Build the path by traversing from item to root
    const pathIds = await getAncestorIds(itemId, connectionType);

    // pathIds is ordered from root to item, so join directly
    for (const id of pathIds) {
        treePath += `/${id}`;
    }

    return treePath;
}

/**
 * Gets the ancestor IDs from root to the specified item (inclusive).
 * Returns IDs in order from root ancestor to the item itself.
 */
async function getAncestorIds(itemId: string, connectionType: ConnectionType): Promise<string[]> {
    const item = await ConnectionStorageService.get(itemId, connectionType);
    if (!item) {
        return [itemId]; // Fallback: just use the ID even if not found
    }

    if (!item.properties.parentId) {
        // Item is at root level
        return [itemId];
    }

    // Recursively get parent path, then add this item
    const parentPath = await getAncestorIds(item.properties.parentId, connectionType);
    return [...parentPath, itemId];
}

/**
 * Refreshes the parent element in the Connections View tree after a child modification.
 *
 * This function extracts the parent tree element ID from a child's full tree path
 * and triggers a selective refresh of that parent's children. This is more efficient
 * than refreshing the entire connections view.
 *
 * **Tree Path Structure:**
 * Tree element IDs follow the pattern: `connectionsView/[localEmulators/]parentId/childId`
 * The parent ID is extracted by finding the last `/` separator.
 *
 * **Root-Level Detection:**
 * Elements at the root level have IDs like `connectionsView/folderId` or
 * `connectionsView/localEmulators/emulatorId`. When the extracted parentId is just
 * the view prefix (`connectionsView` or `connectionsView/localEmulators`), this indicates
 * the element is at root level and the entire branch is refreshed instead.
 *
 * @param treeElementId - The full tree path of the child element that was modified
 *
 * @example
 * ```typescript
 * // Nested element - refreshes parent folder:
 * // treeElementId = 'connectionsView/folderId/connectionId'
 * // Extracts parentId = 'connectionsView/folderId' → notifyChildrenChanged()
 * refreshParentInConnectionsView(node.id);
 *
 * // Root-level element - refreshes entire branch:
 * // treeElementId = 'connectionsView/folderId'
 * // Extracts parentId = 'connectionsView' → full refresh()
 * refreshParentInConnectionsView(node.id);
 * ```
 */
export function refreshParentInConnectionsView(treeElementId: string): void {
    const lastSlashIndex = treeElementId.lastIndexOf('/');
    if (lastSlashIndex !== -1) {
        const parentId = treeElementId.substring(0, lastSlashIndex);

        // Check if parentId is just the view prefix (e.g., "connectionsView" or "connectionsView/localEmulators")
        // These are not actual tree element IDs - they indicate the element is at root level
        // Root-level elements: "connectionsView/folderId" → parentId = "connectionsView"
        // LocalEmulators root: "connectionsView/localEmulators/emulatorId" → parentId = "connectionsView/localEmulators"
        const isRootLevel = parentId === 'connectionsView' || parentId === 'connectionsView/localEmulators';

        if (isRootLevel) {
            // Root-level element, refresh the whole branch
            ext.connectionsBranchDataProvider.refresh();
        } else {
            ext.state.notifyChildrenChanged(parentId);
        }
    } else {
        // No slash found (shouldn't happen with proper tree IDs), refresh the whole branch
        ext.connectionsBranchDataProvider.refresh();
    }
}

/**
 * Wraps an async operation with a progress indicator on the Connections View.
 *
 * This utility ensures consistent visual feedback across all operations that modify
 * the Connections View (adding/removing connections, folders, etc.).
 *
 * @param callback - The async operation to execute while showing progress
 * @returns The result of the callback
 */
export async function withConnectionsViewProgress<T>(callback: () => Promise<T>): Promise<T> {
    return vscode.window.withProgress(
        {
            location: { viewId: Views.ConnectionsView },
            cancellable: false,
        },
        async () => {
            return callback();
        },
    );
}

/**
 * Refreshes the parent element and reveals a newly created element in the Connections View.
 *
 * This is a convenience function that combines the common pattern of:
 * 1. Focusing the Connections View
 * 2. Waiting for the view to be ready
 * 3. Revealing and selecting the new element
 *
 * @param context - The action context for telemetry tracking
 * @param elementPath - The full tree path to the element to reveal
 * @param options - Optional reveal options (defaults to select, focus, no expand)
 */
export async function focusAndRevealInConnectionsView(
    context: IActionContext,
    elementPath: string,
    options?: {
        select?: boolean;
        focus?: boolean;
        expand?: boolean;
    },
): Promise<void> {
    await vscode.commands.executeCommand(`connectionsView.focus`);
    await waitForConnectionsViewReady(context);
    await revealConnectionsViewElement(context, elementPath, {
        select: options?.select ?? true,
        focus: options?.focus ?? true,
        expand: options?.expand ?? false,
    });
}

/**
 * Reveals and focuses on an element in the Connections View.
 *
 * This function provides a reliable way to navigate the Connections View tree
 * and reveal specific elements like connections, databases, or collections.
 * It implements a progressive reveal strategy to ensure intermediate nodes
 * are properly expanded even when elements might be loading or error states exist.
 *
 * **Progressive Reveal Strategy:**
 * The function reveals the path in a step-by-step approach, ensuring each level
 * is properly expanded before moving to the next:
 * 1. First reveals the connection level
 * 2. If applicable, reveals the database level
 * 3. If applicable, reveals the collection level
 *
 * This approach is more reliable than trying to reveal the deepest path directly,
 * especially when dealing with lazy-loaded nodes or potential error states.
 *
 * @param context - The action context for telemetry tracking
 * @param storageId - The storage ID of the connection to reveal
 * @param isEmulator - Whether the connection is to a local emulator
 * @param database - Optional database name to reveal
 * @param collection - Optional collection name to reveal
 * @throws Error if collection is specified without a database
 *
 * @example
 * ```typescript
 * // Reveal a specific collection
 * await revealInConnectionsView(context, 'conn123', false, 'myDatabase', 'myCollection');
 *
 * // Reveal just a connection
 * await revealInConnectionsView(context, 'conn456', true);
 * ```
 */
export async function revealInConnectionsView(
    context: IActionContext,
    storageId: string,
    isEmulator: boolean,
    database?: string,
    collection?: string,
): Promise<void> {
    // Validate that database is provided if collection is specified
    if (collection && !database) {
        throw new Error(l10n.t('Database name is required when collection is specified'));
    }

    // Progressive reveal workaround: The reveal function does not show the opened path
    // if the full search fails, which causes our error nodes not to be shown.
    // We implement a three-step reveal process to ensure intermediate nodes are expanded.

    // Step 0: Reveal local connections:
    if (isEmulator) {
        await revealConnectionsViewElement(context, `${Views.ConnectionsView}/localEmulators`, {
            select: false, // Don't select yet
            focus: false, // Don't focus yet
            expand: true, // Expand to show emulator connections
        });
    }

    // Step 1: Reveal the connection
    const connectionPath = buildConnectionsViewTreePath(storageId, isEmulator);
    await revealConnectionsViewElement(context, connectionPath, {
        select: true, // Only select if this is the final step
        focus: !database, // Only focus if this is the final step
        expand: true,
    });

    // Step 2: Reveal the database (if provided)
    if (database) {
        const databasePath = buildConnectionsViewTreePath(storageId, isEmulator, database);
        await revealConnectionsViewElement(context, databasePath, {
            select: true, // Only select if this is the final step
            focus: !collection, // Only focus if this is the final step
            expand: true,
        });

        // Step 3: Reveal the collection (if provided)
        if (collection) {
            const collectionPath = buildConnectionsViewTreePath(storageId, isEmulator, database, collection);
            await revealConnectionsViewElement(context, collectionPath, {
                select: true,
                focus: true,
                expand: true,
            });
        }
    }
}

/**
 * Waits for the connections tree view to be accessible and ready for operations.
 *
 * This utility function is essential when working with the Connections View after making changes
 * that trigger refreshes or updates. It ensures the tree view is fully loaded and accessible
 * before attempting operations like focusing on elements, revealing nodes, or querying the tree structure.
 *
 * **Common Use Cases:**
 * - After adding/removing connections and before revealing them in the tree
 * - After triggering tree refreshes and before focusing on specific elements
 * - Before executing commands that depend on the Connections View state
 * - When transitioning between views and need to ensure proper Connections View initialization
 *
 * **Implementation Details:**
 * The function uses exponential backoff to poll the tree view's `getChildren()` method.
 * This approach is reliable because:
 * - `getChildren()` is the core method that must work for tree views to function
 * - It's called by VS Code's tree rendering system, so if it works, the tree is ready
 * - It doesn't depend on specific tree content, just basic tree functionality
 *
 * **Telemetry:**
 * The function records metrics for monitoring tree view performance:
 * - `connectionViewActivationTimeMs`: Total time spent waiting
 * - `connectionViewActivationAttempts`: Number of polling attempts made
 * - `connectionViewActivationResult`: 'success' or 'timeout'
 *
 * @param context - The action context for telemetry tracking
 * @param maxAttempts - Maximum number of polling attempts before giving up (default: 5)
 * @returns Promise that resolves when Connections View is ready or timeout is reached
 *
 * @example
 * ```typescript
 * // After adding a new connection
 * await StorageService.get(StorageNames.Connections).push('clusters', newConnection);
 * ext.connectionsBranchDataProvider.refresh();
 * await waitForConnectionsViewReady(context); // Wait for refresh to complete
 * await revealInConnectionsView(context, 'conn123', false);
 * ```
 */
export async function waitForConnectionsViewReady(context: IActionContext, maxAttempts: number = 5): Promise<void> {
    const startTime = Date.now();
    let attempt = 0;
    let delay = 500; // Start with 500ms

    while (attempt < maxAttempts) {
        try {
            // Try to access the tree view - if this succeeds, we're ready
            const rootElements = await ext.connectionsBranchDataProvider.getChildren();
            if (rootElements !== undefined) {
                // Tree view is ready - record successful activation
                const totalTime = Date.now() - startTime;
                context.telemetry.measurements.connectionViewActivationTimeMs = totalTime;
                context.telemetry.measurements.connectionViewActivationAttempts = attempt + 1;
                context.telemetry.properties.connectionViewActivationResult = 'success';
                return;
            }
        } catch {
            // Tree view not ready yet, continue polling
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
        attempt++;
        delay = Math.min(delay * 1.5, 2000); // Cap at 2 seconds
    }

    // Exhausted all attempts - record timeout and continue optimistically
    const totalTime = Date.now() - startTime;
    context.telemetry.measurements.connectionViewActivationTimeMs = totalTime;
    context.telemetry.measurements.connectionViewActivationAttempts = maxAttempts;
    context.telemetry.properties.connectionViewActivationResult = 'timeout';

    // Let's just move forward, maybe it's ready, maybe something has failed
    // The next step will handle the case when the tree view is not ready
}
