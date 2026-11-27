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
import { detectBlocks, resolveBlockAtLine } from '../../documentdb/playground/statementDetector';
import { Views } from '../../documentdb/Views';
import { parsePlaygroundInvocation, resolvePlaygroundEditor } from './playgroundInvocation';

/**
 * Opens the current playground code block in Collection View.
 *
 * Extracts the collection name from the code block, then opens
 * the Collection View for that database/collection.
 *
 * Arguments: [uri: vscode.Uri, startLine: number, endLine: number]
 */
export async function playgroundOpenQueryInCollectionView(
    context: IActionContext,
    ...args: unknown[]
): Promise<void> {
    const invocation = parsePlaygroundInvocation(args);
    context.telemetry.properties.activationSource = invocation.activationSource;

    const editor = resolvePlaygroundEditor(invocation.uri);
    if (!editor) {
        void vscode.window.showInformationMessage(l10n.t('No code to run. Place the cursor in a code block.'));
        return;
    }

    const service = PlaygroundService.getInstance();
    const connection = service.getConnection(editor.document.uri);

    if (!connection) {
        void vscode.window.showWarningMessage(l10n.t('This playground has no connection.'));
        return;
    }

    const range =
        invocation.range ??
        resolveBlockAtLine(detectBlocks(editor.document), editor.selection.active.line)?.block;
    if (!range) {
        void vscode.window.showInformationMessage(l10n.t('No code to run. Place the cursor in a code block.'));
        return;
    }
    const blockText = editor.document.getText(new vscode.Range(range.startLine, 0, range.endLine + 1, 0));
    const collectionName = extractCollectionName(blockText);

    if (!collectionName) {
        void vscode.window.showWarningMessage(l10n.t('Could not detect a collection name in this code block.'));
        return;
    }

    // Try to extract filter/project/sort from the code block for a richer handoff
    const parsed = parseFindExpression(blockText);

    context.telemetry.properties.hasFilter = parsed.filter ? 'true' : 'false';

    try {
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
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(l10n.t('Failed to open Collection View: {0}', errorMessage));
    }
}
