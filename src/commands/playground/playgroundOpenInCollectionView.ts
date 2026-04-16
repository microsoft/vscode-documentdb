/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { Views } from '../../documentdb/Views';
import { extractCollectionName } from '../../documentdb/playground/extractCollectionName';
import { PlaygroundService } from '../../documentdb/playground/PlaygroundService';

/**
 * Opens the current playground code block in Collection View.
 *
 * Extracts the collection name from the code block, then opens
 * the Collection View for that database/collection.
 *
 * Arguments: [uri: vscode.Uri, startLine: number, endLine: number]
 */
export async function playgroundOpenInCollectionView(
    _context: IActionContext,
    uri?: vscode.Uri,
    startLine?: number,
    endLine?: number,
): Promise<void> {
    if (!uri || startLine === undefined || endLine === undefined) {
        return;
    }

    const service = PlaygroundService.getInstance();
    const connection = service.getConnection(uri);

    if (!connection) {
        void vscode.window.showWarningMessage(l10n.t('This playground has no connection.'));
        return;
    }

    const document = await vscode.workspace.openTextDocument(uri);
    const blockText = document.getText(new vscode.Range(startLine, 0, endLine + 1, 0));
    const collectionName = extractCollectionName(blockText);

    if (!collectionName) {
        void vscode.window.showWarningMessage(
            l10n.t('Could not detect a collection name in this code block.'),
        );
        return;
    }

    await vscode.commands.executeCommand('vscode-documentdb.command.internal.containerView.open', {
        clusterId: connection.clusterId,
        viewId: Views.ConnectionsView,
        databaseName: connection.databaseName,
        collectionName,
    });
}
