/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { Views } from '../../../documentdb/Views';
import { ext } from '../../../extensionVariables';
import { ConnectionType } from '../../../services/connectionStorageService';
import { type FolderItem } from '../../../tree/connections-view/FolderItem';
import { refreshView } from '../../refreshView/refreshView';
import { type CreateFolderWizardContext } from './CreateFolderWizardContext';
import { ExecuteStep } from './ExecuteStep';
import { PromptFolderNameStep } from './PromptFolderNameStep';

/**
 * Command to create a new folder in the connections view.
 * Can be invoked from the connections view header or from a folder's context menu.
 */
export async function createFolder(context: IActionContext, parentFolder?: FolderItem): Promise<void> {
    // Heuristic check: When invoked from view title, VS Code may pass a stale selection
    // as parentFolder. Verify it matches the actual current selection.
    if (parentFolder && ext.connectionsTreeView?.selection) {
        const currentSelection = ext.connectionsTreeView.selection;

        // If there's no selection or the parentFolder doesn't match the first selected item,
        // it's likely a stale parameter from view title invocation
        if (currentSelection.length === 0 || currentSelection[0] !== parentFolder) {
            ext.outputChannel.trace(`[createFolder] Detected stale parentFolder parameter. Ignoring it.`);
            parentFolder = undefined; // Treat as root-level folder creation
        }
    }

    ext.outputChannel.trace(
        `[createFolder] invoked. Parent folder: ${parentFolder || parentFolder != undefined ? parentFolder.name : 'None (root level)'}`,
    );

    const wizardContext: CreateFolderWizardContext = {
        ...context,
        parentFolderId: parentFolder?.storageId,
        // Default to Clusters for root-level folders; use parent's type for subfolders
        connectionType: ConnectionType.Clusters, // TODO: This should be determined based on the parent or user selection
    };

    const wizard = new AzureWizard(wizardContext, {
        title: parentFolder
            ? l10n.t('Create New Folder in "{folderName}"', { folderName: parentFolder.name })
            : l10n.t('Create New Folder'),
        promptSteps: [new PromptFolderNameStep()],
        executeSteps: [new ExecuteStep()],
    });

    await wizard.prompt();
    await wizard.execute();

    // Refresh the connections view
    await refreshView(context, Views.ConnectionsView);
}
