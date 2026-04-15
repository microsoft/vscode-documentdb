/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { modifierKey } from '../../constants';
import { PlaygroundService } from '../../documentdb/playground/PlaygroundService';
import { PLAYGROUND_FILE_EXTENSION } from '../../documentdb/playground/constants';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';

/**
 * Creates a new Query Playground file.
 *
 * When invoked from a tree node (database or collection), the playground
 * is permanently bound to that node's cluster/database connection.
 * Each new playground gets its own connection — multiple playgrounds can
 * be open simultaneously, each connected to different servers.
 */
export async function newPlayground(_context: IActionContext, node?: DatabaseItem | CollectionItem): Promise<void> {
    if (!node) {
        void vscode.window.showInformationMessage(
            l10n.t('Right-click a database or collection in the DocumentDB panel to create a new Query Playground.'),
        );
        return;
    }

    const service = PlaygroundService.getInstance();

    // Build template — customize when launched from a collection node
    const collectionName = isCollectionItem(node) ? node.collectionInfo.name : 'collectionName';
    const headerComment = `// Query Playground: ${collectionName} @ ${node.cluster.name}/${node.databaseInfo.name}`;

    const template = [
        headerComment,
        '//',
        `// Use ${modifierKey}+Enter to run the current block or ${modifierKey}+Shift+Enter to run the entire file`,
        '// Note: when running multiple statements, only the last result is displayed',
        '',
        `db.getCollection('${collectionName}').find({ })`,
        '',
    ].join('\n');

    // Create untitled file with a workspace-relative path so VS Code's hot exit
    // can persist the content across restarts. Without a real-looking path,
    // untitled documents lose their content on relaunch.
    const now = new Date();
    const timestamp = now.toISOString().replace(/:/g, '-').replace(/\./g, '-').replace('T', '_').replace('Z', '');
    const fileName = `playground-${timestamp}${PLAYGROUND_FILE_EXTENSION}`;
    const folderPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.tmpdir();
    const filePath = path.join(folderPath, fileName);
    const uri = vscode.Uri.file(filePath).with({ scheme: 'untitled' });
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(0, 0), template);
    await vscode.workspace.applyEdit(edit);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true });

    // Bind connection to this specific document
    service.setConnection(doc.uri, {
        clusterId: node.cluster.clusterId,
        clusterDisplayName: node.cluster.name,
        databaseName: node.databaseInfo.name,
    });
}

function isCollectionItem(node: DatabaseItem | CollectionItem | undefined): node is CollectionItem {
    return node !== undefined && 'collectionInfo' in node;
}
