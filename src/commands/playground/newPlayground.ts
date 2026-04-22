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
import { PLAYGROUND_FILE_EXTENSION, PLAYGROUND_LANGUAGE_ID } from '../../documentdb/playground/constants';
import { type PlaygroundConnection } from '../../documentdb/playground/types';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';
import { escapeJsString } from '../../utils/escapeJsString';

/**
 * Creates a new Query Playground file.
 *
 * When invoked from a tree node (database or collection), the playground
 * is permanently bound to that node's cluster/database connection.
 * Each new playground gets its own connection — multiple playgrounds can
 * be open simultaneously, each connected to different servers.
 */
export async function newPlayground(context: IActionContext, node?: DatabaseItem | CollectionItem): Promise<void> {
    if (!node) {
        void vscode.window.showInformationMessage(
            l10n.t('Right-click a database or collection in the DocumentDB panel to create a new Query Playground.'),
        );
        return;
    }

    // ── Telemetry: activation source & context ───────────────────────
    context.telemetry.properties.activationSource ??= 'treeNode';
    context.telemetry.properties.nodeType = isCollectionItem(node) ? 'collection' : 'database';
    context.telemetry.properties.viewId = node.cluster.viewId ?? 'unknown';
    context.telemetry.properties.experience = node.experience.api;

    // Build template — customize when launched from a collection node
    const collectionName = isCollectionItem(node) ? escapeJsString(node.collectionInfo.name) : 'collectionName';
    const headerComment = `// Query Playground: ${node.cluster.name}`;

    const template = [
        headerComment,
        '//',
        `// Use ${modifierKey}+Enter to run the current block or ${modifierKey}+Shift+Enter to run the entire file`,
        '// Note: when running multiple statements, only the last result is displayed',
        '',
        `db.getCollection('${collectionName}').find({ })`,
        '',
    ].join('\n');

    await createPlaygroundWithContent(template, {
        clusterId: node.cluster.clusterId,
        clusterDisplayName: node.cluster.name,
        databaseName: node.databaseInfo.name,
        viewId: node.cluster.viewId,
    });
}

/**
 * Parameters for creating a playground with pre-formatted content.
 * Used by cross-feature navigation links (Collection View → Playground, Shell → Playground).
 */
export interface NewPlaygroundWithContentParams {
    readonly clusterId: string;
    readonly clusterDisplayName: string;
    readonly databaseName: string;
    readonly content: string;
    readonly viewId?: string;
}

/**
 * Creates a new Query Playground file with the given content and connection.
 *
 * Unlike {@link newPlayground}, this does not require a tree node — it accepts
 * an explicit connection and content string. Used by cross-feature navigation
 * (e.g., opening a query from Collection View or Interactive Shell in a playground).
 */
export async function newPlaygroundWithContent(
    context: IActionContext,
    params?: NewPlaygroundWithContentParams,
): Promise<void> {
    if (!params) {
        return;
    }

    // ── Telemetry: cross-feature activation ──────────────────────────
    context.telemetry.properties.activationSource = 'crossFeature';

    const template = [
        `// Query Playground: ${params.clusterDisplayName}`,
        '//',
        `// Use ${modifierKey}+Enter to run the current block or ${modifierKey}+Shift+Enter to run the entire file`,
        '// Note: when running multiple statements, only the last result is displayed',
        '',
        params.content,
        '',
    ].join('\n');

    await createPlaygroundWithContent(template, {
        clusterId: params.clusterId,
        clusterDisplayName: params.clusterDisplayName,
        databaseName: params.databaseName,
        viewId: params.viewId,
    });
}

/**
 * Shared logic for creating an untitled playground document and binding its connection.
 */
async function createPlaygroundWithContent(content: string, connection: PlaygroundConnection): Promise<void> {
    const service = PlaygroundService.getInstance();

    // Create untitled file with a workspace-relative path so VS Code's hot exit
    // can persist the content across restarts. Without a real-looking path,
    // untitled documents lose their content on relaunch.
    const numberUntitledPlaygrounds = vscode.workspace.textDocuments.filter(
        (doc) => doc.languageId === PLAYGROUND_LANGUAGE_ID,
    ).length;
    const fileName = `playground-${numberUntitledPlaygrounds + 1}${PLAYGROUND_FILE_EXTENSION}`;
    const folderPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.tmpdir();
    const filePath = path.join(folderPath, fileName);
    const uri = vscode.Uri.file(filePath).with({ scheme: 'untitled' });
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(0, 0), content);
    await vscode.workspace.applyEdit(edit);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true });

    // Bind connection to this specific document
    service.setConnection(doc.uri, connection);
}

function isCollectionItem(node: DatabaseItem | CollectionItem | undefined): node is CollectionItem {
    return node !== undefined && 'collectionInfo' in node;
}
