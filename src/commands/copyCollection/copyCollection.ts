/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { l10n, window } from 'vscode';
import { ext } from '../../extensionVariables';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';

export async function copyCollection(_context: IActionContext, node: CollectionItem): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }
    // Store the node in extension variables
    ext.copiedCollectionNode = node;

    // Show confirmation message
    const collectionName = node.collectionInfo.name;
    const databaseName = node.databaseInfo.name;

    const undoCommand = l10n.t('Undo');

    const selectedCommand = await window.showInformationMessage(
        l10n.t(
            'Collection "{0}" from database "{1}" has been marked for copy. You can now paste this collection into any database or existing collection using the "Paste Collection..." option in the context menu.',
            collectionName,
            databaseName,
        ),
        l10n.t('OK'),
        undoCommand,
    );

    if (selectedCommand === undoCommand) {
        ext.copiedCollectionNode = undefined;
        void window.showInformationMessage(l10n.t('Copy operation cancelled.'));
    }
}
