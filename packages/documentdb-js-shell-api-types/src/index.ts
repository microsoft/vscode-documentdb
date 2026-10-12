/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @documentdb-js/shell-api-types
 *
 * Shell API type definitions and method-to-command mapping for DocumentDB
 * query playground IntelliSense. This package provides:
 *
 *   1. The `.d.ts` content as a string for tooling to inject type declarations.
 *      The extension's TS Server Plugin reads its copied declarations directly.
 *   2. A method registry mapping each shell method to its underlying server
 *      command(s) — used for compatibility verification.
 *   3. A verification script (`npm run verify`) that checks the method
 *      registry against the official DocumentDB compatibility documentation.
 */

// Types
export type { ShellMethodEntry } from './types.js';

// Method registry
export { SHELL_API_METHODS, getMethodsByTarget, getRequiredServerCommands } from './methodRegistry.js';

// .d.ts content — loaded lazily on first access
import * as fs from 'fs';
import * as path from 'path';

const dtsContentByPath = new Map<string, string>();

/**
 * Returns the full content of the DocumentDB shell API `.d.ts` file.
 * The content is read from disk once per resolved file path and cached in memory.
 * @param typeDefsDirectory Directory containing `documentdb-shell-api.d.ts`.
 * Defaults to the published package's `typeDefs/` next to `dist/`. Bundled callers
 * can pass their output root's `typeDefs/` directory explicitly.
 */
export function getShellApiDtsContent(
    typeDefsDirectory: string = path.join(import.meta.dirname, '..', 'typeDefs'),
): string {
    const dtsPath = path.resolve(typeDefsDirectory, 'documentdb-shell-api.d.ts');
    let dtsContent = dtsContentByPath.get(dtsPath);
    if (dtsContent === undefined) {
        dtsContent = fs.readFileSync(dtsPath, 'utf8');
        dtsContentByPath.set(dtsPath, dtsContent);
    }
    return dtsContent;
}
