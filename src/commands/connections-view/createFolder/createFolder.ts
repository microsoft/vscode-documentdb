/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
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
 * Command to create a new folder in the connections view.
 * Can be invoked from the connections view header or from a folder's context menu.
 */
export async function createFolder(
    context: IActionContext,
    parentFolder?: FolderItem | LocalEmulatorsItem,
): Promise<void> {
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
        `[createFolder] invoked. Parent: ${parentName || 'None (root level)'}, ConnectionType: ${connectionType}`,
    );

    ext.outputChannel.trace(
        `[createFolder] invoked. Parent: ${parentName || 'None (root level)'}, ConnectionType: ${connectionType}`,
    );

    const wizardContext: CreateFolderWizardContext = {
        ...context,
        parentFolderId: parentFolderId,
        connectionType: connectionType,
        parentFolderName: parentName,
    };

    const wizard = new AzureWizard(wizardContext, {
        promptSteps: [new PromptFolderNameStep()],
        executeSteps: [new ExecuteStep()],
    });

    await wizard.prompt();
    await wizard.execute();

    // Refresh the connections view
    await refreshView(context, Views.ConnectionsView);
}
