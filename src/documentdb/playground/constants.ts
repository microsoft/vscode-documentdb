/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Language ID registered in package.json for `.documentdb.js` files.
 */
export const PLAYGROUND_LANGUAGE_ID = 'documentdb-playground';

/**
 * Primary file extension for query playground files.
 * Uses `.js` suffix so the TypeScript language service recognizes them as JavaScript
 * and provides IntelliSense (completions, hover, signature help) automatically.
 */
export const PLAYGROUND_FILE_EXTENSION = '.documentdb.js';

/**
 * Command IDs for query playground features.
 */
export const PlaygroundCommandIds = {
    /** Create a new query playground file and optionally connect */
    new: 'vscode-documentdb.command.playground.new',
    /** Create a new query playground with pre-formatted content and explicit connection */
    newWithContent: 'vscode-documentdb.command.playground.new.withContent',
    /** Show connection info for the active playground (info notification) */
    showConnectionInfo: 'vscode-documentdb.command.playground.showConnectionInfo',
    /** Run the entire query playground file */
    runAll: 'vscode-documentdb.command.playground.runAll',
    /** Run the selection or the statement at the cursor */
    runSelected: 'vscode-documentdb.command.playground.runSelected',
    /** Sample documents from a collection to discover field names */
    scanCollectionSchema: 'vscode-documentdb.command.playground.scanCollectionSchema',
    /** Open the current code block in Collection View */
    openQueryInCollectionView: 'vscode-documentdb.command.playground.openQueryInCollectionView',
    /** Open the current code block in Interactive Shell */
    openQueryInShell: 'vscode-documentdb.command.playground.openQueryInShell',
} as const;
