/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { modifierKey } from '../../constants';
import { type DatabaseItemModel } from '../../documentdb/ClustersClient';
import { PLAYGROUND_LANGUAGE_ID } from '../../documentdb/playground/constants';
import { PlaygroundService } from '../../documentdb/playground/PlaygroundService';
import { DocumentDBExperience } from '../../DocumentDBExperiences';
import { DatabaseItem } from '../../tree/documentdb/DatabaseItem';
import { type BaseClusterModel, type TreeCluster } from '../../tree/models/BaseClusterModel';
import {
    buildPlaygroundHeader,
    createPlaygroundFileName,
    newPlayground,
    newPlaygroundWithContent,
} from './newPlayground';

function playgroundDocument(fileName: string): vscode.TextDocument {
    return {
        fileName,
        languageId: PLAYGROUND_LANGUAGE_ID,
        uri: {
            fsPath: fileName,
            path: fileName,
        },
    } as vscode.TextDocument;
}

function javascriptDocument(fileName: string): vscode.TextDocument {
    return {
        fileName,
        languageId: 'javascript',
        uri: {
            fsPath: fileName,
            path: fileName,
        },
    } as vscode.TextDocument;
}

describe('createPlaygroundFileName', () => {
    it('uses cluster and collection context when provided', () => {
        const fileName = createPlaygroundFileName([], {
            clusterDisplayName: 'my-cluster',
            databaseOrCollectionName: 'users',
        });

        expect(fileName).toBe('my-cluster_users.documentdb.js');
    });

    it('sanitizes invalid filename characters and whitespace', () => {
        const fileName = createPlaygroundFileName([], {
            clusterDisplayName: 'prod/eu:1',
            databaseOrCollectionName: 'orders 2026?',
        });

        expect(fileName).toBe('prod-eu-1_orders-2026.documentdb.js');
    });

    it('adds a numeric suffix when the contextual filename is already open', () => {
        const fileName = createPlaygroundFileName(
            [
                playgroundDocument('C:\\workspace\\my-cluster_users.documentdb.js'),
                playgroundDocument('C:\\workspace\\my-cluster_users-2.documentdb.js'),
                javascriptDocument('C:\\workspace\\my-cluster_users-3.documentdb.js'),
            ],
            {
                clusterDisplayName: 'my-cluster',
                databaseOrCollectionName: 'users',
            },
        );

        // Dedup checks ALL open documents (including non-playground) because VS Code rejects
        // applyEdit on an untitled URI that already exists, regardless of language.
        expect(fileName).toBe('my-cluster_users-4.documentdb.js');
    });

    it('falls back to generic numbering when context is missing', () => {
        const fileName = createPlaygroundFileName([
            playgroundDocument('C:\\workspace\\playground-1.documentdb.js'),
            playgroundDocument('C:\\workspace\\my-cluster_users.documentdb.js'),
        ]);

        expect(fileName).toBe('playground-2.documentdb.js');
    });

    it('skips taken slots in the generic fallback (counter cannot collide)', () => {
        const fileName = createPlaygroundFileName([
            playgroundDocument('C:\\workspace\\playground-1.documentdb.js'),
            playgroundDocument('C:\\workspace\\playground-3.documentdb.js'),
        ]);

        // playground-2 is free even though two playgrounds are open — old logic would have
        // produced playground-3 (a collision).
        expect(fileName).toBe('playground-2.documentdb.js');
    });

    it('falls back to generic numbering when context sanitizes to empty', () => {
        const fileName = createPlaygroundFileName([playgroundDocument('C:\\workspace\\playground-1.documentdb.js')], {
            clusterDisplayName: '///',
            databaseOrCollectionName: '***',
        });

        expect(fileName).toBe('playground-2.documentdb.js');
    });
});

describe('buildPlaygroundHeader', () => {
    let service: PlaygroundService | undefined;

    afterEach(() => {
        service?.dispose();
        vi.restoreAllMocks();
    });

    it('preserves shortcut guidance and adds palette and context-menu discovery', () => {
        expect(buildPlaygroundHeader('my-cluster')).toEqual([
            '// Query Playground: my-cluster',
            '//',
            `// Use ${modifierKey}+Enter to run the current block or ${modifierKey}+Shift+Enter to run the entire file`,
            '// Use the Command Palette (Query Playground) or the editor context menu for all actions.',
            '// Note: when running multiple statements, only the last result is displayed',
            '',
        ]);
    });

    it('uses the shared header for tree-node and provided-content playgrounds', async () => {
        const insertedContent: string[] = [];
        vi.spyOn(vscode.WorkspaceEdit.prototype, 'insert').mockImplementation(
            (_uri: vscode.Uri, _position: vscode.Position, content: string): void => {
                insertedContent.push(content);
            },
        );
        vi.spyOn(vscode.workspace, 'applyEdit').mockResolvedValue(true);
        vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({
            uri: vscode.Uri.file('playground.documentdb.js'),
        } as vscode.TextDocument);
        vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue({} as vscode.TextEditor);
        service = PlaygroundService.getInstance();
        const setConnection = vi.spyOn(service, 'setConnection').mockImplementation(() => undefined);

        const context = {
            telemetry: { properties: {}, measurements: {} },
        } as IActionContext;
        const cluster: TreeCluster<BaseClusterModel> = {
            clusterId: 'cluster-id',
            dbExperience: DocumentDBExperience,
            name: 'tree-cluster',
            treeId: 'cluster-id',
            viewId: 'connections',
        };
        const databaseInfo: DatabaseItemModel = { name: 'database' };
        const treeNode = new DatabaseItem(cluster, databaseInfo);

        await newPlayground(context, treeNode);
        await newPlaygroundWithContent(context, {
            clusterId: 'cluster-id',
            clusterDisplayName: 'content-cluster',
            databaseName: 'database',
            content: 'db.users.find({})',
        });

        expect(insertedContent).toHaveLength(2);
        expect(setConnection).toHaveBeenCalledTimes(2);
        expect(insertedContent[0]).toBe(
            [...buildPlaygroundHeader('tree-cluster'), "db.getCollection('collectionName').find({ })", ''].join('\n'),
        );
        expect(insertedContent[1]).toBe(
            [...buildPlaygroundHeader('content-cluster'), 'db.users.find({})', ''].join('\n'),
        );
    });
});
