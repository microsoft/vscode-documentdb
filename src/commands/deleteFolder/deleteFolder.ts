/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { ConnectionStorageService, ConnectionType } from '../../services/connectionStorageService';
import { FolderStorageService } from '../../services/folderStorageService';
import { type FolderItem } from '../../tree/connections-view/FolderItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { refreshView } from '../refreshView/refreshView';

/**
 * Command to delete a folder from the connections view.
 * Prompts for confirmation before deletion.
 */
export async function deleteFolder(context: IActionContext, folderItem: FolderItem): Promise<void> {
    if (!folderItem) {
        throw new Error(l10n.t('No folder selected.'));
    }

    // Check if folder has child folders
    const childFolders = await FolderStorageService.getChildren(folderItem.folderId);
    
    // Check if folder contains connections
    const allClusterConnections = await ConnectionStorageService.getAll(ConnectionType.Clusters);
    const allEmulatorConnections = await ConnectionStorageService.getAll(ConnectionType.Emulators);
    const allConnections = [...allClusterConnections, ...allEmulatorConnections];
    const connectionsInFolder = allConnections.filter(
        (connection) => connection.properties.folderId === folderItem.folderId,
    );

    let confirmMessage = l10n.t('Delete folder "{folderName}"?', { folderName: folderItem.name });
    
    if (childFolders.length > 0 || connectionsInFolder.length > 0) {
        const itemCount = childFolders.length + connectionsInFolder.length;
        confirmMessage += '\n' + l10n.t('This folder contains {count} item(s) which will also be deleted.', { count: itemCount });
    }
    
    confirmMessage += '\n' + l10n.t('This cannot be undone.');

    const confirmed = await getConfirmationAsInSettings(l10n.t('Are you sure?'), confirmMessage, 'delete');

    if (!confirmed) {
        throw new UserCancelledError();
    }

    await ext.state.showDeleting(folderItem.id, async () => {
        // Delete all connections in this folder and its subfolders
        const allFolderIds = await getAllDescendantFolderIds(folderItem.folderId);
        allFolderIds.push(folderItem.folderId);

        for (const connection of allConnections) {
            if (connection.properties.folderId && allFolderIds.includes(connection.properties.folderId)) {
                const connectionType = connection.properties.emulatorConfiguration?.isEmulator
                    ? ConnectionType.Emulators
                    : ConnectionType.Clusters;
                await ConnectionStorageService.delete(connectionType, connection.id);
            }
        }

        // Delete the folder (this will recursively delete child folders)
        await FolderStorageService.delete(folderItem.folderId);
    });

    await refreshView(context, Views.ConnectionsView);

    showConfirmationAsInSettings(l10n.t('The selected folder has been removed.'));
}

/**
 * Recursively get all descendant folder IDs
 */
async function getAllDescendantFolderIds(folderId: string): Promise<string[]> {
    const childFolders = await FolderStorageService.getChildren(folderId);
    const descendantIds: string[] = [];

    for (const child of childFolders) {
        descendantIds.push(child.id);
        const subDescendants = await getAllDescendantFolderIds(child.id);
        descendantIds.push(...subDescendants);
    }

    return descendantIds;
}
