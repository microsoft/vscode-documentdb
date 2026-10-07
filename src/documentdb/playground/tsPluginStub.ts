/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** Package name of the TS server plugin, as listed in `contributes.typescriptServerPlugins`. */
export const TS_PLUGIN_PACKAGE_NAME = 'documentdb-playground-ts-plugin';

/**
 * Files of the runtime stub package `<extension>/node_modules/documentdb-playground-ts-plugin/`.
 *
 * The extension's `package.json` declares `"type": "module"`, so a `.js` file without a nearer
 * `package.json` would be loaded as an ES module, which the TS server's `require` cannot load. The
 * stub therefore carries its own `package.json` and a `.cjs` entry that forwards to the plugin
 * bundle, which is CommonJS because TypeScript calls the module itself as the plugin factory.
 */
export const TS_PLUGIN_STUB_FILES: Readonly<Record<string, string>> = {
    'index.cjs': 'module.exports = require("../../playgroundTsPlugin.cjs");\n',
    'package.json': `${JSON.stringify(
        { name: TS_PLUGIN_PACKAGE_NAME, private: true, type: 'commonjs', main: 'index.cjs' },
        null,
        4,
    )}\n`,
};

/** Entry file written by versions that bundled the extension as CommonJS. */
const LEGACY_STUB_ENTRY = 'index.js';

/**
 * - `existed`: the stub was already up to date and was not touched.
 * - `created`: there was no stub; it was written.
 * - `replaced`: a stub from an earlier version (or a modified one) was rewritten.
 */
export type TsPluginStubResult = 'existed' | 'created' | 'replaced';

function readFileIfExists(filePath: string): string | undefined {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
}

function writeFileAtomically(filePath: string, content: string): void {
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporaryPath, content, { flag: 'wx' });
        fs.renameSync(temporaryPath, filePath);
    } catch (error) {
        try {
            fs.rmSync(temporaryPath, { force: true });
        } catch {
            // Cleanup is best effort; preserve the original publication error for the caller.
        }
        throw error;
    }
}

/**
 * Makes sure the TS server can load the plugin from `<extensionPath>/node_modules`.
 *
 * vsce always leaves `node_modules/**` out of the VSIX, so the stub cannot ship in it and is
 * written at runtime instead. Each changed file is published by a same-directory rename,
 * entry before manifest, so concurrent readers see complete old or new files.
 * Throws the original file system error (for example `EACCES` or `EROFS` on a read-only install,
 * or Windows `EPERM`/`EBUSY` when a target cannot be replaced due to file sharing).
 */
export function ensureTsPluginStub(extensionPath: string): TsPluginStubResult {
    const stubDir = path.join(extensionPath, 'node_modules', TS_PLUGIN_PACKAGE_NAME);
    const legacyEntry = path.join(stubDir, LEGACY_STUB_ENTRY);

    const current = Object.entries(TS_PLUGIN_STUB_FILES).map(([fileName, content]) => ({
        filePath: path.join(stubDir, fileName),
        content,
        existing: readFileIfExists(path.join(stubDir, fileName)),
    }));
    const legacyEntryExists = fs.existsSync(legacyEntry);
    const stubExisted = legacyEntryExists || current.some((file) => file.existing !== undefined);

    if (!legacyEntryExists && current.every((file) => file.existing === file.content)) {
        return 'existed';
    }

    fs.mkdirSync(stubDir, { recursive: true });
    // `index.cjs` first: `package.json` points the TS server at it.
    for (const file of current) {
        if (file.existing !== file.content) {
            writeFileAtomically(file.filePath, file.content);
        }
    }
    if (legacyEntryExists) {
        fs.rmSync(legacyEntry, { force: true });
    }

    return stubExisted ? 'replaced' : 'created';
}
