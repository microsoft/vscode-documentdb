/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
    inspect,
    compareManifest,
    inspectRequiredFiles,
    manifestAssets,
    inspectManifestAssets,
    inspectRuntimeAssets,
    runtimeAssets,
    inspectJavaScript,
    entryGraph,
    hostGraphs,
    viteChunkClosure,
    babelConfigFileImports,
    viteViewGraph,
    viewGraphs,
    viewModules,
    manifest,
} = require('./inspect.cjs');
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

test('required ESM host entries and the resolved manifest main entry must exist', () => {
    const required = new Map([
        ...files,
        ['extension.vsixmanifest', Buffer.from('<xml/>')],
        ['[Content_Types].xml', Buffer.from('<xml/>')],
        ['extension/package.json', Buffer.from('{"main":"./main.mjs"}')],
        ['extension/main.mjs', Buffer.from('export {};')],
        ['extension/playgroundWorker.mjs', Buffer.from('')],
        ['extension/playgroundTsPlugin.cjs', Buffer.from('')],
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
    required.set('extension/package.json', Buffer.from('{"main":"./other.js"}'));
    required.set('extension/other.js', Buffer.from(''));
    inspectRequiredFiles(required);
    required.set('extension/package.json', Buffer.from('{"main":"./other"}'));
    inspectRequiredFiles(required);
    required.set('extension/other', required.get('extension/other.js'));
    required.delete('extension/other.js');
    inspectRequiredFiles(required);
    required.set('extension/package.json', Buffer.from('{"main":"../outside"}'));
    assert.throws(() => inspectRequiredFiles(required), /main must resolve inside extension/);
    required.set('extension/package.json', Buffer.from('{}'));
    assert.throws(() => inspectRequiredFiles(required), /required main field is missing/);
});

function hostFixture() {
    const chunks = [
        {
            name: 'main',
            fileName: 'main.mjs',
            isEntry: true,
            imports: ['runtime.mjs'],
            dynamicImports: ['extension-AbC12345.mjs'],
            moduleIds: ['./main.ts'],
        },
        {
            name: 'playgroundWorker',
            fileName: 'playgroundWorker.mjs',
            isEntry: true,
            imports: ['bson.mjs', 'runtime.mjs'],
            dynamicImports: [],
            moduleIds: [babelConfigFileImports.moduleId],
        },
        {
            name: 'playgroundTsPlugin',
            fileName: 'playgroundTsPlugin.cjs',
            isEntry: true,
            imports: ['fs', 'path'],
            dynamicImports: [],
            moduleIds: [],
        },
        {
            fileName: 'extension-AbC12345.mjs',
            imports: ['bson.mjs', 'vscode', 'node:path', 'fs'],
            dynamicImports: ['kubernetes.mjs'],
            moduleIds: ['./src/extension.ts'],
        },
        {
            fileName: 'runtime.mjs',
            imports: ['node:module'],
            dynamicImports: [],
            moduleIds: [],
        },
        {
            fileName: 'bson.mjs',
            imports: ['runtime.mjs'],
            dynamicImports: ['extension-AbC12345.mjs'],
            moduleIds: ['./node_modules/bson/lib/bson.cjs'],
        },
        {
            fileName: 'kubernetes.mjs',
            imports: ['runtime.mjs'],
            dynamicImports: [],
            moduleIds: ['./node_modules/@kubernetes/client-node/dist/index.js'],
        },
    ];
    return {
        report: {
            bundler: 'vite',
            chunkFormat: 'module',
            chunks,
            assetHashes: Object.fromEntries(chunks.map((chunk) => [chunk.fileName, 'fixture'])),
        },
        bundled: new Map(chunks.map((chunk) => [`extension/${chunk.fileName}`, Buffer.from('')])),
    };
}

test('Vite host closures follow static and dynamic edges, including cycles and runtime externals', () => {
    const { report, bundled } = hostFixture();
    const graphs = hostGraphs(report, bundled);
    assert.deepEqual(graphs.main.assets, [
        'bson.mjs',
        'extension-AbC12345.mjs',
        'kubernetes.mjs',
        'main.mjs',
        'runtime.mjs',
    ]);
    assert.deepEqual(graphs.main.bsonModules, ['node_modules/bson/lib/bson.cjs']);
    assert.ok(graphs.playgroundWorker.assets.includes('kubernetes.mjs'));
    assert.deepEqual(graphs.playgroundTsPlugin.bsonModules, []);
    assert.deepEqual([...viteChunkClosure(report, 'main', ['main.mjs'], bundled, { host: true }).assets].sort(), [
        'main.mjs',
        'runtime.mjs',
    ]);
});

test('host BSON invariant requires one per host/worker and permits zero or one, never two, in the plugin', () => {
    for (const name of ['main', 'playgroundWorker', 'playgroundTsPlugin']) {
        const { report, bundled } = hostFixture();
        const entry = report.chunks.find((chunk) => chunk.name === name);
        entry.moduleIds.push('./node_modules/other/node_modules/bson/lib/bson.mjs');
        if (name === 'playgroundTsPlugin') {
            hostGraphs(report, bundled);
            entry.moduleIds.push('./node_modules/bson/lib/bson.cjs');
        }
        assert.throws(() => hostGraphs(report, bundled), new RegExp(`${name}: expected .* one BSON module, got 2`));
    }
    const { report, bundled } = hostFixture();
    report.chunks.find((chunk) => chunk.fileName === 'bson.mjs').moduleIds = [];
    assert.throws(() => hostGraphs(report, bundled), /main: expected exactly one BSON module, got 0/);
    report.chunks[0].moduleIds.push('./node_modules/bson/lib/bson.cjs');
    assert.throws(() => hostGraphs(report, bundled), /playgroundWorker: expected exactly one BSON module, got 0/);
});

test('host graph edges require report chunks and packaged chunks, and obsolete reports require regeneration', () => {
    const { report, bundled } = hostFixture();
    assert.throws(() => hostGraphs({ bundler: 'webpack' }, bundled), /non-Vite host bundle report; regenerate/);
    for (const edge of ['imports', 'dynamicImports']) {
        report.chunks[0][edge].push('absent.mjs');
        assert.throws(() => hostGraphs(report, bundled), /main: bundle report missing chunk absent\.mjs/);
        report.chunks[0][edge].pop();
    }
    bundled.delete('extension/kubernetes.mjs');
    assert.throws(() => hostGraphs(report, bundled), /main: missing chunk kubernetes\.mjs/);
    bundled.set('extension/kubernetes.mjs', Buffer.from(''));
    const hash = report.assetHashes['playgroundTsPlugin.cjs'];
    delete report.assetHashes['playgroundTsPlugin.cjs'];
    assert.throws(
        () => hostGraphs(report, bundled),
        /playgroundTsPlugin: host bundle report missing assetHashes ownership/,
    );
    report.assetHashes['playgroundTsPlugin.cjs'] = hash;
    report.chunks[0].isEntry = false;
    assert.throws(() => hostGraphs(report, bundled), /missing host entry main/);
});

test('Kubernetes SDK must remain outside the entire main static closure', () => {
    const { report, bundled } = hostFixture();
    hostGraphs(report, bundled);
    report.chunks.find((chunk) => chunk.fileName === 'runtime.mjs').imports.push('kubernetes.mjs');
    assert.throws(() => hostGraphs(report, bundled), /main: static closure must exclude @kubernetes\/client-node/);
});

test('dynamic runtime externals are allowed only in host-owned .mjs, not views, CJS or other packages', () => {
    const { report, bundled } = hostFixture();
    bundled.set('extension/playgroundWorker.mjs', Buffer.from(babelLoaderSource));
    for (const reference of ['http', 'https', 'fs/promises', 'node:test', 'vscode']) {
        bundled.set('extension/main.mjs', Buffer.from(`import('${reference}');`));
        inspectJavaScript(bundled, [report]);
        bundled.set('extension/main.mjs', Buffer.from(`import(\`${reference}\`);`));
        inspectJavaScript(bundled, [report]);
        assert.throws(
            () =>
                inspectJavaScript(
                    new Map([
                        ['extension/views.js', Buffer.from(`export function render(){};import('${reference}');`)],
                    ]),
                    [{ ...report, chunks: [], assetHashes: { 'views.js': 'fixture' } }],
                ),
            /missing dynamic import/,
        );
        bundled.set('extension/playgroundTsPlugin.cjs', Buffer.from(`import('${reference}');`));
        assert.throws(() => inspectJavaScript(bundled, [report]), /playgroundTsPlugin\.cjs: missing dynamic import/);
        bundled.set('extension/playgroundTsPlugin.cjs', Buffer.from(''));
    }
    bundled.set('extension/main.mjs', Buffer.from('import("@azure/arm-mongocluster");'));
    assert.throws(() => inspectJavaScript(bundled, [report]), /missing dynamic import/);
    bundled.set('extension/main.mjs', Buffer.from('import("./absent.mjs");'));
    assert.throws(() => inspectJavaScript(bundled, [report]), /missing dynamic import/);
});

const babelLoaderSource = 'var require_import=__commonJSMin((e,m)=>{m.exports=function import_(t){return import(t)}});';

test('Babel config-file allowance requires host module ownership, exact factory/helper/parameter shape and count', () => {
    const { report, bundled } = hostFixture();
    bundled.set('extension/playgroundWorker.mjs', Buffer.from(babelLoaderSource));
    inspectJavaScript(bundled, [report]);
    for (const invalid of [
        babelLoaderSource.replace('import(t)', 'import(other)'),
        babelLoaderSource.replace('import(t)', 'import(`${t}`)'),
        babelLoaderSource.replace('import_', 'loadSomething'),
        babelLoaderSource.replace('return import(t)', 't="./missing.mjs";return import(t)'),
        babelLoaderSource.replace('m.exports', 'other.exports'),
        babelLoaderSource.replace('require_import', 'other_factory'),
        babelLoaderSource.replace('__commonJSMin', 'other_wrapper'),
        'function import_(t){return import(t)}',
        'const t="./missing.mjs";import(t)',
    ]) {
        bundled.set('extension/playgroundWorker.mjs', Buffer.from(invalid));
        assert.throws(() => inspectJavaScript(bundled, [report]), /nonliteral dynamic import cannot be verified/);
    }
    bundled.set(
        'extension/playgroundWorker.mjs',
        Buffer.from(babelLoaderSource + `function extra(){${babelLoaderSource}}`),
    );
    assert.throws(() => inspectJavaScript(bundled, [report]), /exceeds babelConfigFileImports allowlist/);
    bundled.set('extension/playgroundWorker.mjs', Buffer.from(''));
    assert.throws(() => inspectJavaScript(bundled, [report]), /expected exactly 1 babelConfigFileImports/);
    bundled.set('extension/main.mjs', Buffer.from(babelLoaderSource));
    assert.throws(() => inspectJavaScript(bundled, [report]), /nonliteral dynamic import cannot be verified/);
    bundled.set('extension/main.mjs', Buffer.from(''));
    bundled.set('extension/playgroundWorker.mjs', Buffer.from(babelLoaderSource));
    const nonHostReport = { ...report, chunks: report.chunks.filter((chunk) => chunk.name !== 'main') };
    assert.throws(() => inspectJavaScript(bundled, [nonHostReport]), /nonliteral dynamic import cannot be verified/);
    report.chunks[1].moduleIds = [];
    assert.throws(() => inspectJavaScript(bundled, [report]), /nonliteral dynamic import cannot be verified/);
});

test('manifest assets derive generic local file paths and JSON pointers, including string and object icons', () => {
    const packageJson = {
        icon: 'resources/marketplace.png',
        contributes: {
            languages: [
                {
                    extensions: ['.documentdb.js'],
                    configuration: './language.json',
                    icon: { light: './light.svg', dark: 'dark.svg' },
                },
            ],
            grammars: [{ path: './syntaxes/playground.tmGrammar.json' }],
            snippets: [{ path: './snippets.json' }],
            commands: [{ command: 'documentDB.command.open', icon: 'icons/command.svg' }, { icon: '$(add)' }],
            views: { explorer: [{ icon: { light: 'icons/view-light.svg', dark: 'icons/view-dark.svg' } }] },
            viewsContainers: { activitybar: [{ icon: 'icons/container.svg' }] },
            walkthroughs: [{ steps: [{ media: { markdown: './walkthrough.md' } }] }],
            jsonValidation: [
                { url: './schema.json' },
                { url: 'https://example.test/schema.json' },
                { url: 'file:///schema.json' },
                { url: '//example.test/schema.json' },
            ],
            typescriptServerPlugins: [{ name: './plugin.js' }, { name: 'plugin-package' }],
            configuration: {
                properties: {
                    'example/with~escape': { default: './defaults.json' },
                    remote: { default: '${workspaceFolder}/config.json' },
                },
            },
        },
    };
    assert.deepEqual(manifestAssets(packageJson), [
        { path: 'extension/resources/marketplace.png', pointer: '/icon' },
        { path: 'extension/language.json', pointer: '/contributes/languages/0/configuration' },
        { path: 'extension/light.svg', pointer: '/contributes/languages/0/icon/light' },
        { path: 'extension/dark.svg', pointer: '/contributes/languages/0/icon/dark' },
        { path: 'extension/syntaxes/playground.tmGrammar.json', pointer: '/contributes/grammars/0/path' },
        { path: 'extension/snippets.json', pointer: '/contributes/snippets/0/path' },
        { path: 'extension/icons/command.svg', pointer: '/contributes/commands/0/icon' },
        { path: 'extension/icons/view-light.svg', pointer: '/contributes/views/explorer/0/icon/light' },
        { path: 'extension/icons/view-dark.svg', pointer: '/contributes/views/explorer/0/icon/dark' },
        { path: 'extension/icons/container.svg', pointer: '/contributes/viewsContainers/activitybar/0/icon' },
        { path: 'extension/walkthrough.md', pointer: '/contributes/walkthroughs/0/steps/0/media/markdown' },
        { path: 'extension/schema.json', pointer: '/contributes/jsonValidation/0/url' },
        { path: 'extension/plugin.js', pointer: '/contributes/typescriptServerPlugins/0/name' },
        {
            path: 'extension/defaults.json',
            pointer: '/contributes/configuration/properties/example~1with~0escape/default',
        },
    ]);
    assert.throws(() => manifestAssets({ icon: '../outside.svg' }), /must resolve inside extension/);
});

test('missing contributed grammar fails with the packaged path and JSON pointer', () => {
    const grammar = 'extension/syntaxes/documentdb-playground.tmGrammar.json';
    const bundled = new Map([
        [
            'extension/package.json',
            Buffer.from(
                JSON.stringify({
                    contributes: { grammars: [{ path: './syntaxes/documentdb-playground.tmGrammar.json' }] },
                }),
            ),
        ],
        [grammar, Buffer.from('{}')],
    ]);
    inspectManifestAssets(bundled);
    bundled.delete(grammar);
    assert.throws(() => inspectManifestAssets(bundled), {
        message: `VSIX missing manifest-declared asset: ${grammar} (/contributes/grammars/0/path)`,
    });
});

test('every runtime asset is required with its reason, including the shell declarations', () => {
    const bundled = new Map(runtimeAssets.map((asset) => [asset.path, Buffer.from('fixture')]));
    inspectRuntimeAssets(bundled);
    for (const asset of runtimeAssets) {
        const missing = new Map(bundled);
        missing.delete(asset.path);
        assert.throws(() => inspectRuntimeAssets(missing), {
            message: `VSIX missing runtime asset: ${asset.path} (${asset.reason})`,
        });
    }
});

test('unrelated informational asset removal passes the asset gates and is still reported', () => {
    const unrelated = 'extension/resources/readme/vscode-documentdb-hero-screenshot.png';
    const bundled = new Map([
        ...files,
        ...runtimeAssets.map((asset) => [asset.path, Buffer.from('fixture')]),
        [unrelated, Buffer.from('image')],
    ]);
    const baseline = { version: 1, tolerance: { fraction: 0.1, absoluteBytes: 4096 }, files: manifest(bundled) };
    bundled.delete(unrelated);
    inspectManifestAssets(bundled);
    inspectRuntimeAssets(bundled);
    assert.deepEqual(compareManifest(bundled, baseline).removed, [unrelated]);
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
    inspectJavaScript(bundled, [viewReport, { ...report, chunkFormat: 'commonjs' }]);
    bundled.set('extension/worker.cjs', Buffer.from('export const value = 1;'));
    assert.throws(() => inspectJavaScript(bundled, [viewReport, report]), /sourceType: module/);
    bundled.set('extension/worker.cjs', Buffer.from('import("./missing.mjs");'));
    assert.throws(() => inspectJavaScript(bundled, [viewReport, report]), /missing dynamic import/);
    bundled.set('extension/worker.cjs', Buffer.from('console.log("DEVSERVER");'));
    assert.throws(() => inspectJavaScript(bundled, [viewReport, report]), /development-server/);
});

test('host chunks and the CJS plugin require their own report ownership and matching packaged hashes', () => {
    const { createHash } = require('node:crypto');
    const host = hostFixture();
    const views = viteFixture();
    host.bundled.set('extension/playgroundWorker.mjs', Buffer.from(babelLoaderSource));
    views.bundled.set('extension/views.js', Buffer.from('export function render(){}'));
    const bundled = new Map([
        ['extension.vsixmanifest', Buffer.from('<xml/>')],
        ['[Content_Types].xml', Buffer.from('<xml/>')],
        ['extension/package.json', Buffer.from('{"main":"./main.mjs"}')],
        ['extension/package.nls.json', Buffer.from('{}')],
        ['extension/LICENSE.md', Buffer.from('license')],
        ['extension/NOTICE.html', Buffer.from('notice')],
        ...runtimeAssets.map((asset) => [asset.path, Buffer.from('fixture')]),
        ...host.bundled,
        ...views.bundled,
    ]);
    for (const { report } of [host, views]) {
        for (const asset of Object.keys(report.assetHashes)) {
            report.assetHashes[asset] = createHash('sha256')
                .update(bundled.get(`extension/${asset}`))
                .digest('hex');
        }
    }
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-host-ownership-'));
    const filename = path.join(directory, 'fixture.vsix');
    const writeReports = () => {
        fs.writeFileSync(path.join(directory, 'host.json'), JSON.stringify(host.report));
        fs.writeFileSync(path.join(directory, 'views.json'), JSON.stringify(views.report));
    };
    try {
        writeReports();
        writeVsix(filename, bundled);
        inspect(filename, { reports: directory });
        const pluginHash = host.report.assetHashes['playgroundTsPlugin.cjs'];
        delete host.report.assetHashes['playgroundTsPlugin.cjs'];
        views.report.assetHashes['playgroundTsPlugin.cjs'] = pluginHash;
        writeReports();
        assert.throws(
            () => inspect(filename, { reports: directory }),
            /playgroundTsPlugin: host bundle report missing assetHashes ownership/,
        );
        host.report.assetHashes['playgroundTsPlugin.cjs'] = pluginHash;
        delete views.report.assetHashes['playgroundTsPlugin.cjs'];
        for (const asset of ['main.mjs', 'playgroundWorker.mjs', 'playgroundTsPlugin.cjs', 'runtime.mjs']) {
            const hash = host.report.assetHashes[asset];
            delete host.report.assetHashes[asset];
            writeReports();
            assert.throws(() => inspect(filename, { reports: directory }), /unowned script/);
            host.report.assetHashes[asset] = hash;
            writeReports();
            const data = bundled.get(`extension/${asset}`);
            bundled.set(`extension/${asset}`, Buffer.concat([data, Buffer.from('\n/* changed bytes */')]));
            writeVsix(filename, bundled);
            assert.throws(
                () => inspect(filename, { reports: directory }),
                /bundle report does not match packaged JavaScript/,
            );
            bundled.set(`extension/${asset}`, data);
            writeVsix(filename, bundled);
        }
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
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

function viteFixture() {
    const chunks = [
        {
            fileName: 'views.js',
            isEntry: true,
            imports: ['runtime.js'],
            dynamicImports: Object.keys(viewModules).map((name) => `${name}.js`),
            moduleIds: [],
        },
        { fileName: 'runtime.js', imports: ['shared.js'], dynamicImports: ['monaco-AbC12345.js'], moduleIds: [] },
        { fileName: 'shared.js', imports: ['runtime.js'], moduleIds: ['./node_modules/react/index.js'] },
        {
            fileName: 'monaco-AbC12345.js',
            imports: [],
            moduleIds: ['./node_modules/monaco-editor/esm/vs/editor/editor.api.js'],
        },
        { fileName: 'slickgrid.js', imports: [], moduleIds: ['./node_modules/@slickgrid-universal/common/index.js'] },
        ...Object.entries(viewModules).map(([name, facadeModuleId]) => ({
            fileName: `${name}.js`,
            facadeModuleId,
            imports:
                name === 'collectionView'
                    ? ['monaco-AbC12345.js', 'slickgrid.js']
                    : name === 'documentView'
                      ? ['monaco-AbC12345.js']
                      : [],
            dynamicImports: ['monaco-AbC12345.js'],
            moduleIds: [facadeModuleId],
        })),
    ];
    return {
        report: {
            bundler: 'vite',
            chunkFormat: 'module',
            chunks,
            assetHashes: Object.fromEntries(chunks.map((chunk) => [chunk.fileName, 'fixture'])),
        },
        bundled: new Map(chunks.map((chunk) => [`extension/${chunk.fileName}`, Buffer.from('')])),
    };
}

test('Vite view graphs include only entry and view static closures, including cycles', () => {
    const { report, bundled } = viteFixture();
    const graphs = viewGraphs(report, bundled);
    assert.deepEqual(graphs.localQuickStart, {
        assets: ['localQuickStart.js', 'runtime.js', 'shared.js', 'views.js'],
        bsonModules: [],
        monaco: false,
        slickgrid: false,
    });
    assert.deepEqual(graphs.collectionView.assets, [
        'collectionView.js',
        'monaco-AbC12345.js',
        'runtime.js',
        'shared.js',
        'slickgrid.js',
        'views.js',
    ]);
    assert.equal(graphs.collectionView.monaco, true);
    assert.equal(graphs.collectionView.slickgrid, true);
    assert.equal(graphs.documentView.monaco, true);
    assert.equal(graphs.documentView.slickgrid, false);
});

test('Vite requires the mapped lazy chunk to be a direct dynamic import of views.js', () => {
    const { report, bundled } = viteFixture();
    const lazy = report.chunks.find((chunk) => chunk.fileName === 'localQuickStart.js');
    lazy.facadeModuleId = null;
    assert.throws(() => viteViewGraph(report, 'localQuickStart', bundled), /localQuickStart: missing lazy chunk/);
    lazy.facadeModuleId = viewModules.localQuickStart;
    report.chunks[0].dynamicImports = [];
    assert.throws(() => viteViewGraph(report, 'localQuickStart', bundled), /localQuickStart: missing lazy chunk/);
    report.chunks[0].isEntry = false;
    assert.throws(() => viteViewGraph(report, 'localQuickStart', bundled), /missing entry views\.js/);
});

test('every Vite graph chunk must exist in both the report and the VSIX', () => {
    const { report, bundled } = viteFixture();
    bundled.delete('extension/shared.js');
    assert.throws(() => viteViewGraph(report, 'localQuickStart', bundled), /localQuickStart: missing chunk shared\.js/);
    report.chunks = report.chunks.filter((chunk) => chunk.fileName !== 'shared.js');
    assert.throws(
        () => viteViewGraph(report, 'localQuickStart', bundled),
        /localQuickStart: bundle report missing chunk shared\.js/,
    );
});

test('Vite enforces lightweight views by default, even with an explicit false option', () => {
    for (const name of ['localQuickStart', 'atlasCredentials']) {
        for (const asset of ['monaco-AbC12345.js', 'slickgrid.js']) {
            const { report, bundled } = viteFixture();
            report.chunks.find((chunk) => chunk.fileName === `${name}.js`).imports.push(asset);
            assert.throws(
                () => viewGraphs(report, bundled, { requireLightweightViews: false }),
                (error) => error.message === `${name} must exclude Monaco and SlickGrid`,
            );
        }
    }
});

test('webpack views keep the shared entry fallback and opt-in lightweight enforcement', () => {
    const report = {
        entrypoints: { views: { chunks: [1] } },
        chunks: [
            { id: 1, files: ['views.js'], modules: [{ identifier: '/repo/node_modules/monaco-editor/index.js' }] },
        ],
    };
    assert.equal(viewGraphs(report, files).localQuickStart.monaco, true);
    assert.throws(
        () => viewGraphs(report, files, { requireLightweightViews: true }),
        /localQuickStart must exclude Monaco and SlickGrid/,
    );
});

test('Vite counts BSON once across shared closures and rejects duplicate implementations', () => {
    const { report, bundled } = viteFixture();
    const bson = './node_modules/bson/lib/bson.mjs';
    report.chunks.find((chunk) => chunk.fileName === 'shared.js').moduleIds.push(bson);
    const lazy = report.chunks.find((chunk) => chunk.fileName === 'localQuickStart.js');
    lazy.imports.push('shared.js');
    lazy.moduleIds.push(bson);
    assert.deepEqual(viteViewGraph(report, 'localQuickStart', bundled).bsonModules, ['node_modules/bson/lib/bson.mjs']);
    lazy.moduleIds.push('./node_modules/foo/node_modules/bson/lib/bson.mjs');
    assert.throws(() => viewGraphs(report, bundled), /localQuickStart: expected at most one BSON module, got 2/);
});

test('Vite-owned numeric .e calls are not webpack chunk loaders', () => {
    const { report } = viteFixture();
    const bundled = new Map(files);
    bundled.set('extension/views.js', Buffer.from('export function render() {}; x.e(5);'));
    inspectJavaScript(bundled, [report]);
});

test('Monaco module-loader allowlist is scoped to one exact template in a Vite Monaco chunk', () => {
    const filename = 'extension/monaco-AbC12345.js';
    const source = '(function(e,r){let t=$s.asBrowserUri(`${e}.js`).toString(!0);r(()=>import(`${t}`));});';
    const report = { bundler: 'vite', chunkFormat: 'module', assetHashes: { 'monaco-AbC12345.js': 'fixture' } };
    const bundled = new Map([[filename, Buffer.from(source)]]);
    inspectJavaScript(bundled, [report]);
    bundled.set(filename, Buffer.from(source + source));
    assert.throws(
        () => inspectJavaScript(bundled, [report]),
        /nonliteral dynamic import exceeds monacoModuleLoaderImports allowlist/,
    );
    for (const invalid of [
        'import(globalThis.x)',
        'import(`${globalThis.x}`)',
        'import(`prefix${globalThis.x}`)',
        'import(`${globalThis.x}suffix`)',
        'import(`${globalThis.x}${globalThis.y}`)',
    ]) {
        bundled.set(filename, Buffer.from(invalid));
        assert.throws(() => inspectJavaScript(bundled, [report]), /nonliteral dynamic import cannot be verified/);
    }
    bundled.set(filename, Buffer.from(source));
    assert.throws(
        () => inspectJavaScript(bundled, [{ ...report, bundler: 'webpack' }]),
        /nonliteral dynamic import cannot be verified/,
    );
    for (const other of [
        'extension/monaco.js',
        'extension/assets/monaco-AbC12345.js',
        'extension/other-AbC12345.js',
        'extension/editor.worker-AbC12345.js',
        'extension/json.worker-AbC12345.js',
    ]) {
        assert.throws(
            () =>
                inspectJavaScript(new Map([[other, Buffer.from(source)]]), [
                    { ...report, assetHashes: { [other.slice('extension/'.length)]: 'fixture' } },
                ]),
            /nonliteral dynamic import cannot be verified/,
        );
    }
    const entry = new Map(files);
    entry.set('extension/views.js', Buffer.from('export function render() {}; ' + source));
    assert.throws(
        () => inspectJavaScript(entry, [{ ...viewReport, bundler: 'vite' }]),
        /views\.js: nonliteral dynamic import cannot be verified/,
    );
});

for (const worker of ['editor', 'json']) {
    test(`Monaco ${worker} worker permits two reviewed loader calls, never identifiers or a third import`, () => {
        const filename = `extension/${worker}.worker-AbC12345.js`;
        const source = '(function(moduleId){import(`${FileAccess.asBrowserUri(`${moduleId}.js`).toString(!0)}`);});';
        const report = {
            bundler: 'vite',
            chunkFormat: 'module',
            assetHashes: { [`${worker}.worker-AbC12345.js`]: 'fixture' },
        };
        const bundled = new Map([[filename, Buffer.from(source)]]);
        inspectJavaScript(bundled, [report]);
        bundled.set(filename, Buffer.from(source.repeat(2)));
        inspectJavaScript(bundled, [report]);
        bundled.set(filename, Buffer.from(source.repeat(3)));
        assert.throws(
            () => inspectJavaScript(bundled, [report]),
            /nonliteral dynamic import exceeds monacoModuleLoaderImports allowlist/,
        );
        bundled.set(filename, Buffer.from('import(`${t}`);'));
        assert.throws(() => inspectJavaScript(bundled, [report]), /nonliteral dynamic import cannot be verified/);
        bundled.set(filename, Buffer.from(source));
        assert.throws(
            () => inspectJavaScript(bundled, [{ ...report, bundler: 'webpack' }]),
            /nonliteral dynamic import cannot be verified/,
        );
        const entry = new Map(files);
        entry.set('extension/views.js', Buffer.from('export function render() {}; ' + source));
        assert.throws(
            () => inspectJavaScript(entry, [{ ...viewReport, bundler: 'vite' }]),
            /views\.js: nonliteral dynamic import cannot be verified/,
        );
    });
}

test('Monaco loader calls require the reviewed asBrowserUri and toString member-call chain', () => {
    const filename = 'extension/monaco-AbC12345.js';
    const report = { bundler: 'vite', chunkFormat: 'module', assetHashes: { 'monaco-AbC12345.js': 'fixture' } };
    const bundled = new Map([
        [filename, Buffer.from('function load(n){import(`${FileAccess.asBrowserUri(`${n}.js`).toString(!0)}`);}')],
    ]);
    inspectJavaScript(bundled, [report]);
    for (const source of [
        'import(`${FileAccess.asBrowserUri(`${n}.js`)}`)',
        'import(`${FileAccess.other(`${n}.js`).toString(!0)}`)',
        'import(`${FileAccess.asBrowserUri.toString(!0)}`)',
        'import(`${FileAccess.asBrowserUri(`${n}.js`).other(!0)}`)',
        'import(`${FileAccess.asBrowserUri(`${n}.js`)[toString](!0)}`)',
        'import(`${FileAccess[asBrowserUri](`${n}.js`).toString(!0)}`)',
        'import(`${loadModule(n)}`)',
    ]) {
        bundled.set(filename, Buffer.from(`function load(n){${source}}`));
        assert.throws(() => inspectJavaScript(bundled, [report]), /nonliteral dynamic import cannot be verified/);
    }
});

test('Monaco identifier provenance follows lexical ancestors, including the shipped minified block and callback', () => {
    const filename = 'extension/monaco-AbC12345.js';
    const report = { bundler: 'vite', chunkFormat: 'module', assetHashes: { 'monaco-AbC12345.js': 'fixture' } };
    for (const source of [
        'function load(e,r){{let t=$s.asBrowserUri(`${e}.js`).toString(!0);r(()=>import(`${t}`).then(o),[],import.meta.url);}}',
        'function load(e){let t;t=$s.asBrowserUri(`${e}.js`).toString(!0);import(`${t}`);}',
        'function load(e){t=$s.asBrowserUri(`${e}.js`).toString(!0);import(`${t}`);}',
        'function load(e){{var t=$s.asBrowserUri(`${e}.js`).toString(!0);}import(`${t}`);}',
        'class Loader{$loadForeignModule(e){const renamed=Access.asBrowserUri(`${e}.js`).toString(true);return ()=>import(`${renamed}`);}}',
    ]) {
        inspectJavaScript(new Map([[filename, Buffer.from(source)]]), [report]);
    }
});

test('Monaco rejects top-level shapes, unrelated bindings, shadows, sibling scopes and unreviewed reassignments', () => {
    const filename = 'extension/monaco-AbC12345.js';
    const report = { bundler: 'vite', chunkFormat: 'module', assetHashes: { 'monaco-AbC12345.js': 'fixture' } };
    const worker = '$s.asBrowserUri(`${e}.js`).toString(!0)';
    for (const source of [
        'const s4Proof="./missing-proof.js";import(`${s4Proof}`);',
        `import(\`\${${worker}}\`);`,
        'function load(){const t="./missing.js";import(`${t}`);}',
        'function load(){import(`${t}`);}',
        `function load(e){let t=${worker};return (t)=>import(\`\${t}\`);}`,
        `function load(e){let t=${worker};{let t="./missing.js";import(\`\${t}\`);}}`,
        `function load(e){let t=${worker};{let {t}=object;import(\`\${t}\`);}}`,
        `function load(e){let t=${worker};try{}catch(t){import(\`\${t}\`);}}`,
        `function load(e){{let t=${worker};}import(\`\${t}\`);}`,
        `function other(e){let t=${worker};}function load(){import(\`\${t}\`);}`,
        `function load(e){import(\`\${t}\`);let t=${worker};}`,
        `function load(e){let t;{t=${worker};}import(\`\${t}\`);}`,
        `function load(e){let t=${worker};t="./missing.js";import(\`\${t}\`);}`,
        `function load(e){let t=${worker};r(()=>import(\`\${t}\`));t="./missing.js";}`,
        `function load(e){let t=${worker};t+=suffix;import(\`\${t}\`);}`,
        `function load(e){let t=${worker};t++;import(\`\${t}\`);}`,
        `function load(e){let t;({t}=${worker});import(\`\${t}\`);}`,
        `let t=${worker};function load(){import(\`\${t}\`);}`,
    ]) {
        assert.throws(
            () => inspectJavaScript(new Map([[filename, Buffer.from(source)]]), [report]),
            /nonliteral dynamic import cannot be verified/,
            source,
        );
    }
});

test('Vite expression-free template imports are static references, not allowlisted expressions', () => {
    const report = {
        ...viewReport,
        bundler: 'vite',
        assetHashes: { ...viewReport.assetHashes, 'chunk.js': 'fixture' },
    };
    const bundled = new Map([
        ['extension/views.js', Buffer.from('export function render() {}; import(`./chunk.js`);')],
        ['extension/chunk.js', Buffer.from('')],
    ]);
    inspectJavaScript(bundled, [report]);
    assert.throws(
        () => inspectJavaScript(bundled, [{ ...report, bundler: 'webpack' }]),
        /nonliteral dynamic import cannot be verified/,
    );
    bundled.delete('extension/chunk.js');
    assert.throws(() => inspectJavaScript(bundled, [report]), /views\.js: missing dynamic import\/asset \.\/chunk\.js/);
});

test('Vite literal new URL assets resolve relative to the packaged importing file', () => {
    const report = { ...viewReport, bundler: 'vite', assetHashes: { ...viewReport.assetHashes } };
    const bundled = new Map(files);
    for (const asset of ['codicon-AbC12345.ttf', 'editor.worker-AbC12345.js', 'json.worker-AbC12345.js']) {
        bundled.set(
            'extension/views.js',
            Buffer.from(`export function render() {}; new URL("./${asset}?v=1#font", import.meta.url);`),
        );
        assert.throws(
            () => inspectJavaScript(bundled, [report]),
            (error) => error.message === `extension/views.js: missing dynamic import/asset ./${asset}?v=1#font`,
        );
        bundled.set(`extension/${asset}`, Buffer.from(''));
        report.assetHashes[asset] = 'fixture';
        inspectJavaScript(bundled, [report]);
        bundled.set(
            'extension/views.js',
            Buffer.from('export function render() {}; new URL(`./' + asset + '`, import.meta.url);'),
        );
        inspectJavaScript(bundled, [report]);
        bundled.delete(`extension/${asset}`);
        assert.throws(() => inspectJavaScript(bundled, [report]), /missing dynamic import\/asset/);
    }
    bundled.set(
        'extension/views.js',
        Buffer.from('export function render() {}; new URL("/root.ttf", import.meta.url)'),
    );
    assert.throws(() => inspectJavaScript(bundled, [report]), /root-relative asset/);
});

test('Vite facade-module map matches every literal lazy import in WebviewRegistry', () => {
    const registryPath = path.resolve(__dirname, '../../src/webviews/_integration/WebviewRegistry.ts');
    const registry = fs.readFileSync(registryPath, 'utf8');
    const imports = [...registry.matchAll(/(\w+): React\.lazy\(\(\) =>\s*import\(['"]([^'"]+)['"]\)/g)];
    assert.deepEqual(
        Object.fromEntries(
            imports.map(([, name, module]) => [name, path.resolve(path.dirname(registryPath), `${module}.tsx`)]),
        ),
        Object.fromEntries(
            Object.entries(viewModules).map(([name, module]) => [name, path.resolve(__dirname, '../..', module)]),
        ),
    );
});
