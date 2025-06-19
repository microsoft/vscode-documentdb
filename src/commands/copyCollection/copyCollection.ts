/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';

export async function copyCollection(_context: IActionContext, node: CollectionItem): Promise<void> {
    if (!node) {
        throw new Error(vscode.l10n.t('No node selected.'));
    }
    // Store the node in extension variables
    ext.copiedCollectionNode = node;

    // Show confirmation message
    const collectionName = node.collectionInfo.name;
    const databaseName = node.databaseInfo.name;

    void vscode.window.showInformationMessage(
        vscode.l10n.t('Collection "{0}" from database "{1}" has been marked for copy.', collectionName, databaseName),
    );
}
