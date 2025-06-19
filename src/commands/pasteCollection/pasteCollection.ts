/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';

export async function pasteCollection(_context: IActionContext, targetNode: CollectionItem): Promise<void> {
    const sourceNode = ext.copiedCollectionNode;
    if (!sourceNode) {
        void vscode.window.showWarningMessage(
            vscode.l10n.t('No collection has been marked for copy. Please use Copy Collection first.'),
        );
        return;
    }

    const sourceInfo = vscode.l10n.t(
        'Source: Collection "{0}" from database "{1}", connectionId: {2}',
        sourceNode.collectionInfo.name,
        sourceNode.databaseInfo.name,
        sourceNode.cluster.id,
    );
    const targetInfo = vscode.l10n.t(
        'Target: Collection "{0}" from database "{1}", connectionId: {2}',
        targetNode.collectionInfo.name,
        targetNode.databaseInfo.name,
        targetNode.cluster.id,
    );

    void vscode.window.showInformationMessage(`${sourceInfo}\n${targetInfo}`);
}
