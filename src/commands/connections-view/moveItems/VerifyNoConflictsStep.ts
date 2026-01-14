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
import { ConnectionStorageService } from '../../../services/connectionStorageService';
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
 * Step to verify there are no naming conflicts BEFORE attempting the move.
 * If conflicts are found, the user is informed and can only go back or exit.
 * No rename/skip/continue options are offered - the system is intentionally simple.
 */
export class VerifyNoConflictsStep extends AzureWizardPromptStep<MoveItemsWizardContext> {
    public async prompt(context: MoveItemsWizardContext): Promise<void> {
        try {
            // Use QuickPick with loading state while checking for conflicts
            const result = await context.ui.showQuickPick(this.verifyNoConflicts(context), {
                placeHolder: l10n.t('Verifying move operation…'),
                loadingPlaceHolder: l10n.t('Checking for naming conflicts…'),
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
     * Async function that verifies no naming conflicts exist.
     * If no conflicts: throws VerificationCompleteError to proceed.
     * If conflicts: returns options for user to go back or exit.
     */
    private async verifyNoConflicts(context: MoveItemsWizardContext): Promise<IAzureQuickPickItem<ConflictAction>[]> {
        // Check for name conflicts in target folder
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

        // If no conflicts, signal completion and proceed
        if (context.conflictingNames.length === 0) {
            throw new VerificationCompleteError();
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

        // Return options for user - show count only (details in output channel)
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
