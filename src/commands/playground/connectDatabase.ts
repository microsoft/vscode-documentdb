/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { PLAYGROUND_LANGUAGE_ID } from '../../documentdb/playground/constants';
import { PlaygroundService } from '../../documentdb/playground/PlaygroundService';

/**
 * Shows connection information for the active query playground document.
 * Invoked from the CodeLens on line 0 and from the status bar.
 */
export async function showConnectionInfo(_context: IActionContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== PLAYGROUND_LANGUAGE_ID) {
        return;
    }

    const service = PlaygroundService.getInstance();
    const connection = service.getConnection(editor.document.uri);

    if (connection) {
        void vscode.window.showInformationMessage(
            l10n.t('Connected to {0}/{1}', connection.clusterDisplayName, connection.databaseName),
        );
    } else {
        void vscode.window.showInformationMessage(
            l10n.t(
                'This playground has no connection. Create a new playground by right-clicking a database or collection in the DocumentDB panel.',
            ),
        );
    }
}
