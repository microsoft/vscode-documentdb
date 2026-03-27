/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TypeScript Server Plugin for DocumentDB Scratchpad files.
 *
 * This plugin is loaded by VS Code's TypeScript language service when a file
 * with language ID `documentdb-scratchpad` is opened. Its sole purpose is to
 * inject the DocumentDB shell API type definitions (.d.ts) into the TypeScript
 * project context, enabling:
 *   - `db.` method chain completions
 *   - Cursor method completions (`.limit()`, `.sort()`, etc.)
 *   - BSON constructor completions (`ObjectId()`, `ISODate()`, etc.)
 *   - JSDoc-powered hover documentation
 *   - Signature help for method parameters
 *
 * The plugin runs in the TypeScript server process (NOT the extension host),
 * so it cannot import `vscode` or any extension code.
 */

import * as path from 'path';
import type ts from 'typescript';

const PLUGIN_NAME = 'documentdb-scratchpad-types';

/**
 * Path to the `.d.ts` file relative to this plugin's output location.
 * After bundling, both this file and the typeDefs directory are in `dist/`.
 */
const dtsPath = path.join(__dirname, 'typeDefs', 'documentdb-shell-api.d.ts');

function create(info: ts.server.PluginCreateInfo): ts.LanguageService {
    info.project.projectService.logger.info(`[${PLUGIN_NAME}] Plugin loaded. .d.ts path: ${dtsPath}`);

    // Return the original language service unmodified.
    // Our contribution is purely via getExternalFiles() below.
    return info.languageService;
}

function getExternalFiles(_project: ts.server.Project): string[] {
    // Tell the TypeScript project to include our shell API .d.ts file.
    // This makes all declared types (db, ObjectId, use, etc.) available
    // in any scratchpad file without needing a tsconfig.json.
    return [dtsPath];
}

// Export as a TS server PluginModuleFactory.
// The TS server calls this factory with { typescript: ts } and expects
// a PluginModule back. This is NOT a direct module export — it must be
// a function that returns the module.
const pluginModuleFactory: ts.server.PluginModuleFactory = (_mod) => ({
    create,
    getExternalFiles,
});

export = pluginModuleFactory;
