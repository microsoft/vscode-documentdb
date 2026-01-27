/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, UserCancelledError, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ConnectionStorageService, ItemType } from '../../../services/connectionStorageService';
import { findConflictingTasks, logTaskConflicts, VerificationCompleteError } from '../verificationUtils';
import { type DeleteFolderWizardContext } from './DeleteFolderWizardContext';

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
export class VerifyNoConflictsStep extends AzureWizardPromptStep<DeleteFolderWizardContext> {
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
        // Count all folders and connections that will be deleted
        const counts = await this.countDescendants(context, context.folderItem.storageId);
        context.foldersToDelete = counts.folders + 1; // +1 for the folder itself
        context.connectionsToDelete = counts.connections;

        // Check for task conflicts using the folder's tree ID as prefix
        // Any connection inside the folder will have an ID starting with folderItem.id + "/"
        context.conflictingTasks = findConflictingTasks([{ prefix: context.folderItem.id + '/', isFolder: true }]);

        // If no conflicts, signal completion and proceed
        if (context.conflictingTasks.length === 0) {
            throw new VerificationCompleteError();
        }

        // Conflicts found - log details to output channel
        const conflictCount = context.conflictingTasks.length;
        logTaskConflicts(
            l10n.t(
                'Cannot delete folder "{0}". The following {1} task(s) are using connections within this folder:',
                context.folderItem.name,
                conflictCount.toString(),
            ),
            context.conflictingTasks,
        );

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
