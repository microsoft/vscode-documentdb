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
import { type PlaygroundConnection } from '../../documentdb/playground/types';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';
import { escapeJsString } from '../../utils/escapeJsString';

interface PlaygroundFileNameContext {
    readonly clusterDisplayName: string;
    readonly databaseOrCollectionName: string;
}

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

    await createPlaygroundWithContent(
        template,
        {
            clusterId: node.cluster.clusterId,
            clusterDisplayName: node.cluster.name,
            databaseName: node.databaseInfo.name,
            viewId: node.cluster.viewId,
        },
        {
            clusterDisplayName: node.cluster.name,
            databaseOrCollectionName: isCollectionItem(node) ? node.collectionInfo.name : node.databaseInfo.name,
        },
    );
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
async function createPlaygroundWithContent(
    content: string,
    connection: PlaygroundConnection,
    fileNameContext?: PlaygroundFileNameContext,
): Promise<void> {
    const service = PlaygroundService.getInstance();

    // Create untitled file with a workspace-relative path so VS Code's hot exit
    // can persist the content across restarts. Without a real-looking path,
    // untitled documents lose their content on relaunch.
    const fileName = createPlaygroundFileName(vscode.workspace.textDocuments, fileNameContext);
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

export function createPlaygroundFileName(
    textDocuments: readonly vscode.TextDocument[],
    context?: PlaygroundFileNameContext,
): string {
    // Dedup against ALL open documents (not just playgrounds): VS Code rejects
    // applyEdit on an untitled URI that already exists, regardless of language.
    const existingFileNames = new Set(textDocuments.map(getTextDocumentFileName).filter(Boolean));

    const contextualBaseName = context
        ? [sanitizeFileNamePart(context.clusterDisplayName), sanitizeFileNamePart(context.databaseOrCollectionName)]
              .filter(Boolean)
              .join('_')
        : '';

    if (contextualBaseName) {
        return findFreeFileName(contextualBaseName, existingFileNames, { startSuffix: 2, suffixFirst: false });
    }

    return findFreeFileName('playground', existingFileNames, { startSuffix: 1, suffixFirst: true });
}

/**
 * Returns the first `${base}${ext}` (or `${base}-${N}${ext}`) name not present in `existing`.
 * When `suffixFirst` is true, always starts with a numeric suffix (e.g. `playground-1`).
 */
function findFreeFileName(
    base: string,
    existing: ReadonlySet<string>,
    options: { startSuffix: number; suffixFirst: boolean },
): string {
    if (!options.suffixFirst) {
        const unsuffixed = `${base}${PLAYGROUND_FILE_EXTENSION}`;
        if (!existing.has(unsuffixed)) {
            return unsuffixed;
        }
    }

    let suffix = options.startSuffix;
    // Loop is bounded by the number of open documents + 1, so termination is guaranteed.
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const candidate = `${base}-${suffix}${PLAYGROUND_FILE_EXTENSION}`;
        if (!existing.has(candidate)) {
            return candidate;
        }
        suffix += 1;
    }
}

function sanitizeFileNamePart(value: string): string {
    return replaceControlCharacters(value)
        .replace(/[<>:"/\\|?*]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function replaceControlCharacters(value: string): string {
    return [...value].map((char) => (char.charCodeAt(0) < 32 ? '-' : char)).join('');
}

function getTextDocumentFileName(doc: vscode.TextDocument): string {
    const fileName = doc.uri.fsPath || doc.fileName || doc.uri.path;
    return path.basename(fileName.replace(/\\/g, '/'));
}
