/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ScratchpadService } from '../../documentdb/scratchpad/ScratchpadService';
import { SCRATCHPAD_FILE_EXTENSION } from '../../documentdb/scratchpad/constants';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';

/**
 * Creates a new DocumentDB Scratchpad file.
 *
 * When invoked from a tree node (database or collection), the scratchpad
 * connection is set to that node's cluster/database and the template
 * is pre-filled accordingly.
 */
export async function newScratchpad(_context: IActionContext, node?: DatabaseItem | CollectionItem): Promise<void> {
    const service = ScratchpadService.getInstance();

    // If invoked from a tree node, set the connection
    if (node) {
        service.setConnection({
            clusterId: node.cluster.clusterId,
            clusterDisplayName: node.cluster.name,
            databaseName: node.databaseInfo.name,
        });
    }

    // Build template — customize when launched from a collection node
    const collectionName = isCollectionItem(node) ? node.collectionInfo.name : 'collectionName';
    const headerComment = node
        ? `// DocumentDB Scratchpad — ${collectionName} @ ${node.cluster.name}/${node.databaseInfo.name}`
        : '// DocumentDB Scratchpad — Write and run DocumentDB API queries';

    const template = [
        headerComment,
        '// Use Ctrl+Enter (Cmd+Enter) to run the current block',
        '// Use Ctrl+Shift+Enter (Cmd+Shift+Enter) to run the entire file',
        '',
        `db.getCollection('${collectionName}').find({ })`,
        '',
    ].join('\n');

    // Create untitled file with a unique name to avoid reusing existing documents
    const timestamp = Date.now();
    const uri = vscode.Uri.from({ scheme: 'untitled', path: `scratchpad-${timestamp}${SCRATCHPAD_FILE_EXTENSION}` });
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(0, 0), template);
    await vscode.workspace.applyEdit(edit);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
}

function isCollectionItem(node: DatabaseItem | CollectionItem | undefined): node is CollectionItem {
    return node !== undefined && 'collectionInfo' in node;
}
