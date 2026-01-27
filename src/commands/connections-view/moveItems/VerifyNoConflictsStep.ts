/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzureWizardPromptStep,
    GoBackError,
    UserCancelledError,
    type IAzureQuickPickItem,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../../extensionVariables';
import { ConnectionStorageService, ItemType } from '../../../services/connectionStorageService';
import { TaskService } from '../../../services/taskService/taskService';
import { buildFullTreePath } from '../../../tree/connections-view/connectionsViewHelpers';
import { type MoveItemsWizardContext } from './MoveItemsWizardContext';

/**
 * Custom error to signal that conflict verification completed with no conflicts
 */
class VerificationCompleteError extends Error {
    constructor() {
        super('Conflict verification completed successfully');
        this.name = 'VerificationCompleteError';
    }
}

type ConflictAction = 'back' | 'exit';

/**
 * Step to verify the move operation can proceed safely.
 * Checks for:
 * 1. Running tasks using any connections being moved (including descendants of folders)
 * 2. Naming conflicts in the target folder
 *
 * If conflicts are found, the user is informed and can go back or exit.
 */
export class VerifyNoConflictsStep extends AzureWizardPromptStep<MoveItemsWizardContext> {
    public async prompt(context: MoveItemsWizardContext): Promise<void> {
        try {
            // Use QuickPick with loading state while checking for conflicts
            const result = await context.ui.showQuickPick(this.verifyNoConflicts(context), {
                placeHolder: l10n.t('Verifying move operation…'),
                loadingPlaceHolder: l10n.t('Checking for conflicts…'),
                suppressPersistence: true,
            });

            // User selected an action (only shown when conflicts exist)
            if (result.data === 'back') {
                context.targetFolderId = undefined;
                context.targetFolderPath = undefined;
                throw new GoBackError();
            } else {
                throw new UserCancelledError();
            }
        } catch (error) {
            if (error instanceof VerificationCompleteError) {
                // Verification completed with no conflicts - proceed to confirmation
                return;
            }
            // Re-throw any other errors (including GoBackError, UserCancelledError)
            throw error;
        }
    }

    /**
     * Async function that verifies no conflicts exist (task or naming).
     * If no conflicts: throws VerificationCompleteError to proceed.
     * If conflicts: returns options for user to go back or exit.
     */
    private async verifyNoConflicts(context: MoveItemsWizardContext): Promise<IAzureQuickPickItem<ConflictAction>[]> {
        // First, check for task conflicts (connections being used by running tasks)
        const taskConflicts = await this.checkTaskConflicts(context);
        if (taskConflicts.length > 0) {
            return taskConflicts;
        }

        // Then, check for naming conflicts in target folder
        const namingConflicts = await this.checkNamingConflicts(context);
        if (namingConflicts.length > 0) {
            return namingConflicts;
        }

        // No conflicts - signal completion and proceed
        throw new VerificationCompleteError();
    }

    /**
     * Checks if any running tasks are using connections being moved.
     * Uses prefix matching on tree IDs - if a folder is being moved, any task using
     * a connection with a tree ID starting with the folder's tree ID is affected.
     */
    private async checkTaskConflicts(context: MoveItemsWizardContext): Promise<IAzureQuickPickItem<ConflictAction>[]> {
        context.conflictingTasks = [];

        // Get all resources currently used by running tasks
        const allUsedResources = TaskService.getAllUsedResources();
        if (allUsedResources.length === 0) {
            return [];
        }

        // Build tree ID prefixes for each item being moved
        const itemPrefixes: string[] = [];
        for (const item of context.itemsToMove) {
            const treeId = await buildFullTreePath(item.id, context.connectionType);
            // For folders, we need to match connections that start with "treeId/"
            // For connections, we need exact match (treeId itself)
            if (item.properties.type === ItemType.Folder) {
                itemPrefixes.push(treeId + '/');
            } else {
                itemPrefixes.push(treeId);
            }
        }

        // Check if any running task uses a connection being moved
        const addedTaskIds = new Set<string>();
        for (const { task, resources } of allUsedResources) {
            if (addedTaskIds.has(task.taskId)) {
                continue;
            }

            for (const resource of resources) {
                if (!resource.connectionId) {
                    continue;
                }

                // Check if this connection matches any of our items being moved
                const isAffected = itemPrefixes.some((prefix) => {
                    // For folders (prefix ends with '/'), check if connectionId starts with prefix
                    // For connections, check exact match
                    if (prefix.endsWith('/')) {
                        return resource.connectionId!.startsWith(prefix);
                    }
                    return resource.connectionId === prefix;
                });

                if (isAffected) {
                    context.conflictingTasks.push(task);
                    addedTaskIds.add(task.taskId);
                    break;
                }
            }
        }

        if (context.conflictingTasks.length === 0) {
            return [];
        }

        // Conflicts found - log details to output channel
        this.logTaskConflicts(context);

        // Return option for user - can only cancel (task conflicts cannot be resolved by going back)
        return [
            {
                label: l10n.t('$(close) Cancel'),
                description: l10n.t('Cancel this operation'),
                detail: l10n.t(
                    '{0} task(s) are using connections being moved. Check the Output panel for details.',
                    context.conflictingTasks.length.toString(),
                ),
                data: 'exit' as const,
            },
        ];
    }

    /**
     * Logs task conflict details to the output channel.
     */
    private logTaskConflicts(context: MoveItemsWizardContext): void {
        const conflictCount = context.conflictingTasks.length;
        const itemCount = context.itemsToMove.length;
        const itemWord = itemCount === 1 ? l10n.t('item') : l10n.t('items');

        ext.outputChannel.appendLog(
            l10n.t(
                'Cannot move {0} {1}. The following {2} task(s) are using connections being moved:',
                itemCount.toString(),
                itemWord,
                conflictCount.toString(),
            ),
        );
        for (const task of context.conflictingTasks) {
            ext.outputChannel.appendLog(` • ${task.taskName} (${task.taskType})`);
        }
        ext.outputChannel.appendLog(l10n.t('Please stop these tasks first before proceeding.'));
        ext.outputChannel.show();
    }

    /**
     * Checks for naming conflicts in the target folder.
     */
    private async checkNamingConflicts(
        context: MoveItemsWizardContext,
    ): Promise<IAzureQuickPickItem<ConflictAction>[]> {
        context.conflictingNames = [];

        for (const item of context.itemsToMove) {
            const hasConflict = await ConnectionStorageService.isNameDuplicateInParent(
                item.name,
                context.targetFolderId,
                context.connectionType,
                item.properties.type,
                item.id, // Exclude self
            );

            if (hasConflict) {
                context.conflictingNames.push(item.name);
            }
        }

        if (context.conflictingNames.length === 0) {
            return [];
        }

        // Conflicts found - log details to output channel
        const targetName = context.targetFolderPath ?? '/';
        const conflictCount = context.conflictingNames.length;

        ext.outputChannel.appendLog(
            l10n.t(
                'We found {0} naming conflict(s) in "{1}". To move these items, please rename them or choose a different folder:',
                conflictCount.toString(),
                targetName,
            ),
        );
        for (const name of context.conflictingNames) {
            ext.outputChannel.appendLog(` - ${name}`);
        }
        ext.outputChannel.show();

        // Return options for user - can go back to choose different folder
        return [
            {
                label: l10n.t('$(arrow-left) Go Back'),
                description: l10n.t('Choose a different folder'),
                detail: l10n.t(
                    '{0} item(s) already exist in the destination. Check the Output panel for details.',
                    conflictCount.toString(),
                ),
                data: 'back' as const,
            },
            {
                label: l10n.t('$(close) Cancel'),
                description: l10n.t('Cancel this operation'),
                data: 'exit' as const,
            },
        ];
    }

    public shouldPrompt(): boolean {
        // Always verify before moving
        return true;
    }
}
