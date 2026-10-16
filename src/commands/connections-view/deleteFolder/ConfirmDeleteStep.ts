/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { getConfirmationAsInSettings } from '../../../utils/dialogs/getConfirmation';
import { type DeleteFolderWizardContext } from './DeleteFolderWizardContext';

/**
 * Step to confirm the folder deletion operation.
 * Shows a confirmation dialog with count of items to be deleted.
 */
export class ConfirmDeleteStep extends AzureWizardPromptStep<DeleteFolderWizardContext> {
    public async prompt(context: DeleteFolderWizardContext): Promise<void> {
        // Build a message showing what will be deleted
        const parts: string[] = [];

        if (context.foldersToDelete > 1) {
            parts.push(l10n.t('{0} subfolders', (context.foldersToDelete - 1).toString()));
        }
        if (context.connectionsToDelete > 0) {
            parts.push(l10n.t('{0} connections', context.connectionsToDelete.toString()));
        }

        let confirmMessage = l10n.t('Delete folder "{folderName}"?', { folderName: context.folderItem.name });

        if (parts.length > 0) {
            confirmMessage += '\n' + l10n.t('This will also delete {0}.', parts.join(l10n.t(' and ')));
        }

        confirmMessage += '\n' + l10n.t('This cannot be undone.');

        const confirmed = await getConfirmationAsInSettings(l10n.t('Are you sure?'), confirmMessage, 'delete');

        if (!confirmed) {
            throw new UserCancelledError();
        }

        context.confirmed = true;
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
