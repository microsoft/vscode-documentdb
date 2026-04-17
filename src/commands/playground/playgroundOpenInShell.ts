/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { PlaygroundService } from '../../documentdb/playground/PlaygroundService';

/**
 * Opens the current playground code block in an Interactive Shell.
 *
 * Gets the code block text, then opens a new shell with that text
 * pre-filled in the input line (not executed).
 *
 * Arguments: [uri: vscode.Uri, startLine: number, endLine: number]
 */
export async function playgroundOpenInShell(
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
    const blockText = document.getText(new vscode.Range(startLine, 0, endLine + 1, 0)).trim();

    if (!blockText) {
        return;
    }

    await vscode.commands.executeCommand('vscode-documentdb.command.openInteractiveShell.withInput', {
        clusterId: connection.clusterId,
        clusterDisplayName: connection.clusterDisplayName,
        databaseName: connection.databaseName,
        initialInput: blockText,
    });
}
