/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../../extensionVariables';
import { ConnectionType } from '../../../services/connectionStorageService';
import { type FolderItem } from '../../../tree/connections-view/FolderItem';
import { type LocalEmulatorsItem } from '../../../tree/connections-view/LocalEmulators/LocalEmulatorsItem';
import { type TreeElement } from '../../../tree/TreeElement';
import { type TreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';
import { newConnectionInClusterFolder } from '../../newConnection/newConnection';
import { newLocalConnectionInFolder } from '../../newLocalConnection/newLocalConnection';

/**
 * Command to create a new connection inside a folder.
 * Routes to the appropriate wizard based on the folder's connection type.
 * Also supports being invoked from an empty folder placeholder.
 */
export async function newConnectionInFolder(
    context: IActionContext,
    treeItem: FolderItem | LocalEmulatorsItem | TreeElement,
): Promise<void> {
    if (!treeItem) {
        throw new Error(l10n.t('No folder selected.'));
    }

    // If the tree item is an empty folder placeholder, get its parent folder
    const itemContextValue = 'contextValue' in treeItem ? treeItem.contextValue : undefined;
    let folder: FolderItem | LocalEmulatorsItem;
    if (itemContextValue?.includes('treeItem_emptyFolderPlaceholder')) {
        const parent = ext.connectionsBranchDataProvider.getParent(treeItem);
        if (!parent) {
            throw new Error(l10n.t('Could not find parent folder.'));
        }
        folder = parent as FolderItem | LocalEmulatorsItem;
    } else {
        folder = treeItem as FolderItem | LocalEmulatorsItem;
    }

    // Check if it's a LocalEmulatorsItem by inspecting contextValue
    const contextValue = (folder as TreeElementWithContextValue).contextValue;

    // Route to the appropriate wizard based on folder type
    // Note: Progress indicators should be added in the respective execute steps
    if (contextValue?.includes('treeItem_LocalEmulators')) {
        // LocalEmulatorsItem - create emulator connection
        await newLocalConnectionInFolder(context, folder as LocalEmulatorsItem);
    } else if ('connectionType' in folder) {
        // It's a FolderItem
        const folderItem = folder as FolderItem;

        if (folderItem.connectionType === ConnectionType.Emulators) {
            // Folder in emulators section - create emulator connection
            await newLocalConnectionInFolder(context, folderItem);
        } else {
            // Folder in clusters section - create cluster connection
            await newConnectionInClusterFolder(context, folderItem);
        }
    } else {
        throw new Error(l10n.t('Invalid folder type.'));
    }
}
