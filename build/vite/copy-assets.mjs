/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Copies the static files the extension needs at runtime (manifest, resources, grammars, type
// definitions, marketplace documents) into the host build output, replacing webpack's
// CopyWebpackPlugin. They are written next to the bundle rather than emitted into it: the bundle
// report (and L1's hash check against the VSIX) covers bundler output only, and some of these files
// legitimately differ in the VSIX (`npm run package` edits `package.json`; vsce drops `.vscodeignore`).

import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {object} CopyTarget
 * @property {string} from  File or directory, relative to the Vite root.
 * @property {string} to  Destination file (for a file) or directory (for a directory), relative to
 *     the output directory.
 * @property {(relativePath: string) => boolean} [filter]  For directories: keeps the files whose path
 *     relative to `from` (with `/` separators) passes.
 * @property {(content: Buffer) => string | Buffer} [transform]  Rewrites the file content.
 * @property {boolean} [optional]  Skip, instead of failing, when `from` does not exist.
 */

/**
 * @param {string} directory
 * @returns {string[]} Files below `directory`, relative to it, with `/` separators, sorted.
 */
function listFiles(directory) {
    return fs
        .readdirSync(directory, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)).replace(/\\/g, '/'))
        .sort();
}

/**
 * @param {CopyTarget[]} targets
 * @returns {import('vite').Plugin}
 */
export function copyAssets(targets) {
    let root = '';
    let outDir = '';

    return {
        name: 'documentdb:copy-assets',
        apply: 'build',
        configResolved(config) {
            root = config.root;
            outDir = path.resolve(config.root, config.build.outDir);
        },
        writeBundle() {
            for (const target of targets) {
                const source = path.resolve(root, target.from);
                if (!fs.existsSync(source)) {
                    if (target.optional) {
                        continue;
                    }
                    this.error(`copy-assets: ${target.from} does not exist`);
                }

                const files = fs.statSync(source).isDirectory()
                    ? listFiles(source)
                          .filter((file) => !target.filter || target.filter(file))
                          .map((file) => ({ from: path.join(source, file), to: path.posix.join(target.to, file) }))
                    : [{ from: source, to: target.to }];

                for (const file of files) {
                    const content = fs.readFileSync(file.from);
                    const destination = path.join(outDir, file.to);
                    fs.mkdirSync(path.dirname(destination), { recursive: true });
                    fs.writeFileSync(destination, target.transform ? target.transform(content) : content);
                }
            }
        },
    };
}
