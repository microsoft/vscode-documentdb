/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { compareManifest, inspectRequiredFiles, inspectJavaScript, entryGraph, manifest } = require('./inspect.cjs');
const { readVsix, writeVsix, extractVsix } = require('./vsix.cjs');

const files = new Map([
    ['extension/package.json', Buffer.from('{"name":"fixture"}')],
    ['extension/views.js', Buffer.from('export function render() {}')],
]);
const viewReport = { chunkFormat: 'module', assetHashes: { 'views.js': 'fixture' }, chunks: [] };

test('VSIX round-trip and extraction preserve files and exclude archive metadata', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-inspect-'));
    try {
        const filename = path.join(directory, 'fixture.vsix');
        const input = new Map([...files, ['extension.vsixmanifest', Buffer.from('<xml/>')]]);
        writeVsix(filename, input);
        assert.deepEqual(readVsix(filename), input);
        extractVsix(filename, path.join(directory, 'extracted'));
        assert.equal(
            fs.readFileSync(path.join(directory, 'extracted/views.js'), 'utf8'),
            'export function render() {}',
        );
        assert.equal(fs.existsSync(path.join(directory, 'extracted/extension.vsixmanifest')), false);
        const corrupt = fs.readFileSync(filename);
        corrupt[30 + 'extension/package.json'.length] ^= 1;
        fs.writeFileSync(filename, corrupt);
        assert.throws(() => readVsix(filename), /Corrupt/);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('unsafe paths cannot be written or extracted', () => {
    assert.throws(() => writeVsix('unused.vsix', new Map([['extension/../../outside', Buffer.from('bad')]])), /Unsafe/);
    assert.throws(() => writeVsix('unused.vsix', new Map([['C:/outside', Buffer.from('bad')]])), /Unsafe/);
});

test('manifest reports added, removed and oversized files without failing, accepting the exact tolerance boundary', () => {
    const baseline = { version: 1, tolerance: { fraction: 0.1, absoluteBytes: 4096 }, files: manifest(files) };
    assert.deepEqual(compareManifest(files, baseline), { added: [], removed: [], sizeChanges: [] });
    const changed = new Map(files);
    changed.set('extension/views.js', Buffer.alloc(files.get('extension/views.js').length + 4096));
    assert.deepEqual(compareManifest(changed, baseline).sizeChanges, []);
    changed.set('extension/views.js', Buffer.alloc(files.get('extension/views.js').length + 4097));
    changed.delete('extension/package.json');
    changed.set('extension/resources/proof-added.svg', Buffer.from('<svg/>'));
    assert.deepEqual(compareManifest(changed, baseline), {
        added: ['extension/resources/proof-added.svg'],
        removed: ['extension/package.json'],
        sizeChanges: [
            {
                path: 'extension/views.js',
                baselinePath: 'extension/views.js',
                baselineBytes: files.get('extension/views.js').length,
                bytes: changed.get('extension/views.js').length,
                deltaBytes: 4097,
                toleranceBytes: 4096,
            },
        ],
    });
});

test('pipeline-generated NOTICE.html size is exempt from the report', () => {
    const withNotice = new Map([...files, ['extension/NOTICE.html', Buffer.alloc(100)]]);
    const baseline = { version: 1, tolerance: { fraction: 0.1, absoluteBytes: 4096 }, files: manifest(withNotice) };
    withNotice.set('extension/NOTICE.html', Buffer.alloc(2_000_000));
    assert.deepEqual(compareManifest(withNotice, baseline).sizeChanges, []);
    withNotice.delete('extension/NOTICE.html');
    assert.deepEqual(compareManifest(withNotice, baseline).removed, ['extension/NOTICE.html']);
});

test('every size mismatch is reported, not only the first', () => {
    const baseline = { version: 1, tolerance: { fraction: 0.1, absoluteBytes: 4096 }, files: manifest(files) };
    const changed = new Map([...files].map(([name]) => [name, Buffer.alloc(10_000)]));
    assert.deepEqual(
        compareManifest(changed, baseline).sizeChanges.map((entry) => entry.path),
        ['extension/package.json', 'extension/views.js'],
    );
});

test('manifest pairs renamed content hashes, but numeric chunks remain added and removed', () => {
    const original = new Map([
        ['extension/assets/monaco-editor-AbC12_x-.js', Buffer.alloc(10)],
        ['extension/assets/runtime-A-B_Cd12.js', Buffer.alloc(10)],
        ['extension/assets/f6283f7ccaed1249d9eb.ttf', Buffer.alloc(10)],
        ['extension/58.js', Buffer.alloc(10)],
    ]);
    const changed = new Map([
        ['extension/assets/monaco-editor-ZZ9.js', Buffer.alloc(5000)],
        ['extension/assets/runtime-ZY98abcd.js', Buffer.alloc(10)],
        ['extension/assets/0123456789abcdefabcd.ttf', Buffer.alloc(10)],
        ['extension/59.js', Buffer.alloc(10)],
    ]);
    const baseline = { version: 1, tolerance: { fraction: 0.1, absoluteBytes: 4096 }, files: manifest(original) };
    const report = compareManifest(changed, baseline);
    assert.deepEqual(report.added, ['extension/59.js']);
    assert.deepEqual(report.removed, ['extension/58.js']);
    assert.equal(report.sizeChanges.length, 1);
    assert.equal(report.sizeChanges[0].path, 'extension/assets/monaco-editor-ZZ9.js');
    assert.equal(report.sizeChanges[0].baselinePath, 'extension/assets/monaco-editor-AbC12_x-.js');
    assert.equal(report.sizeChanges[0].deltaBytes, 4990);
});

test('manifest hash pairing preserves exact matches and reports surplus logical files', () => {
    const original = new Map([
        ['extension/chunk-AbC12345.js', Buffer.alloc(10)],
        ['extension/chunk-XyZ12345.js', Buffer.alloc(10)],
        ['extension/resources/proof-added.svg', Buffer.alloc(10)],
    ]);
    const changed = new Map([
        ['extension/chunk-XyZ12345.js', Buffer.alloc(10)],
        ['extension/chunk-ZzZ12345.js', Buffer.alloc(10)],
        ['extension/chunk-New12345.js', Buffer.alloc(10)],
        ['extension/resources/proof-removed.svg', Buffer.alloc(10)],
    ]);
    const baseline = { version: 1, tolerance: { fraction: 0.1, absoluteBytes: 4096 }, files: manifest(original) };
    assert.deepEqual(compareManifest(changed, baseline), {
        added: ['extension/chunk-ZzZ12345.js', 'extension/resources/proof-removed.svg'],
        removed: ['extension/resources/proof-added.svg'],
        sizeChanges: [],
    });
});

test('fractional size tolerance reports changes only beyond ten percent', () => {
    const original = new Map([['extension/large.bin', Buffer.alloc(100_000)]]);
    const baseline = { version: 1, tolerance: { fraction: 0.1, absoluteBytes: 4096 }, files: manifest(original) };
    assert.deepEqual(
        compareManifest(new Map([['extension/large.bin', Buffer.alloc(110_000)]]), baseline).sizeChanges,
        [],
    );
    const report = compareManifest(new Map([['extension/large.bin', Buffer.alloc(89_999)]]), baseline);
    assert.equal(report.sizeChanges[0].deltaBytes, -10_001);
    assert.equal(report.sizeChanges[0].toleranceBytes, 10_000);
    assert.throws(() => compareManifest(original, { ...baseline, version: 2 }), /Unsupported VSIX baseline version/);
});

test('required package files and the extensionless or explicit main entry must exist', () => {
    const required = new Map([
        ...files,
        ['extension.vsixmanifest', Buffer.from('<xml/>')],
        ['[Content_Types].xml', Buffer.from('<xml/>')],
        ['extension/package.json', Buffer.from('{"main":"./main"}')],
        ['extension/main.js', Buffer.from('module.exports = {};')],
        ['extension/playgroundWorker.js', Buffer.from('')],
        ['extension/playgroundTsPlugin.js', Buffer.from('')],
        ['extension/package.nls.json', Buffer.from('{}')],
        ['extension/LICENSE.md', Buffer.from('license')],
        ['extension/NOTICE.html', Buffer.from('notice')],
    ]);
    inspectRequiredFiles(required);
    for (const filename of required.keys()) {
        const missing = new Map(required);
        missing.delete(filename);
        assert.throws(
            () => inspectRequiredFiles(missing),
            (error) => error.message.includes('missing required file') && error.message.includes(filename),
        );
    }
    required.set('extension/package.json', Buffer.from('{"main":"./main.js"}'));
    inspectRequiredFiles(required);
    required.set('extension/package.json', Buffer.from('{"main":"./main"}'));
    required.set('extension/main', required.get('extension/main.js'));
    required.delete('extension/main.js');
    inspectRequiredFiles(required);
    required.set('extension/package.json', Buffer.from('{"main":"../outside"}'));
    assert.throws(() => inspectRequiredFiles(required), /main must resolve inside extension/);
    required.set('extension/package.json', Buffer.from('{}'));
    assert.throws(() => inspectRequiredFiles(required), /required main field is missing/);
});

for (const extension of ['js', 'cjs', 'mjs']) {
    test(`unowned .${extension} scripts fail with their packaged filename`, () => {
        const filename = `extension/stray.${extension}`;
        const bundled = new Map([...files, [filename, Buffer.from('console.log("harmless");')]]);
        assert.throws(
            () => inspectJavaScript(bundled, [viewReport]),
            (error) => error.message === `${filename}: unowned script; no bundle report assetHashes entry`,
        );
    });
}

test('.cjs is inspected as CommonJS and .mjs as a module', () => {
    const bundled = new Map([
        ...files,
        ['extension/worker.cjs', Buffer.from('module.exports.dir = import.meta.dirname;')],
        ['extension/module.mjs', Buffer.from('export const url = import.meta.url;')],
    ]);
    const report = { chunkFormat: 'module', assetHashes: { 'worker.cjs': 'fixture', 'module.mjs': 'fixture' } };
    assert.throws(
        () => inspectJavaScript(bundled, [viewReport, report]),
        /worker\.cjs: import\.meta in a CommonJS bundle/,
    );
    bundled.set('extension/worker.cjs', Buffer.from('module.exports.text = "import.meta.dirname";'));
    inspectJavaScript(bundled, [viewReport, report]);
    bundled.set('extension/worker.cjs', Buffer.from('export const value = 1;'));
    assert.throws(() => inspectJavaScript(bundled, [viewReport, report]), /sourceType: module/);
    bundled.set('extension/worker.cjs', Buffer.from('import("./missing.mjs");'));
    assert.throws(() => inspectJavaScript(bundled, [viewReport, report]), /missing dynamic import/);
    bundled.set('extension/worker.cjs', Buffer.from('console.log("DEVSERVER");'));
    assert.throws(() => inspectJavaScript(bundled, [viewReport, report]), /development-server/);
});

test('production render export, native imports and webpack lazy chunks are checked', () => {
    inspectJavaScript(files, [viewReport]);
    for (const [source, error] of [
        ['export function renamed() {}', /does not export render/],
        ['export function render() {}; import("./absent.js")', /missing dynamic/],
        ['export function render() {}; import("/root.js")', /root-relative/],
        ['export function render() {}; import(variable)', /nonliteral/],
        ['export function render() {}; r.e(789)', /missing webpack chunk/],
        ['export function render() {}; console.log("DEVSERVER")', /development-server/],
        ['export function render() {}; console.log("127.0.0.1:18080")', /development-server/],
    ]) {
        const broken = new Map(files);
        broken.set('extension/views.js', Buffer.from(source));
        assert.throws(() => inspectJavaScript(broken, [viewReport]), error);
    }
    const split = new Map(files);
    split.set(
        'extension/views.js',
        Buffer.from('function render() {}; export {render}; import("./chunk.js"); r.e(789)'),
    );
    split.set('extension/chunk.js', Buffer.from('export const value = 1'));
    const reports = [
        { assetHashes: { 'views.js': 'fixture', 'chunk.js': 'fixture' }, chunks: [{ id: 789, files: ['chunk.js'] }] },
    ];
    inspectJavaScript(split, reports);
    split.delete('extension/chunk.js');
    assert.throws(() => inspectJavaScript(split, reports), /missing/);
});

test('webpack chunk IDs cannot resolve against another compilation', () => {
    const bundled = new Map([...files, ['extension/main.js', Buffer.from('r.e(789)')]]);
    const host = { assetHashes: { 'main.js': 'fixture' }, chunks: [] };
    const views = { assetHashes: { 'views.js': 'fixture' }, chunks: [{ id: 789, files: ['views.js'] }] };
    assert.throws(
        () => inspectJavaScript(bundled, [host, views]),
        /main.js: missing webpack chunk 789 in its compilation/,
    );
    host.chunks.push({ id: 789, files: ['main.js'] });
    inspectJavaScript(bundled, [host, views]);
    views.assetHashes['main.js'] = 'ambiguous';
    assert.throws(() => inspectJavaScript(bundled, [host, views]), /ambiguous webpack compilation/);
});

test('import.meta is rejected in CommonJS bundles only, by syntax rather than text', () => {
    const bundled = new Map([
        ...files,
        ['extension/main.js', Buffer.from('module.exports.dir = import.meta.dirname;')],
    ]);
    const host = { chunkFormat: 'commonjs', assetHashes: { 'main.js': 'fixture' }, chunks: [] };
    const views = { chunkFormat: 'module', assetHashes: { 'views.js': 'fixture' }, chunks: [] };
    assert.throws(() => inspectJavaScript(bundled, [host, views]), /main\.js: import\.meta in a CommonJS bundle/);
    bundled.set('extension/main.js', Buffer.from('module.exports.text = "import.meta.dirname";'));
    inspectJavaScript(bundled, [host, views]);
    bundled.set('extension/views.js', Buffer.from('export function render() { return import.meta.url; }'));
    inspectJavaScript(bundled, [host, views]);
});

test('entry graph follows lazy chunks and catches duplicate BSON implementations', () => {
    const report = {
        entrypoints: { main: { chunks: [1] } },
        chunks: [
            {
                id: 1,
                files: ['views.js'],
                children: [2],
                modules: [{ modules: [{ identifier: '/repo/node_modules/bson/lib/bson.mjs' }] }],
            },
            { id: 2, files: ['chunk.js'], modules: [{ identifier: '/repo/node_modules/monaco-editor/index.js' }] },
        ],
    };
    const bundled = new Map([...files, ['extension/chunk.js', Buffer.from('')]]);
    const graph = entryGraph(report, 'main', bundled);
    assert.equal(graph.monaco, true);
    assert.deepEqual(graph.assets, ['chunk.js', 'views.js']);
    report.chunks[1].modules.push({ identifier: '/repo/node_modules/bson/lib/bson.cjs' });
    assert.throws(() => entryGraph(report, 'main', bundled), /exactly one BSON/);
    report.chunks[1].modules.pop();
    report.chunks[0].modules = [];
    assert.throws(() => entryGraph(report, 'main', bundled), /exactly one BSON/);
    assert.deepEqual(entryGraph(report, 'main', bundled, { allowAbsentBson: true }).bsonModules, []);
    report.chunks[0].modules = [
        { identifier: '/repo/node_modules/bson/lib/bson.cjs' },
        { identifier: '/repo/node_modules/bson/lib/bson.mjs' },
    ];
    assert.throws(() => entryGraph(report, 'main', bundled, { allowAbsentBson: true }), /at most one BSON/);
    report.chunks[0].modules.pop();
    bundled.delete('extension/chunk.js');
    assert.throws(() => entryGraph(report, 'main', bundled), /missing chunk/);
});
