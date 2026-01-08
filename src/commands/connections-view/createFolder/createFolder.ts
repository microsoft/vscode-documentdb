/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../../extensionVariables';
import { ConnectionType } from '../../../services/connectionStorageService';
import { type FolderItem } from '../../../tree/connections-view/FolderItem';
import { type LocalEmulatorsItem } from '../../../tree/connections-view/LocalEmulators/LocalEmulatorsItem';
import { type TreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';
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
    let parentTreeId: string | undefined;
    let parentName: string | undefined;

    if (parentFolder) {
        // Check if it's a LocalEmulatorsItem by inspecting contextValue
        const contextValue = (parentFolder as TreeElementWithContextValue).contextValue;
        if (contextValue?.includes('treeItem_LocalEmulators')) {
            // Creating a folder under LocalEmulators
            connectionType = ConnectionType.Emulators;
            parentFolderId = undefined; // LocalEmulatorsItem doesn't have a storageId, folders under it are root-level in Emulators
            parentTreeId = parentFolder.id; // Store tree ID for reveal path
            parentName = 'DocumentDB Local';
        } else if ('connectionType' in parentFolder) {
            // It's a FolderItem with connectionType property
            connectionType = (parentFolder as FolderItem).connectionType;
            parentFolderId = (parentFolder as FolderItem).storageId;
            parentTreeId = parentFolder.id; // Store tree ID for reveal path
            parentName = (parentFolder as FolderItem).name;
        } else {
            // Fallback to Clusters if we can't determine
            connectionType = ConnectionType.Clusters;
            parentFolderId = undefined;
            parentTreeId = undefined;
        }
    } else {
        // Root-level folder creation defaults to Clusters
        connectionType = ConnectionType.Clusters;
        parentFolderId = undefined;
        parentTreeId = undefined;
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
        parentTreeId: parentTreeId,
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
}

/**
 * Command to create a new folder in the connections view.
 * Invoked from the connections view navigation area.
 * Always creates a root-level folder in the Clusters section.
 */
export async function createFolder(context: IActionContext): Promise<void> {
    // Navigation button always creates at root level of Clusters
    await executeCreateFolderWizard(context, undefined);
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
