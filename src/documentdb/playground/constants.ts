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
    /** Set the active query playground connection from a tree node */
    connect: 'vscode-documentdb.command.playground.connect',
    /** Run the entire query playground file */
    runAll: 'vscode-documentdb.command.playground.runAll',
    /** Run the selection or the statement at the cursor */
    runSelected: 'vscode-documentdb.command.playground.runSelected',
    /** Sample documents from a collection to discover field names */
    scanCollectionSchema: 'vscode-documentdb.command.playground.scanCollectionSchema',
} as const;
