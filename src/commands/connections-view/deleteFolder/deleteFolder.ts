/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { Views } from '../../../documentdb/Views';
import { ext } from '../../../extensionVariables';
import { ConnectionStorageService, ConnectionType, ItemType } from '../../../services/connectionStorageService';
import { type FolderItem } from '../../../tree/connections-view/FolderItem';
import { getConfirmationAsInSettings } from '../../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../../utils/dialogs/showConfirmation';
import { refreshView } from '../../refreshView/refreshView';

/**
 * Command to delete a folder from the connections view.
 * Prompts for confirmation before deletion.
 */
export async function deleteFolder(context: IActionContext, folderItem: FolderItem): Promise<void> {
    if (!folderItem) {
        throw new Error(l10n.t('No folder selected.'));
    }

    // Determine connection type - for now, use Clusters as default
    // TODO: This should be retrieved from the folder item
    const connectionType = ConnectionType.Clusters;

    // Recursively get all descendants (folders and connections)
    async function getAllDescendantsRecursive(parentId: string): Promise<{ id: string; type: ItemType }[]> {
        const children = await ConnectionStorageService.getChildren(parentId, connectionType);
        const descendants: { id: string; type: ItemType }[] = [];

        for (const child of children) {
            descendants.push({ id: child.id, type: child.properties.type });
            
            // Recursively get descendants of folders
            if (child.properties.type === ItemType.Folder) {
                const childDescendants = await getAllDescendantsRecursive(child.id);
                descendants.push(...childDescendants);
            }
        }

        return descendants;
    }

    const allDescendants = await getAllDescendantsRecursive(folderItem.storageId);
    
    const childFolders = allDescendants.filter((item) => item.type === ItemType.Folder);
    const connectionsInFolder = allDescendants.filter((item) => item.type === ItemType.Connection);

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
        // Delete all descendants (connections and child folders)
        for (const item of allDescendants) {
            await ConnectionStorageService.delete(connectionType, item.id);
        }

        // Delete the folder itself
        await ConnectionStorageService.delete(connectionType, folderItem.storageId);
    });

    await refreshView(context, Views.ConnectionsView);

    showConfirmationAsInSettings(l10n.t('The selected folder has been removed.'));
}
