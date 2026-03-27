/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Language ID registered in package.json for `.documentdb.js` files.
 */
export const SCRATCHPAD_LANGUAGE_ID = 'documentdb-scratchpad';

/**
 * Primary file extension for scratchpad files.
 * Uses `.js` suffix so the TypeScript language service recognizes them as JavaScript
 * and provides IntelliSense (completions, hover, signature help) automatically.
 */
export const SCRATCHPAD_FILE_EXTENSION = '.documentdb.js';

/**
 * Command IDs for scratchpad features.
 */
export const ScratchpadCommandIds = {
    /** Create a new scratchpad file and optionally connect */
    new: 'vscode-documentdb.command.scratchpad.new',
    /** Set the active scratchpad connection from a tree node */
    connect: 'vscode-documentdb.command.scratchpad.connect',
    /** Run the entire scratchpad file */
    runAll: 'vscode-documentdb.command.scratchpad.runAll',
    /** Run the selection or the statement at the cursor */
    runSelected: 'vscode-documentdb.command.scratchpad.runSelected',
} as const;
