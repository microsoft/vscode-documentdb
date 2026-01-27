/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { ext } from '../../extensionVariables';
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
 * Represents a tree ID prefix to match against task resources.
 * - For folders: prefix ends with '/' to match all descendants
 * - For connections: prefix is exact tree ID to match
 */
export interface TreeIdPrefix {
    /** The tree ID prefix string */
    prefix: string;
    /** Whether this is a folder (matches descendants) or connection (exact match) */
    isFolder: boolean;
}

/**
 * Finds all tasks that conflict with the given tree ID prefixes.
 *
 * For folders (prefix ends with '/'), matches any connection whose tree ID starts with the prefix.
 * For connections, matches the exact tree ID.
 *
 * @param prefixes - Array of tree ID prefixes to check against running tasks
 * @returns Array of conflicting tasks (deduplicated by taskId)
 */
export function findConflictingTasks(prefixes: TreeIdPrefix[]): TaskInfo[] {
    const conflictingTasks: TaskInfo[] = [];
    const addedTaskIds = new Set<string>();

    // Get all resources currently used by running tasks
    const allUsedResources = TaskService.getAllUsedResources();
    if (allUsedResources.length === 0) {
        return [];
    }

    for (const { task, resources } of allUsedResources) {
        if (addedTaskIds.has(task.taskId)) {
            continue;
        }

        for (const resource of resources) {
            if (!resource.connectionId) {
                continue;
            }

            // Check if this connection matches any of our prefixes
            const isAffected = prefixes.some(({ prefix, isFolder }) => {
                if (isFolder) {
                    // For folders, check if connectionId starts with prefix (which includes trailing '/')
                    return resource.connectionId!.startsWith(prefix);
                }
                // For connections, check exact match
                return resource.connectionId === prefix;
            });

            if (isAffected) {
                conflictingTasks.push(task);
                addedTaskIds.add(task.taskId);
                break;
            }
        }
    }

    return conflictingTasks;
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
    ext.outputChannel.show();
}
