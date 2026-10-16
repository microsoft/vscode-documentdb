/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ConnectionType } from '../../../services/connectionStorageService';
import { type FolderItem } from '../../../tree/connections-view/FolderItem';
import { showConfirmationAsInSettings } from '../../../utils/dialogs/showConfirmation';
import { ConfirmDeleteStep } from './ConfirmDeleteStep';
import { type DeleteFolderWizardContext } from './DeleteFolderWizardContext';
import { ExecuteStep } from './ExecuteStep';
import { VerifyNoConflictsStep } from './VerifyNoConflictsStep';

/**
 * Command to delete a folder from the connections view.
 * Uses a wizard to:
 * 1. Verify no running tasks are using connections in the folder
 * 2. Prompt for confirmation
 * 3. Execute the deletion
 */
export async function deleteFolder(context: IActionContext, folderItem: FolderItem): Promise<void> {
    if (!folderItem) {
        throw new Error(l10n.t('No folder selected.'));
    }

    // Determine connection type - for now, use Clusters as default
    const connectionType = folderItem?.connectionType ?? ConnectionType.Clusters;

    // Set telemetry properties
    context.telemetry.properties.connectionType = connectionType;

    // Create wizard context with non-null/undefined initial values for back navigation support
    const wizardContext: DeleteFolderWizardContext = {
        ...context,
        folderItem: {
            id: folderItem.id,
            storageId: folderItem.storageId,
            name: folderItem.name,
        },
        connectionType,
        conflictingTasks: [],
        foldersToDelete: 0,
        connectionsToDelete: 0,
        confirmed: false,
        deletedFolders: 0,
        deletedConnections: 0,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Delete Folder'),
        promptSteps: [new VerifyNoConflictsStep(), new ConfirmDeleteStep()],
        executeSteps: [new ExecuteStep()],
    });

    await wizard.prompt();
    await wizard.execute();

    showConfirmationAsInSettings(l10n.t('The selected folder has been removed.'));
}
