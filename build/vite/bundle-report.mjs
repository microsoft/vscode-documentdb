/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Writes the bundler-neutral bundle reports that L1 reads (`build/verification/reports/views.json`
// and `host.json`, replacing the webpack reports of the same names). Production builds only.
//
// The host is two builds (ES module entries, and the CommonJS TS server plugin), which write one
// report: the second build passes `append: true` to add its files to the report the first one wrote.
// L1 recognises the CommonJS output by its `.cjs` extension.
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

/** Same order as `Array.prototype.sort()` without a comparator (UTF-16 code units). */
function compareFileNames(a, b) {
    if (a === b) {
        return 0;
    }
    return a < b ? -1 : 1;
}

/**
 * @param {{ outFile: string, append?: boolean }} options `outFile`: report path, relative to the Vite
 *     root. `append`: merge into the report an earlier build of the same run wrote, replacing entries
 *     for the same files, instead of starting a new report.
 * @returns {import('vite').Plugin}
 */
export function bundleReport({ outFile, append = false }) {
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
            if (append) {
                // Only merge into a report written by this process (the earlier build of the same
                // `vite build`), never into one left over from a previous run.
                if (!fs.existsSync(target) || fs.statSync(target).mtimeMs < performance.timeOrigin) {
                    throw new Error(`bundle-report: cannot append to ${outFile}; the build that writes it did not run`);
                }
                const existing = JSON.parse(fs.readFileSync(target, 'utf8'));
                const ownFiles = new Set(Object.keys(report.assetHashes));
                const keep = (fileName) => !ownFiles.has(fileName);
                report.assetHashes = Object.fromEntries(
                    [
                        ...Object.entries(existing.assetHashes).filter(([fileName]) => keep(fileName)),
                        ...Object.entries(report.assetHashes),
                    ].sort(([a], [b]) => compareFileNames(a, b)),
                );
                report.chunks = [...existing.chunks.filter((chunk) => keep(chunk.fileName)), ...report.chunks];
                report.assets = [...existing.assets.filter((asset) => keep(asset.fileName)), ...report.assets].sort(
                    (a, b) => compareFileNames(a.fileName, b.fileName),
                );
            }
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
        },
    };
}
