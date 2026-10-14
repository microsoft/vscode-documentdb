/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspect, viteChunkClosure, keptClassName, nonLiteralImportBudget } = require('./inspect.cjs');
const { readVsix, writeVsix } = require('./vsix.cjs');

const args = process.argv.slice(2);
const filename = args.shift();
assert.ok(filename, 'Usage: node build/verification/prove-inspection.cjs <vsix> [--reports <directory>]');
let reports = path.join(__dirname, 'reports');
while (args.length) {
    const flag = args.shift();
    assert.equal(flag, '--reports', `Unknown proof option: ${flag}`);
    reports = args.shift();
    assert.ok(reports, '--reports requires a directory');
}
const options = { reports };
const { nonLiteralImports } = inspect(filename, options);
const views = JSON.parse(fs.readFileSync(path.join(reports, 'views.json'), 'utf8'));
const host = JSON.parse(fs.readFileSync(path.join(reports, 'host.json'), 'utf8'));
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const budgetEntry = (text) => nonLiteralImportBudget.find((entry) => entry.moduleId?.includes(text));
/** Appends nonliteral imports until `file` is one over its budget, whatever its current use. */
function overImportBudget(file) {
    const { count, maximum } = nonLiteralImports[file];
    return [
        (files) => {
            const extra = ';import(globalThis.proof)'.repeat(maximum - count + 1);
            files.set(file, Buffer.concat([files.get(file), Buffer.from(extra)]));
        },
        new RegExp(
            `: ${escape(file)}: ${maximum + 1} nonliteral dynamic imports exceed its nonLiteralImportBudget of ${maximum}$`,
        ),
    ];
}
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-broken-vsix-'));
try {
    const variants = [
        [
            'render-renamed',
            (files) => {
                const source = files.get('extension/views.js').toString('utf8');
                assert.match(source, /(?:as\s+render\b|function\s+render\b)/);
                files.set(
                    'extension/views.js',
                    Buffer.from(
                        source
                            .replace(/as\s+render\b/, 'as renamedRender')
                            .replace(/function\s+render\b/, 'function renamedRender'),
                    ),
                );
            },
            /does not export render/,
        ],
        [
            'missing-import',
            (files) => {
                files.set(
                    'extension/views.js',
                    Buffer.concat([
                        files.get('extension/views.js'),
                        Buffer.from('\nimport("./missing-proof-chunk.js");'),
                    ]),
                );
            },
            /missing dynamic import/,
        ],
        [
            'dev-server',
            (files) => {
                files.set(
                    'extension/views.js',
                    Buffer.concat([files.get('extension/views.js'), Buffer.from('\nconsole.log("127.0.0.1:18080");')]),
                );
            },
            /development-server/,
        ],
        [
            'missing-required-file',
            (files) => {
                files.delete('extension/package.nls.json');
            },
            /missing required file: extension\/package\.nls\.json/,
        ],
        [
            'missing-contributed-grammar',
            (files) => {
                assert.ok(files.delete('extension/syntaxes/documentdb-playground.tmGrammar.json'));
            },
            /VSIX missing manifest-declared asset: extension\/syntaxes\/documentdb-playground\.tmGrammar\.json \(\/contributes\/grammars\/0\/path\)/,
        ],
        [
            'missing-runtime-asset',
            (files) => {
                assert.ok(files.delete('extension/typeDefs/documentdb-shell-api.d.ts'));
            },
            /VSIX missing runtime asset: extension\/typeDefs\/documentdb-shell-api\.d\.ts \(Playground TS plugin and getShellApiDtsContent read shell declarations\)/,
        ],
        [
            'unowned-script',
            (files) => {
                files.set('extension/stray-proof.js', Buffer.from('console.log("harmless proof");'));
            },
            /extension\/stray-proof\.js: unowned script/,
        ],
        [
            'import-meta-in-commonjs',
            (files) => {
                files.set(
                    'extension/playgroundTsPlugin.cjs',
                    Buffer.concat([
                        files.get('extension/playgroundTsPlugin.cjs'),
                        Buffer.from('\nmodule.exports.proof = import.meta.dirname;'),
                    ]),
                );
            },
            /playgroundTsPlugin\.cjs: import\.meta in a CommonJS bundle/,
        ],
    ];
    for (const [name, mutate, expected] of variants) {
        const files = readVsix(filename);
        mutate(files);
        const variant = path.join(directory, `${name}.vsix`);
        writeVsix(variant, files, { compress: true });
        assert.throws(() => inspect(variant, options), expected);
        console.log(`PASS: ${name} rejected for the expected reason`);
    }
    const mainEntry = host.chunks.find((chunk) => chunk.isEntry && chunk.name === 'main');
    const originalFiles = readVsix(filename);
    const staticMain = viteChunkClosure(host, 'main', [mainEntry.fileName], originalFiles, { host: true });
    const fullMain = viteChunkClosure(host, 'main', [mainEntry.fileName], originalFiles, { host: true, dynamic: true });
    const lazyHostChunk = mainEntry.dynamicImports.find(
        (file) => fullMain.assets.has(file) && !staticMain.assets.has(file),
    );
    assert.ok(lazyHostChunk, 'Proof requires a host chunk reachable only through dynamic imports');
    const babelChunk = host.chunks.find((chunk) => chunk.moduleIds.includes(budgetEntry('/@babel/').moduleId));
    assert.ok(babelChunk, 'Proof requires Babel config-file loader chunk');
    const kubernetesChunk = host.chunks.find((chunk) =>
        chunk.moduleIds.some((id) => /\/node_modules\/@kubernetes\/client-node\//.test(id)),
    );
    assert.ok(kubernetesChunk, 'Proof requires Kubernetes SDK chunk');
    const implementation = host.chunks.find((chunk) => chunk.facadeModuleId === './src/extension.ts');
    assert.ok(implementation, 'Proof requires extension implementation facade ./src/extension.ts');
    const hostControls = [
        [
            'missing-host-lazy-chunk',
            (files) => {
                assert.ok(files.delete(`extension/${lazyHostChunk}`));
            },
            /main\.mjs: missing dynamic import\/asset/,
        ],
        [
            'duplicate-host-bson',
            undefined,
            /main: expected exactly one BSON module, got 2/,
            (report) => {
                report.chunks
                    .find((chunk) => chunk.name === 'main')
                    .moduleIds.push('./node_modules/proof/node_modules/bson/lib/bson.cjs');
            },
        ],
        [
            'missing-ts-plugin',
            (files) => {
                assert.ok(files.delete('extension/playgroundTsPlugin.cjs'));
            },
            /missing required file: extension\/playgroundTsPlugin\.cjs/,
        ],
        ['babel-chunk-over-import-budget', ...overImportBudget(`extension/${babelChunk.fileName}`)],
        [
            'kubernetes-in-main-static-closure',
            undefined,
            /main: static closure must exclude @kubernetes\/client-node/,
            (report) => {
                report.chunks.find((chunk) => chunk.name === 'main').imports.push(kubernetesChunk.fileName);
            },
        ],
        [
            'kubernetes-in-extension-static-closure',
            (files) => {
                const file = `extension/${implementation.fileName}`;
                files.set(
                    file,
                    Buffer.concat([Buffer.from(`import './${kubernetesChunk.fileName}';\n`), files.get(file)]),
                );
            },
            /main: static closure must exclude @kubernetes\/client-node/,
            (report) => {
                report.chunks
                    .find((chunk) => chunk.facadeModuleId === './src/extension.ts')
                    .imports.push(kubernetesChunk.fileName);
            },
        ],
        [
            'keepnames-class-name-lost',
            (files) => {
                // What the minifier emits without keepNames: the class binding gets another name.
                const name = new RegExp(`\\b${keptClassName.name}\\b`, 'g');
                const renamed = [...fullMain.assets].filter((asset) => {
                    const source = files.get(`extension/${asset}`).toString('utf8');
                    const mutated = source.replace(name, 'KeepNamesLost');
                    files.set(`extension/${asset}`, Buffer.from(mutated));
                    return mutated !== source;
                });
                assert.ok(renamed.length > 0, `Proof requires ${keptClassName.name} in the main graph`);
            },
            new RegExp(`keepNames: no class named ${keptClassName.name} in the main graph`),
        ],
        [
            'missing-extension-implementation-boundary',
            undefined,
            /main: expected exactly one extension implementation facade \.\/src\/extension\.ts/,
            (report) => {
                report.chunks.find((chunk) => chunk.facadeModuleId === './src/extension.ts').facadeModuleId = null;
            },
        ],
        [
            'ambiguous-script-owner',
            undefined,
            /: extension\/views\.js: ambiguous script owner; owned by host bundle report and views bundle report$/,
            (report) => {
                assert.ok(Object.hasOwn(views.assetHashes, 'views.js'), 'Proof requires views-owned views.js');
                report.assetHashes['views.js'] = views.assetHashes['views.js'];
            },
        ],
    ];
    for (const [name, mutateFiles, expected, mutateReport] of hostControls) {
        const files = readVsix(filename);
        mutateFiles?.(files);
        const controlReports = path.join(directory, name);
        fs.mkdirSync(controlReports);
        fs.copyFileSync(path.join(reports, 'views.json'), path.join(controlReports, 'views.json'));
        const report = structuredClone(host);
        mutateReport?.(report);
        // Use matching hashes to model a newly built regression, not merely stale provenance.
        for (const [asset] of Object.entries(report.assetHashes)) {
            if (files.has(`extension/${asset}`)) {
                report.assetHashes[asset] = createHash('sha256')
                    .update(files.get(`extension/${asset}`))
                    .digest('hex');
            }
        }
        for (const chunk of report.chunks) {
            if (files.has(`extension/${chunk.fileName}`)) {
                chunk.bytes = files.get(`extension/${chunk.fileName}`).length;
            }
        }
        fs.writeFileSync(path.join(controlReports, 'host.json'), JSON.stringify(report));
        const variant = path.join(directory, `${name}.vsix`);
        writeVsix(variant, files, { compress: true });
        assert.throws(() => inspect(variant, { ...options, reports: controlReports }), expected);
        console.log(`PASS: ${name} rejected for the expected reason`);
    }
    const { viewModules } = require('./inspect.cjs');
    const lazy = views.chunks.find((chunk) => chunk.facadeModuleId === viewModules.localQuickStart);
    const monaco = views.chunks.find((chunk) => /^monaco-[A-Za-z0-9_-]+\.js$/.test(chunk.fileName));
    assert.ok(lazy, 'Proof requires Local Quick Start lazy chunk');
    assert.ok(monaco, 'Proof requires Monaco chunk');
    const monacoLoader = budgetEntry('/monaco-editor/');
    const loaderChunk = views.chunks.find((chunk) => chunk.moduleIds.includes(monacoLoader.moduleId));
    assert.ok(loaderChunk, `Proof requires the chunk containing ${monacoLoader.moduleId}`);
    const workerBudget = nonLiteralImportBudget.find((entry) => entry.asset);
    const worker = Object.keys(nonLiteralImports).find((file) =>
        workerBudget.asset.test(file.slice('extension/'.length)),
    );
    assert.ok(worker, 'Proof requires a Monaco worker script with nonliteral imports');
    const escapedLazyName = escape(lazy.fileName);
    const controls = [
        [
            'missing-lazy-chunk',
            (files) => {
                assert.ok(files.delete(`extension/${lazy.fileName}`));
            },
            new RegExp(`views\\.js: missing dynamic import/asset (?:\\./)?${escapedLazyName}`),
        ],
        [
            'monaco-in-local-quick-start',
            undefined,
            /localQuickStart must exclude Monaco and SlickGrid/,
            (report) => {
                report.chunks.find((chunk) => chunk.fileName === lazy.fileName).imports.push(monaco.fileName);
            },
        ],
        [
            'duplicate-bson',
            undefined,
            /localQuickStart: expected at most one BSON module, got 2/,
            (report) => {
                report.chunks
                    .find((chunk) => chunk.fileName === lazy.fileName)
                    .moduleIds.push(
                        './node_modules/bson/lib/bson.mjs',
                        './node_modules/foo/node_modules/bson/lib/bson.mjs',
                    );
            },
        ],
        [
            'nonliteral-import',
            (files) => {
                files.set(
                    'extension/views.js',
                    Buffer.concat([files.get('extension/views.js'), Buffer.from(';import(`${globalThis.x}`)')]),
                );
            },
            /views\.js: nonliteral dynamic import cannot be verified; no nonLiteralImportBudget entry covers this script$/,
        ],
        ['monaco-chunk-over-import-budget', ...overImportBudget(`extension/${loaderChunk.fileName}`)],
        ['monaco-worker-over-import-budget', ...overImportBudget(worker)],
        [
            'import-budget-module-absent',
            undefined,
            new RegExp(
                `${escape(loaderChunk.fileName)}: nonliteral dynamic import cannot be verified; no nonLiteralImportBudget entry covers this script$`,
            ),
            (report) => {
                const chunk = report.chunks.find((candidate) => candidate.fileName === loaderChunk.fileName);
                chunk.moduleIds = chunk.moduleIds.filter((id) => id !== monacoLoader.moduleId);
            },
        ],
    ];
    for (const [name, mutateFiles, expected, mutateReport] of controls) {
        const files = readVsix(filename);
        mutateFiles?.(files);
        let controlReports = reports;
        if (mutateReport) {
            controlReports = path.join(directory, name);
            fs.mkdirSync(controlReports);
            fs.copyFileSync(path.join(reports, 'host.json'), path.join(controlReports, 'host.json'));
            const report = structuredClone(views);
            mutateReport(report);
            fs.writeFileSync(path.join(controlReports, 'views.json'), JSON.stringify(report));
        }
        const variant = path.join(directory, `${name}.vsix`);
        writeVsix(variant, files, { compress: true });
        assert.throws(() => inspect(variant, { ...options, reports: controlReports }), expected);
        console.log(`PASS: ${name} rejected for the expected reason`);
    }
} finally {
    fs.rmSync(directory, { recursive: true, force: true });
}
