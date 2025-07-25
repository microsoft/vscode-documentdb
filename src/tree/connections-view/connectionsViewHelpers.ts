/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
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
