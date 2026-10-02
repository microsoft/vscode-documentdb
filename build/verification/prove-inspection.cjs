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
            'missing-file',
            (files) => {
                files.delete('extension/resources/vscode-documentdb-marketplace-logo.png');
            },
            /file list/,
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
} finally {
    fs.rmSync(directory, { recursive: true, force: true });
}
