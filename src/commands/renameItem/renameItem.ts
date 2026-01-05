/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { DocumentDBClusterItem } from '../../tree/connections-view/DocumentDBClusterItem';
import { FolderItem } from '../../tree/connections-view/FolderItem';
import { type TreeElement } from '../../tree/TreeElement';
import { renameConnection } from '../renameConnection/renameConnection';
import { renameFolder } from '../renameFolder/renameFolder';

/**
 * Generic rename command that dispatches to the appropriate rename function
 * based on the selected item type (folder or connection).
 */
export async function renameItem(context: IActionContext, selectedItem?: TreeElement): Promise<void> {
    if (!selectedItem) {
        throw new Error(l10n.t('No item selected to rename.'));
    }

    if (selectedItem instanceof FolderItem) {
        await renameFolder(context, selectedItem);
    } else if (selectedItem instanceof DocumentDBClusterItem) {
        await renameConnection(context, selectedItem);
    } else {
        throw new Error(l10n.t('Selected item cannot be renamed.'));
    }
}
