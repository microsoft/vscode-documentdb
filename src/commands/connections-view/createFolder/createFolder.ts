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
import { type LocalEmulatorsItem } from '../../../tree/connections-view/LocalEmulators/LocalEmulatorsItem';
import { type TreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';
import { refreshView } from '../../refreshView/refreshView';
import { type CreateFolderWizardContext } from './CreateFolderWizardContext';
import { ExecuteStep } from './ExecuteStep';
import { PromptFolderNameStep } from './PromptFolderNameStep';

/**
 * Shared helper function to execute the folder creation wizard.
 */
async function executeCreateFolderWizard(
    context: IActionContext,
    parentFolder: FolderItem | LocalEmulatorsItem | undefined,
): Promise<void> {
    // Determine connection type based on parent
    let connectionType: ConnectionType;
    let parentFolderId: string | undefined;
    let parentName: string | undefined;

    if (parentFolder) {
        // Check if it's a LocalEmulatorsItem by inspecting contextValue
        const contextValue = (parentFolder as TreeElementWithContextValue).contextValue;
        if (contextValue?.includes('treeItem_LocalEmulators')) {
            // Creating a folder under LocalEmulators
            connectionType = ConnectionType.Emulators;
            parentFolderId = undefined; // LocalEmulatorsItem doesn't have a storageId, folders under it are root-level in Emulators
            parentName = 'DocumentDB Local';
        } else if ('connectionType' in parentFolder) {
            // It's a FolderItem with connectionType property
            connectionType = (parentFolder as FolderItem).connectionType;
            parentFolderId = (parentFolder as FolderItem).storageId;
            parentName = (parentFolder as FolderItem).name;
        } else {
            // Fallback to Clusters if we can't determine
            connectionType = ConnectionType.Clusters;
            parentFolderId = undefined;
        }
    } else {
        // Root-level folder creation defaults to Clusters
        connectionType = ConnectionType.Clusters;
        parentFolderId = undefined;
    }

    ext.outputChannel.trace(
        `createFolder invoked. Parent: ${parentName || 'None (root level)'}, ConnectionType: ${connectionType}`,
    );

    const wizardTitle = parentName
        ? l10n.t('Create New Folder in "{folderName}"', { folderName: parentName })
        : l10n.t('Create New Folder');

    const wizardContext: CreateFolderWizardContext = {
        ...context,
        parentFolderId: parentFolderId,
        connectionType: connectionType,
        wizardTitle: wizardTitle,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: wizardTitle,
        promptSteps: [new PromptFolderNameStep()],
        executeSteps: [new ExecuteStep()],
    });

    await wizard.prompt();
    await wizard.execute();

    // Refresh the connections view
    await refreshView(context, Views.ConnectionsView);
}

/**
 * Command to create a new folder in the connections view.
 * Invoked from the connections view navigation area.
 * If a folder is selected, creates a subfolder; otherwise creates a root-level folder.
 */
export async function createFolder(
    context: IActionContext,
    parentFolder?: FolderItem | LocalEmulatorsItem,
): Promise<void> {
    // When invoked from navigation area, VS Code may pass a stale parentFolder parameter
    // Validate it against the current selection
    if (parentFolder && ext.connectionsTreeView?.selection) {
        const currentSelection = ext.connectionsTreeView.selection;
        // If there's no selection OR parentFolder doesn't match the first selected item, it's stale
        if (currentSelection.length === 0 || currentSelection[0] !== parentFolder) {
            ext.outputChannel.trace(`[createFolder] Detected stale parentFolder parameter. Ignoring it.`);
            parentFolder = undefined;
        }
    }

    await executeCreateFolderWizard(context, parentFolder);
}

/**
 * Command to create a subfolder within an existing folder.
 * Invoked from the folder's context menu (right-click).
 */
export async function createSubfolder(
    context: IActionContext,
    parentFolder: FolderItem | LocalEmulatorsItem,
): Promise<void> {
    if (!parentFolder) {
        throw new Error(l10n.t('No parent folder selected.'));
    }

    await executeCreateFolderWizard(context, parentFolder);
}
