/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type ResourceDefinition } from '../services/resourceTracking';
import { TaskService } from '../services/taskService';

/**
 * Helper function to check if any running tasks are using a resource before allowing
 * a destructive operation (like deletion) to proceed.
 *
 * @param resource The resource to check for usage
 * @param operationName The name of the operation (e.g., "delete collection")
 * @returns Promise<boolean> - true if operation can proceed, false if blocked
 */
export async function checkResourceUsageBeforeOperation(
    resource: ResourceDefinition,
    operationName: string,
): Promise<boolean> {
    const usage = TaskService.checkResourceUsage(resource);

    if (usage.hasConflicts) {
        const taskList = usage.conflictingTasks.map((task) => `• ${task.taskName} (${task.taskType})`).join('\n');

        const resourceDescription = getResourceDescription(resource);

        const message = vscode.l10n.t(
            'Cannot {operationName} because the following tasks are currently using {resourceDescription}:\n\n{taskList}\n\nPlease stop these tasks first before proceeding.',
            {
                operationName,
                resourceDescription,
                taskList,
            },
        );

        await vscode.window.showWarningMessage(message);
        return false;
    }

    return true;
}

/**
 * Generates a human-readable description of a resource for use in user messages
 */
function getResourceDescription(resource: ResourceDefinition): string {
    if (resource.collectionName && resource.databaseName) {
        return vscode.l10n.t('collection "{0}" in database "{1}"', resource.collectionName, resource.databaseName);
    }

    if (resource.databaseName) {
        return vscode.l10n.t('database "{0}"', resource.databaseName);
    }

    if (resource.connectionId) {
        return vscode.l10n.t('connection "{0}"', resource.connectionId);
    }

    return vscode.l10n.t('this resource');
}
