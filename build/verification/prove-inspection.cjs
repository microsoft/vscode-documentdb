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

const filename = process.argv[2];
assert.ok(filename, 'Usage: node build/verification/prove-inspection.cjs <vsix>');
const baseline = path.join(__dirname, 'baseline.json');
inspect(filename, { baseline });
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
        assert.throws(() => inspect(variant, { baseline }), expected);
        console.log(`PASS: ${name} rejected for the expected reason`);
    }
    const files = readVsix(filename);
    assert.ok(files.delete('extension/resources/vscode-documentdb-marketplace-logo.png'));
    files.set('extension/resources/proof-added.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    const variant = path.join(directory, 'asset-added-and-removed-reported.vsix');
    writeVsix(variant, files);
    const { manifestReport } = inspect(variant, { baseline });
    assert.deepEqual(manifestReport.removed, ['extension/resources/vscode-documentdb-marketplace-logo.png']);
    assert.deepEqual(manifestReport.added, ['extension/resources/proof-added.svg']);
    console.log('PASS: asset-added-and-removed-reported reported without failing');
} finally {
    fs.rmSync(directory, { recursive: true, force: true });
}
