/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { compareManifest, inspectJavaScript, entryGraph, manifest } = require('./inspect.cjs');
const { readVsix, writeVsix, extractVsix } = require('./vsix.cjs');

const files = new Map([
    ['extension/package.json', Buffer.from('{"name":"fixture"}')],
    ['extension/views.js', Buffer.from('export function render() {}')],
]);

test('VSIX round-trip and extraction preserve files and exclude archive metadata', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-inspect-'));
    try {
        const filename = path.join(directory, 'fixture.vsix');
        const input = new Map([...files, ['extension.vsixmanifest', Buffer.from('<xml/>')]]);
        writeVsix(filename, input);
        assert.deepEqual(readVsix(filename), input);
        extractVsix(filename, path.join(directory, 'extracted'));
        assert.equal(fs.readFileSync(path.join(directory, 'extracted/views.js'), 'utf8'), 'export function render() {}');
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

test('manifest tolerance accepts its exact boundary but rejects added/missing files and larger changes', () => {
    const baseline = { version: 1, tolerance: { fraction: 0.1, absoluteBytes: 4096 }, files: manifest(files) };
    compareManifest(files, baseline);
    const changed = new Map(files);
    changed.set('extension/views.js', Buffer.alloc(files.get('extension/views.js').length + 4096));
    compareManifest(changed, baseline);
    changed.set('extension/views.js', Buffer.alloc(files.get('extension/views.js').length + 4097));
    assert.throws(() => compareManifest(changed, baseline), /size/);
    changed.delete('extension/views.js');
    assert.throws(() => compareManifest(changed, baseline), /file list/);
    changed.set('extension/extra.js', Buffer.from(''));
    assert.throws(() => compareManifest(changed, baseline), /file list/);
});

test('pipeline-generated NOTICE.html must exist but its size is not compared', () => {
    const withNotice = new Map([...files, ['extension/NOTICE.html', Buffer.alloc(100)]]);
    const baseline = { version: 1, tolerance: { fraction: 0.1, absoluteBytes: 4096 }, files: manifest(withNotice) };
    withNotice.set('extension/NOTICE.html', Buffer.alloc(2_000_000));
    compareManifest(withNotice, baseline);
    withNotice.delete('extension/NOTICE.html');
    assert.throws(() => compareManifest(withNotice, baseline), /file list/);
});

test('every size mismatch is reported, not only the first', () => {
    const baseline = { version: 1, tolerance: { fraction: 0.1, absoluteBytes: 4096 }, files: manifest(files) };
    const changed = new Map([...files].map(([name]) => [name, Buffer.alloc(10_000)]));
    assert.throws(() => compareManifest(changed, baseline), (error) => /package\.json/.test(error.message) && /views\.js/.test(error.message));
});

test('production render export, native imports and webpack lazy chunks are checked', () => {
    inspectJavaScript(files, []);
    for (const [source, error] of [
        ['export function renamed() {}', /does not export render/],
        ['export function render() {}; import("./absent.js")', /missing dynamic/],
        ['export function render() {}; import("/root.js")', /root-relative/],
        ['export function render() {}; import(variable)', /nonliteral/],
        ['export function render() {}; r.e(789)', /compilation provenance/],
        ['export function render() {}; console.log("DEVSERVER")', /development-server/],
        ['export function render() {}; console.log("127.0.0.1:18080")', /development-server/],
    ]) {
        const broken = new Map(files);
        broken.set('extension/views.js', Buffer.from(source));
        assert.throws(() => inspectJavaScript(broken, []), error);
    }
    const split = new Map(files);
    split.set('extension/views.js', Buffer.from('function render() {}; export {render}; import("./chunk.js"); r.e(789)'));
    split.set('extension/chunk.js', Buffer.from('export const value = 1'));
    const reports = [{ assetHashes: { 'views.js': 'fixture' }, chunks: [{ id: 789, files: ['chunk.js'] }] }];
    inspectJavaScript(split, reports);
    split.delete('extension/chunk.js');
    assert.throws(() => inspectJavaScript(split, reports), /missing/);
});

test('webpack chunk IDs cannot resolve against another compilation', () => {
    const bundled = new Map([
        ...files,
        ['extension/main.js', Buffer.from('r.e(789)')],
    ]);
    const host = { assetHashes: { 'main.js': 'fixture' }, chunks: [] };
    const views = { assetHashes: { 'views.js': 'fixture' }, chunks: [{ id: 789, files: ['views.js'] }] };
    assert.throws(() => inspectJavaScript(bundled, [host, views]), /main.js: missing webpack chunk 789 in its compilation/);
    host.chunks.push({ id: 789, files: ['main.js'] });
    inspectJavaScript(bundled, [host, views]);
    views.assetHashes['main.js'] = 'ambiguous';
    assert.throws(() => inspectJavaScript(bundled, [host, views]), /ambiguous webpack compilation/);
});

test('import.meta is rejected in CommonJS bundles only, by syntax rather than text', () => {
    const bundled = new Map([...files, ['extension/main.js', Buffer.from('module.exports.dir = import.meta.dirname;')]]);
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
            { id: 1, files: ['views.js'], children: [2], modules: [{ modules: [{ identifier: '/repo/node_modules/bson/lib/bson.mjs' }] }] },
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
    report.chunks[0].modules = [{ identifier: '/repo/node_modules/bson/lib/bson.cjs' }, { identifier: '/repo/node_modules/bson/lib/bson.mjs' }];
    assert.throws(() => entryGraph(report, 'main', bundled, { allowAbsentBson: true }), /at most one BSON/);
    report.chunks[0].modules.pop();
    bundled.delete('extension/chunk.js');
    assert.throws(() => entryGraph(report, 'main', bundled), /missing chunk/);
});
