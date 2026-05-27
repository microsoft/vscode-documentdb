/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { PLAYGROUND_LANGUAGE_ID } from '../../documentdb/playground/constants';
import { createPlaygroundFileName } from './newPlayground';

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
