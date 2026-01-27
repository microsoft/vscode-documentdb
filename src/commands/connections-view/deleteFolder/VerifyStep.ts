/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, UserCancelledError, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../../extensionVariables';
import { ConnectionStorageService, ItemType } from '../../../services/connectionStorageService';
import { TaskService } from '../../../services/taskService/taskService';
import { type DeleteFolderWizardContext } from './DeleteFolderWizardContext';

/**
 * Custom error to signal that conflict verification completed with no conflicts
 */
class VerificationCompleteError extends Error {
    constructor() {
        super('Conflict verification completed successfully');
        this.name = 'VerificationCompleteError';
    }
}

type ConflictAction = 'exit';

/**
 * Step to verify the folder can be deleted and count items to be deleted.
 * This step:
 * 1. Counts all folders and connections that will be deleted (for the confirmation dialog)
 * 2. Checks if any running tasks are using connections within the folder
 *
 * If conflicts are found, the user is informed and can only exit.
 * Uses a loading UI while checking.
 */
export class VerifyStep extends AzureWizardPromptStep<DeleteFolderWizardContext> {
    public async prompt(context: DeleteFolderWizardContext): Promise<void> {
        try {
            // Use QuickPick with loading state while verifying
            const result = await context.ui.showQuickPick(this.verifyAndCount(context), {
                placeHolder: l10n.t('Verifying folder can be deleted…'),
                loadingPlaceHolder: l10n.t('Analyzing folder contents…'),
                suppressPersistence: true,
            });

            // User selected an action (only shown when conflicts exist)
            if (result.data === 'exit') {
                throw new UserCancelledError();
            }
        } catch (error) {
            if (error instanceof VerificationCompleteError) {
                // Verification completed with no conflicts - proceed to confirmation
                return;
            }
            // Re-throw any other errors (including UserCancelledError)
            throw error;
        }
    }

    /**
     * Async function that counts folder contents and checks for task conflicts.
     * If no conflicts: throws VerificationCompleteError to proceed.
     * If conflicts: returns options for user to exit.
     */
    private async verifyAndCount(context: DeleteFolderWizardContext): Promise<IAzureQuickPickItem<ConflictAction>[]> {
        context.conflictingTasks = [];

        // Count all folders and connections that will be deleted
        const counts = await this.countDescendants(context, context.folderItem.storageId);
        context.foldersToDelete = counts.folders + 1; // +1 for the folder itself
        context.connectionsToDelete = counts.connections;

        // Get all resources used by active tasks
        const allUsedResources = TaskService.getAllUsedResources();

        // The folder's tree ID serves as a prefix for all connections within it
        // Connection tree IDs follow the pattern: parentTreeId/storageId
        // So any connection in this folder will have an ID starting with folderItem.id + "/"
        const folderTreeIdPrefix = context.folderItem.id + '/';

        // Check each task's resources to see if any connectionId starts with our folder prefix
        for (const { task, resources } of allUsedResources) {
            for (const resource of resources) {
                if (resource.connectionId && resource.connectionId.startsWith(folderTreeIdPrefix)) {
                    context.conflictingTasks.push(task);
                    break; // Only need to add task once, even if it uses multiple connections in the folder
                }
            }
        }

        // De-duplicate tasks (in case the same task was added multiple times)
        const uniqueTaskIds = new Set<string>();
        context.conflictingTasks = context.conflictingTasks.filter((task) => {
            if (uniqueTaskIds.has(task.taskId)) {
                return false;
            }
            uniqueTaskIds.add(task.taskId);
            return true;
        });

        // If no conflicts, signal completion and proceed
        if (context.conflictingTasks.length === 0) {
            throw new VerificationCompleteError();
        }

        // Conflicts found - log details to output channel
        const conflictCount = context.conflictingTasks.length;

        ext.outputChannel.appendLog(
            l10n.t(
                'Cannot delete folder "{0}". The following {1} task(s) are using connections within this folder:',
                context.folderItem.name,
                conflictCount.toString(),
            ),
        );
        for (const task of context.conflictingTasks) {
            ext.outputChannel.appendLog(` • ${task.taskName} (${task.taskType})`);
        }
        ext.outputChannel.appendLog(l10n.t('Please stop these tasks first before proceeding.'));
        ext.outputChannel.show();

        // Return option for user - can only cancel
        return [
            {
                label: l10n.t('$(close) Cancel'),
                description: l10n.t('Cancel this operation'),
                detail: l10n.t(
                    '{0} task(s) are using connections in this folder. Check the Output panel for details.',
                    conflictCount.toString(),
                ),
                data: 'exit' as const,
            },
        ];
    }

    public shouldPrompt(): boolean {
        // Always verify before deleting
        return true;
    }

    /**
     * Recursively count all descendants of a folder
     */
    private async countDescendants(
        context: DeleteFolderWizardContext,
        parentId: string,
    ): Promise<{ folders: number; connections: number }> {
        const children = await ConnectionStorageService.getChildren(parentId, context.connectionType);
        let folders = 0;
        let connections = 0;

        for (const child of children) {
            if (child.properties.type === ItemType.Folder) {
                folders++;
                const subCounts = await this.countDescendants(context, child.id);
                folders += subCounts.folders;
                connections += subCounts.connections;
            } else {
                connections++;
            }
        }

        return { folders, connections };
    }
}
