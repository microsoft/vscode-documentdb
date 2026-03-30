/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @vscode-documentdb/shell-api-types
 *
 * Shell API type definitions and method-to-command mapping for DocumentDB
 * scratchpad IntelliSense. This package provides:
 *
 *   1. The `.d.ts` content as a string — used by the TS Server Plugin to
 *      inject type declarations into scratchpad files.
 *   2. A method registry mapping each shell method to its underlying server
 *      command(s) — used for compatibility verification.
 *   3. A verification script (`npm run verify`) that checks the method
 *      registry against the official DocumentDB compatibility documentation.
 */

// Types
export type { ShellMethodEntry } from './types';

// Method registry
export { getMethodsByTarget, getRequiredServerCommands, SHELL_API_METHODS } from './methodRegistry';

// .d.ts content — loaded lazily on first access
import * as fs from 'fs';
import * as path from 'path';

let _dtsContent: string | undefined;

/**
 * Returns the full content of the DocumentDB shell API `.d.ts` file.
 * The content is read from disk once and cached in memory.
 */
export function getShellApiDtsContent(): string {
    if (_dtsContent === undefined) {
        const dtsPath = path.join(__dirname, '..', 'typeDefs', 'documentdb-shell-api.d.ts');
        _dtsContent = fs.readFileSync(dtsPath, 'utf8');
    }
    return _dtsContent;
}
