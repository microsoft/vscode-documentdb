/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { ext } from '../../extensionVariables';
import {
    ConnectionStorageService,
    ItemType,
    type ConnectionType,
    type StoredItem,
} from '../../services/connectionStorageService';
import { TaskService } from '../../services/taskService/taskService';
import { type TaskInfo } from '../../services/taskService/taskServiceResourceTracking';

/**
 * Custom error to signal that conflict verification completed with no conflicts.
 * Used in wizard prompt steps to exit the QuickPick and proceed to the next step.
 */
export class VerificationCompleteError extends Error {
    constructor() {
        super('Conflict verification completed successfully');
        this.name = 'VerificationCompleteError';
    }
}

/**
 * Finds all tasks that conflict with the given cluster IDs.
 *
 * This is a convenience wrapper around TaskService.findConflictingTasksForConnections().
 *
 * @param clusterIds - Array of cluster IDs (storageIds from ConnectionStorageService) to check against running tasks
 * @returns Array of conflicting tasks (deduplicated by taskId)
 *
 * @example
 * ```typescript
 * // Check a single connection
 * const conflicts = findConflictingTasks([node.cluster.clusterId]);
 *
 * // Check all connections in a folder
 * const clusterIds = await enumerateConnectionsInFolder(folderId, connectionType);
 * const conflicts = findConflictingTasks(clusterIds);
 * ```
 */
export function findConflictingTasks(clusterIds: string[]): TaskInfo[] {
    return TaskService.findConflictingTasksForConnections(clusterIds);
}

/**
 * Enumerates all connection storageIds within a folder and its descendants.
 * Used for conflict checking before folder operations (delete, move).
 *
 * This function walks the folder tree recursively and collects the storageIds
 * of all connections found. These storageIds are the same values used as
 * `connectionId` in task resource tracking (cluster.clusterId).
 *
 * @param folderId - The storage ID of the folder to enumerate
 * @param connectionType - The connection type (Clusters or Emulators)
 * @returns Array of connection storageIds (clusterIds) within the folder
 *
 * @example
 * ```typescript
 * // Before deleting a folder, find all connections in it
 * const connectionIds = await enumerateConnectionsInFolder(folderId, ConnectionType.Clusters);
 * const conflicts = findConflictingTasks(connectionIds);
 * ```
 */
export async function enumerateConnectionsInFolder(
    folderId: string,
    connectionType: ConnectionType,
): Promise<string[]> {
    const connectionIds: string[] = [];

    async function collectDescendants(parentId: string): Promise<void> {
        const children = await ConnectionStorageService.getChildren(parentId, connectionType);
        for (const child of children) {
            if (child.properties.type === ItemType.Connection) {
                connectionIds.push(child.id); // storageId = connectionId for tasks
            } else if (child.properties.type === ItemType.Folder) {
                await collectDescendants(child.id);
            }
        }
    }

    await collectDescendants(folderId);
    return connectionIds;
}

/**
 * Enumerates all connection storageIds from a list of items (connections and/or folders).
 * For connections, adds their ID directly. For folders, recursively enumerates all descendant connections.
 *
 * @param items - Array of stored items (connections and folders) to enumerate
 * @param connectionType - The connection type (Clusters or Emulators)
 * @returns Array of connection storageIds (clusterIds)
 */
export async function enumerateConnectionsInItems(
    items: StoredItem[],
    connectionType: ConnectionType,
): Promise<string[]> {
    const connectionIds: string[] = [];

    for (const item of items) {
        if (item.properties.type === ItemType.Connection) {
            connectionIds.push(item.id);
        } else if (item.properties.type === ItemType.Folder) {
            const folderConnectionIds = await enumerateConnectionsInFolder(item.id, connectionType);
            connectionIds.push(...folderConnectionIds);
        }
    }

    return connectionIds;
}

/**
 * Logs task conflict details to the output channel.
 *
 * @param headerMessage - The message to display before listing the tasks
 * @param tasks - Array of conflicting tasks to log
 */
export function logTaskConflicts(headerMessage: string, tasks: TaskInfo[]): void {
    ext.outputChannel.appendLog(headerMessage);
    for (const task of tasks) {
        ext.outputChannel.appendLog(` • ${task.taskName} (${task.taskType})`);
    }
    ext.outputChannel.appendLog(l10n.t('Please stop these tasks first before proceeding.'));
}
