/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { openReadOnlyContent, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { findCommandAtPosition, getAllCommandsFromText } from '../../documentdb/scrapbook/ScrapbookHelpers';
import { ScrapbookService } from '../../documentdb/scrapbook/ScrapbookService';
import { withProgress } from '../../utils/withProgress';

export async function explainCommand(_context: IActionContext, position?: vscode.Position): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        throw new Error(l10n.t('You must open a *.vscode-documentdb-scrapbook file to explain commands.'));
    }

    if (!ScrapbookService.isConnected()) {
        throw new Error(l10n.t('Please connect to a MongoDB database before explaining a command.'));
    }

    const pos = position ?? editor.selection.start;

    const explainOperation = async (): Promise<void> => {
        const commands = getAllCommandsFromText(editor.document.getText());
        const command = findCommandAtPosition(commands, pos);

        if (!command) {
            throw new Error(l10n.t('No command found at the current position.'));
        }

        const clusterId = ScrapbookService.getClusterId();
        if (!clusterId) {
            throw new Error(l10n.t('No database connection found.'));
        }

        const client: ClustersClient = await ClustersClient.getClient(clusterId);
        const databaseName = ScrapbookService.getDatabaseName();

        if (!databaseName) {
            throw new Error(l10n.t('No database selected.'));
        }

        // For MVP, we'll use a hardcoded collection name as suggested in the issue
        // In practice, this would need to be extracted from the command or provided by user
        const collectionName = 'collection'; // Hardcoded as suggested in the issue

        const result = await client.explainQuery(databaseName, collectionName, command.text);

        const label = 'Scrapbook-explain-results';
        const fullId = `${ScrapbookService.getDisplayName()}/${label}`;

        await openReadOnlyContent({ label, fullId }, JSON.stringify(result, null, 2), '.json', {
            viewColumn: vscode.ViewColumn.Beside,
            preserveFocus: true,
        });
    };

    await withProgress(explainOperation(), l10n.t('Explaining the command…'));
}
