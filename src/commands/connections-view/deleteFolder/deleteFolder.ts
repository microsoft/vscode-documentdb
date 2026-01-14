/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../../extensionVariables';
import { ConnectionStorageService, ConnectionType, ItemType } from '../../../services/connectionStorageService';
import {
    refreshParentInConnectionsView,
    withConnectionsViewProgress,
} from '../../../tree/connections-view/connectionsViewHelpers';
import { type FolderItem } from '../../../tree/connections-view/FolderItem';
import { getConfirmationAsInSettings } from '../../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../../utils/dialogs/showConfirmation';

/**
 * Command to delete a folder from the connections view.
 * Prompts for confirmation before deletion.
 */
export async function deleteFolder(_context: IActionContext, folderItem: FolderItem): Promise<void> {
    if (!folderItem) {
        throw new Error(l10n.t('No folder selected.'));
    }

    // Determine connection type - for now, use Clusters as default
    const connectionType = folderItem?.connectionType ?? ConnectionType.Clusters;

    const confirmMessage =
        l10n.t('Delete folder "{folderName}"?', { folderName: folderItem.name }) +
        '\n' +
        l10n.t('All subfolders and connections within this folder will also be deleted.') +
        '\n' +
        l10n.t('This cannot be undone.');

    const confirmed = await getConfirmationAsInSettings(l10n.t('Are you sure?'), confirmMessage, 'delete');

    if (!confirmed) {
        throw new UserCancelledError();
    }

    await withConnectionsViewProgress(async () => {
        await ext.state.showDeleting(folderItem.id, async () => {
            // Recursively delete all descendants
            async function deleteRecursive(parentId: string): Promise<void> {
                const children = await ConnectionStorageService.getChildren(parentId, connectionType);

                for (const child of children) {
                    // Recursively delete child folders first
                    if (child.properties.type === ItemType.Folder) {
                        await deleteRecursive(child.id);
                    }
                    // Delete the child item
                    await ConnectionStorageService.delete(connectionType, child.id);
                }
            }

            // Delete all descendants first
            await deleteRecursive(folderItem.storageId);

            // Delete the folder itself
            await ConnectionStorageService.delete(connectionType, folderItem.storageId);
        });

        refreshParentInConnectionsView(folderItem.id);
    });

    showConfirmationAsInSettings(l10n.t('The selected folder has been removed.'));
}
