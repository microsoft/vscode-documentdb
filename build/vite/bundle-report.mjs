/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Writes the bundler-neutral views report that L1 reads (`build/verification/reports/views.json`,
// replacing the webpack report of the same name). Production builds only.
//
// Shape:
//   bundler, chunkFormat
//   assetHashes  { <file relative to outDir>: <sha256 of the bytes on disk> } for every emitted
//                file, including the Monaco worker scripts and the entry after inline-css changed it
//   chunks       [{ fileName, name, isEntry, isDynamicEntry, facadeModuleId, imports,
//                   dynamicImports, moduleIds, bytes }]  (module IDs repository-relative, '/')
//   assets       [{ fileName, bytes }] for emitted files that are not chunks (workers, fonts)

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {{ outFile: string }} options Report path, relative to the Vite root.
 * @returns {import('vite').Plugin}
 */
export function bundleReport({ outFile }) {
    let root = '';
    let outDir = '';
    /** @type {import('rolldown').OutputChunk[]} */
    let chunks = [];
    /** @type {string[]} */
    let fileNames = [];

    const normalizeModuleId = (id) => {
        if (id.startsWith('\0')) {
            return `virtual:${id.slice(1)}`;
        }
        const normalized = id.replace(/\\/g, '/');
        const relative = path.relative(root, normalized.split('?')[0]).replace(/\\/g, '/');
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            return normalized;
        }
        return `./${relative}${normalized.includes('?') ? normalized.slice(normalized.indexOf('?')) : ''}`;
    };

    return {
        name: 'documentdb:bundle-report',
        apply: 'build',
        enforce: 'post',
        configResolved(config) {
            root = config.root;
            outDir = path.resolve(config.root, config.build.outDir);
        },
        generateBundle(_options, bundle) {
            chunks = Object.values(bundle).filter((output) => output.type === 'chunk');
            fileNames = Object.keys(bundle);
        },
        writeBundle() {
            const read = (fileName) => fs.readFileSync(path.join(outDir, fileName));
            const chunkFileNames = new Set(chunks.map((chunk) => chunk.fileName));
            const report = {
                bundler: 'vite',
                chunkFormat: 'module',
                assetHashes: Object.fromEntries(
                    [...fileNames]
                        .sort()
                        .map((fileName) => [fileName, createHash('sha256').update(read(fileName)).digest('hex')]),
                ),
                chunks: chunks.map((chunk) => ({
                    fileName: chunk.fileName,
                    name: chunk.name,
                    isEntry: chunk.isEntry,
                    isDynamicEntry: chunk.isDynamicEntry,
                    facadeModuleId: chunk.facadeModuleId ? normalizeModuleId(chunk.facadeModuleId) : null,
                    imports: chunk.imports,
                    dynamicImports: chunk.dynamicImports,
                    moduleIds: chunk.moduleIds.map(normalizeModuleId),
                    bytes: read(chunk.fileName).length,
                })),
                assets: fileNames
                    .filter((fileName) => !chunkFileNames.has(fileName))
                    .sort()
                    .map((fileName) => ({ fileName, bytes: read(fileName).length })),
            };
            const target = path.resolve(root, outFile);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
        },
    };
}
