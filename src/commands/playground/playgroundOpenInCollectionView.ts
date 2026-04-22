/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { extractCollectionName } from '../../documentdb/playground/extractCollectionName';
import { parseFindExpression } from '../../documentdb/playground/parseFindExpression';
import { PlaygroundService } from '../../documentdb/playground/PlaygroundService';
import { Views } from '../../documentdb/Views';

/**
 * Opens the current playground code block in Collection View.
 *
 * Extracts the collection name from the code block, then opens
 * the Collection View for that database/collection.
 *
 * Arguments: [uri: vscode.Uri, startLine: number, endLine: number]
 */
export async function playgroundOpenInCollectionView(
    context: IActionContext,
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
        void vscode.window.showWarningMessage(l10n.t('Could not detect a collection name in this code block.'));
        return;
    }

    // Try to extract filter/project/sort from the code block for a richer handoff
    const parsed = parseFindExpression(blockText);

    // ── Telemetry: cross-feature navigation context ──────────────────
    context.telemetry.properties.activationSource = 'playgroundCodeLens';
    context.telemetry.properties.hasFilter = parsed.filter ? 'true' : 'false';

    await vscode.commands.executeCommand('vscode-documentdb.command.internal.containerView.open', {
        clusterId: connection.clusterId,
        clusterDisplayName: connection.clusterDisplayName,
        viewId: connection.viewId ?? Views.ConnectionsView,
        databaseName: connection.databaseName,
        collectionName,
        initialQuery: parsed.filter
            ? {
                  filter: parsed.filter,
                  project: parsed.project,
                  sort: parsed.sort,
                  skip: parsed.skip,
                  limit: parsed.limit,
              }
            : undefined,
    });
}
