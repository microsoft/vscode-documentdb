/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { mergeStrings } from '../taskHost.js';
import { type TaskService } from '../taskService.js';
import { type ResourceDefinition } from '../taskServiceResourceTracking.js';

/**
 * User-facing strings of the conflict warning. Defaults are English; a consumer that localizes
 * passes its own values (decision 0006).
 */
export interface ResourceUsageStrings {
    /** Title of the modal warning, e.g. "Cannot delete this collection". */
    cannotProceed: (operationName: string) => string;
    /** Detail of the modal warning; `taskList` has one bullet line per conflicting task. */
    tasksUsingResource: (resourceDescription: string, taskList: string) => string;
    collectionDescription: (collectionName: string) => string;
    databaseDescription: (databaseName: string) => string;
    connectionDescription: (clusterId: string) => string;
    thisResource: string;
}

export const defaultResourceUsageStrings: ResourceUsageStrings = {
    cannotProceed: (operationName: string): string => `Cannot ${operationName}`,
    tasksUsingResource: (resourceDescription: string, taskList: string): string =>
        `The following tasks are currently using ${resourceDescription}:\n${taskList}\n\nPlease stop these tasks first before proceeding.`,
    collectionDescription: (collectionName: string): string => `collection "${collectionName}"`,
    databaseDescription: (databaseName: string): string => `database "${databaseName}"`,
    connectionDescription: (clusterId: string): string => `connection "${clusterId}"`,
    thisResource: 'this resource',
};

/**
 * Helper function to check if any running tasks are using a resource before allowing
 * a destructive operation (like deletion) to proceed. Shows a modal warning to the user
 * if conflicts are found.
 *
 * @param resource The resource to check for usage
 * @param operationName The name of the operation (e.g., "delete collection"), already localized
 * @param strings Overrides for the warning's strings; missing entries fall back to English
 * @returns Promise<boolean> - true if operation can proceed, false if blocked
 */
export async function checkCanProceedAndInformUser(
    taskService: TaskService,
    resource: ResourceDefinition,
    operationName: string,
    strings?: Partial<ResourceUsageStrings>,
): Promise<boolean> {
    const conflictingTasks = taskService.getConflictingTasks(resource);

    if (conflictingTasks.length > 0) {
        const merged = mergeStrings(defaultResourceUsageStrings, strings);
        const taskList = conflictingTasks.map((task) => ` • ${task.taskName} (${task.taskType})`).join('\n');

        const resourceDescription = getResourceDescription(resource, merged);

        const title = merged.cannotProceed(operationName);
        const detail = merged.tasksUsingResource(resourceDescription, taskList);

        await vscode.window.showErrorMessage(title, { detail, modal: true });
        return false;
    }

    return true;
}

/**
 * Generates a human-readable description of a resource for use in user messages
 */
function getResourceDescription(resource: ResourceDefinition, strings: ResourceUsageStrings): string {
    if (resource.collectionName) {
        return strings.collectionDescription(resource.collectionName);
    }

    if (resource.databaseName) {
        return strings.databaseDescription(resource.databaseName);
    }

    if (resource.clusterId) {
        return strings.connectionDescription(resource.clusterId);
    }

    return strings.thisResource;
}
