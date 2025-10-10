/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { TaskService } from './taskService';
import { type ResourceDefinition } from './taskServiceResourceTracking';

/**
 * Helper function to check if any running tasks are using a resource before allowing
 * a destructive operation (like deletion) to proceed. Shows a modal warning to the user
 * if conflicts are found.
 *
 * @param resource The resource to check for usage
 * @param operationName The name of the operation (e.g., "delete collection")
 * @returns Promise<boolean> - true if operation can proceed, false if blocked
 */
export async function checkCanProceedAndInformUser(
    resource: ResourceDefinition,
    operationName: string,
): Promise<boolean> {
    const conflictingTasks = TaskService.getConflictingTasks(resource);

    if (conflictingTasks.length > 0) {
        const taskList = conflictingTasks.map((task) => ` • ${task.taskName} (${task.taskType})`).join('\n');

        const resourceDescription = getResourceDescription(resource);

        const title = vscode.l10n.t('Cannot {0}', operationName);
        const detail = vscode.l10n.t(
            'The following tasks are currently using {resourceDescription}:\n{taskList}\n\nPlease stop these tasks first before proceeding.',
            {
                resourceDescription,
                taskList,
            },
        );

        await vscode.window.showErrorMessage(title, { detail, modal: true });
        return false;
    }

    return true;
}

/**
 * Generates a human-readable description of a resource for use in user messages
 */
function getResourceDescription(resource: ResourceDefinition): string {
    if (resource.collectionName) {
        return vscode.l10n.t('collection "{0}"', resource.collectionName);
    }

    if (resource.databaseName) {
        return vscode.l10n.t('database "{0}"', resource.databaseName);
    }

    if (resource.connectionId) {
        return vscode.l10n.t('connection "{0}"', resource.connectionId);
    }

    return vscode.l10n.t('this resource');
}
