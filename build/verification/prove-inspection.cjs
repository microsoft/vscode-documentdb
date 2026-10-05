/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspect } = require('./inspect.cjs');
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
const baseline = path.join(__dirname, 'baseline.json');
const options = { baseline, reports };
inspect(filename, options);
const views = JSON.parse(fs.readFileSync(path.join(reports, 'views.json'), 'utf8'));
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
                    'extension/main.js',
                    Buffer.concat([
                        files.get('extension/main.js'),
                        Buffer.from('\nmodule.exports.proof = import.meta.dirname;'),
                    ]),
                );
            },
            /main\.js: import\.meta in a CommonJS bundle/,
        ],
    ];
    for (const [name, mutate, expected] of variants) {
        const files = readVsix(filename);
        mutate(files);
        const variant = path.join(directory, `${name}.vsix`);
        writeVsix(variant, files);
        assert.throws(() => inspect(variant, options), expected);
        console.log(`PASS: ${name} rejected for the expected reason`);
    }
    const files = readVsix(filename);
    assert.ok(files.delete('extension/resources/vscode-documentdb-marketplace-logo.png'));
    files.set('extension/resources/proof-added.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    const variant = path.join(directory, 'asset-added-and-removed-reported.vsix');
    writeVsix(variant, files);
    const { manifestReport } = inspect(variant, options);
    assert.deepEqual(manifestReport.removed, ['extension/resources/vscode-documentdb-marketplace-logo.png']);
    assert.deepEqual(manifestReport.added, ['extension/resources/proof-added.svg']);
    console.log('PASS: asset-added-and-removed-reported reported without failing');
    const viteControls = ['missing-lazy-chunk', 'monaco-in-local-quick-start', 'duplicate-bson', 'nonliteral-import'];
    if (views.bundler === 'vite') {
        const { viewModules } = require('./inspect.cjs');
        const lazy = views.chunks.find((chunk) => chunk.facadeModuleId === viewModules.localQuickStart);
        const monaco = views.chunks.find((chunk) => /^monaco-[A-Za-z0-9_-]+\.js$/.test(chunk.fileName));
        assert.ok(lazy, 'Proof requires Local Quick Start lazy chunk');
        assert.ok(monaco, 'Proof requires Monaco chunk');
        const escapedLazyName = lazy.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const controls = [
            [
                viteControls[0],
                (files) => {
                    assert.ok(files.delete(`extension/${lazy.fileName}`));
                },
                new RegExp(`views\\.js: missing dynamic import/asset (?:\\./)?${escapedLazyName}`),
            ],
            [
                viteControls[1],
                undefined,
                /localQuickStart must exclude Monaco and SlickGrid/,
                (report) => {
                    report.chunks.find((chunk) => chunk.fileName === lazy.fileName).imports.push(monaco.fileName);
                },
            ],
            [
                viteControls[2],
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
                viteControls[3],
                (files) => {
                    files.set(
                        'extension/views.js',
                        Buffer.concat([files.get('extension/views.js'), Buffer.from(';import(`${globalThis.x}`)')]),
                    );
                },
                /views\.js: nonliteral dynamic import cannot be verified/,
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
            writeVsix(variant, files);
            assert.throws(() => inspect(variant, { ...options, reports: controlReports }), expected);
            console.log(`PASS: ${name} rejected for the expected reason`);
        }
    } else {
        for (const name of viteControls) {
            console.log(`SKIP: ${name} (webpack views report)`);
        }
    }
} finally {
    fs.rmSync(directory, { recursive: true, force: true });
}
