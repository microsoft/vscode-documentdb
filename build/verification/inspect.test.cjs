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
    inspectRequiredFiles,
    manifestAssets,
    inspectManifestAssets,
    inspectRuntimeAssets,
    runtimeAssets,
    inspectJavaScript,
    hostGraphs,
    viteChunkClosure,
    viteViewGraph,
    viewGraphs,
    viewModules,
    inspectKeptClassName,
    measureSizeGraphs,
    measurePackageGraphs,
    packageOf,
} = require('./inspect.cjs');
const { readVsix, writeVsix, extractVsix } = require('./vsix.cjs');

const files = new Map([
    ['extension/package.json', Buffer.from('{"name":"fixture"}')],
    ['extension/views.js', Buffer.from('export function render() {}')],
]);
const viewReport = { bundler: 'vite', chunkFormat: 'module', assetHashes: { 'views.js': 'fixture' }, chunks: [] };
const babelImportModule = './node_modules/@babel/core/lib/config/files/import.cjs';
const monacoLoaderModule = './node_modules/monaco-editor/esm/vs/editor/common/services/editorSimpleWorker.js';

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
            moduleIds: [babelImportModule],
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
            facadeModuleId: './src/extension.ts',
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

test('Kubernetes SDK may be a dynamic child but must remain outside the main and implementation static closures', () => {
    const { report, bundled } = hostFixture();
    hostGraphs(report, bundled);
    report.chunks.find((chunk) => chunk.fileName === 'runtime.mjs').imports.push('kubernetes.mjs');
    assert.throws(() => hostGraphs(report, bundled), /main: static closure must exclude @kubernetes\/client-node/);
});

test('Kubernetes SDK cannot be eagerly imported by the awaited implementation or its static children', () => {
    for (const fileName of ['extension-AbC12345.mjs', 'bson.mjs']) {
        const { report, bundled } = hostFixture();
        report.chunks.find((chunk) => chunk.fileName === fileName).imports.push('kubernetes.mjs');
        assert.throws(() => hostGraphs(report, bundled), /main: static closure must exclude @kubernetes\/client-node/);
    }
});

test('main requires a unique implementation facade, not just an extension module in the graph', () => {
    for (const facadeModuleId of [null, './src/other-extension.ts']) {
        const { report, bundled } = hostFixture();
        report.chunks.find((chunk) => chunk.fileName === 'extension-AbC12345.mjs').facadeModuleId = facadeModuleId;
        assert.throws(
            () => hostGraphs(report, bundled),
            /main: expected exactly one extension implementation facade \.\/src\/extension\.ts/,
        );
    }
    const { report, bundled } = hostFixture();
    report.chunks.find((chunk) => chunk.fileName === 'bson.mjs').facadeModuleId = './src/extension.ts';
    assert.throws(
        () => hostGraphs(report, bundled),
        /main: expected exactly one extension implementation facade \.\/src\/extension\.ts/,
    );
});

test('the implementation must be a dynamic import of main, not only statically or indirectly reachable', () => {
    for (const imports of [[], ['extension-AbC12345.mjs']]) {
        const { report, bundled } = hostFixture();
        report.chunks[0].dynamicImports = [];
        report.chunks[0].imports.push(...imports);
        report.chunks.find((chunk) => chunk.fileName === 'runtime.mjs').dynamicImports.push('extension-AbC12345.mjs');
        assert.throws(
            () => hostGraphs(report, bundled),
            /main: extension implementation must be a dynamic import of main/,
        );
    }
});

test('dynamic runtime externals are allowed only in host-owned .mjs, not views, CJS or other packages', () => {
    const { report, bundled } = hostFixture();
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

const keptClassSource = 'var UserCancelledError=class extends Error{_isUserCancelledError=!0;stepName};export{};';

/** Inspects one packaged script, with a report chunk holding `moduleIds` or, if omitted, no chunk. */
function budgetFixture(fileName, moduleIds) {
    const report = {
        bundler: 'vite',
        chunkFormat: 'module',
        assetHashes: { [fileName]: 'fixture' },
        chunks: moduleIds ? [{ fileName, imports: [], dynamicImports: [], moduleIds }] : [],
    };
    return (source) => inspectJavaScript(new Map([[`extension/${fileName}`, Buffer.from(source)]]), [report]);
}

test('nonliteral imports within the budget of a module their chunk contains pass in any shape or chunk name', () => {
    const check = budgetFixture('any-name.mjs', ['./src/a.ts', babelImportModule]);
    for (const source of ['import(t)', 'function f(e){return import(`${e}.js`)}', 'import(`${globalThis.x}`)']) {
        assert.deepEqual(check(source), { 'extension/any-name.mjs': { count: 1, maximum: 1 } });
    }
    // An unused budget does not fail by itself.
    assert.deepEqual(check('import("./any-name.mjs")'), { 'extension/any-name.mjs': { count: 0, maximum: 1 } });
    // A chunk containing several budgeted modules gets their sum.
    budgetFixture('chunk.js', [babelImportModule, monacoLoaderModule])('import(a);import(b)');
});

test('nonliteral imports beyond the budget fail with the count and the maximum', () => {
    assert.throws(
        () => budgetFixture('chunk.js', [monacoLoaderModule])('import(a);function f(){return import(`${b}`)}'),
        (error) =>
            error.message === 'extension/chunk.js: 2 nonliteral dynamic imports exceed its nonLiteralImportBudget of 1',
    );
    assert.throws(
        () => budgetFixture('chunk.js', [babelImportModule, monacoLoaderModule])('import(a);import(b);import(c)'),
        /chunk\.js: 3 nonliteral dynamic imports exceed its nonLiteralImportBudget of 2/,
    );
});

test('a nonliteral import in a script no budget entry covers fails, whatever the script is named', () => {
    for (const [fileName, moduleIds] of [
        ['collectionView-AbC12345.js', ['./src/webviews/documentdb/collectionView/CollectionView.tsx']],
        ['monaco-AbC12345.js', ['./node_modules/monaco-editor/esm/vs/editor/editor.api.js']],
        // Worker names budget only scripts without a report chunk.
        ['editor.worker-AbC12345.js', []],
        ['css.worker-AbC12345.js', undefined],
        ['assets/editor.worker-AbC12345.js', undefined],
    ]) {
        assert.throws(
            () => budgetFixture(fileName, moduleIds)('import(t)'),
            (error) =>
                error.message ===
                `extension/${fileName}: nonliteral dynamic import cannot be verified; no nonLiteralImportBudget entry covers this script`,
        );
    }
});

test('Monaco worker scripts, which have no report chunk, are budgeted by their packaged name', () => {
    for (const worker of ['editor', 'json']) {
        const check = budgetFixture(`${worker}.worker-Ab_C-12x.js`);
        check('import(`${a}`);import(`${b}`)');
        assert.throws(
            () => check('import(a);import(b);import(c)'),
            /3 nonliteral dynamic imports exceed its nonLiteralImportBudget of 2/,
        );
    }
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

test('a packaged script needs exactly one owning report, so a views script cannot borrow host permissions', () => {
    const { report: host } = hostFixture();
    const views = {
        ...viewReport,
        chunks: [
            { name: 'views', fileName: 'views.js', isEntry: true, imports: [], dynamicImports: [], moduleIds: [] },
        ],
    };
    const owning = (report) => ({ ...report, assetHashes: { ...report.assetHashes, 'shared.mjs': 'same-bytes' } });
    const bundled = new Map([['extension/shared.mjs', Buffer.from("export const load = () => import('node:fs');")]]);
    inspectJavaScript(bundled, [owning(host), views]);
    assert.throws(() => inspectJavaScript(bundled, [host, owning(views)]), /shared\.mjs: missing dynamic import/);
    assert.throws(
        () => inspectJavaScript(bundled, [owning(host), owning(views)]),
        (error) =>
            error.message ===
            'extension/shared.mjs: ambiguous script owner; owned by host bundle report and views bundle report',
    );
    bundled.set('extension/shared.mjs', Buffer.from('export const value = 1;'));
    inspectJavaScript(bundled, [host, owning(views)]);
    assert.throws(() => inspectJavaScript(bundled, [owning(host), owning(views)]), /ambiguous script owner/);
});

test('.cjs is inspected as CommonJS and .mjs as a module', () => {
    const bundled = new Map([
        ...files,
        ['extension/worker.cjs', Buffer.from('module.exports.dir = import.meta.dirname;')],
        ['extension/module.mjs', Buffer.from('export const url = import.meta.url;')],
    ]);
    const report = {
        bundler: 'vite',
        chunkFormat: 'module',
        assetHashes: { 'worker.cjs': 'fixture', 'module.mjs': 'fixture' },
    };
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
    host.bundled.set('extension/main.mjs', Buffer.from(keptClassSource));
    views.bundled.set('extension/views.js', Buffer.from('export function render(){}'));
    views.bundled.set('extension/codicon-fixture.ttf', Buffer.alloc(100));
    views.report.assetHashes['codicon-fixture.ttf'] = 'fixture';
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
        const { manifestReport } = inspect(filename, { reports: directory });
        assert.deepEqual(Object.keys(manifestReport).sort(), [
            'graphAssetBytes',
            'graphPackages',
            'graphPackagesLimit',
            'graphSizes',
            'vsixBytes',
        ]);
        // These fixture reports predate moduleBytes, so no graph has package data.
        assert.deepEqual(manifestReport.graphPackages, {});
        assert.equal(manifestReport.graphPackagesLimit, 60);
        assert.deepEqual(manifestReport.vsixBytes, { bytes: fs.statSync(filename).size });
        assert.equal(manifestReport.graphSizes.vsix, manifestReport.vsixBytes.bytes);
        assert.equal(manifestReport.graphSizes.viewsAssets, 100);
        bundled.set('extension/codicon-fixture.ttf', Buffer.alloc(101));
        writeVsix(filename, bundled);
        assert.throws(
            () => inspect(filename, { reports: directory }),
            /codicon-fixture\.ttf: bundle report does not match packaged JavaScript/,
        );
        bundled.set('extension/codicon-fixture.ttf', Buffer.alloc(100));
        writeVsix(filename, bundled);
        host.bundled.set(
            'extension/main.mjs',
            Buffer.from(keptClassSource.replace('class extends', 'class e extends')),
        );
        bundled.set('extension/main.mjs', host.bundled.get('extension/main.mjs'));
        host.report.assetHashes['main.mjs'] = createHash('sha256')
            .update(bundled.get('extension/main.mjs'))
            .digest('hex');
        writeReports();
        writeVsix(filename, bundled);
        assert.throws(
            () => inspect(filename, { reports: directory }),
            /keepNames: no class named UserCancelledError in the main graph/,
        );
        bundled.set('extension/main.mjs', Buffer.from(keptClassSource));
        host.report.assetHashes['main.mjs'] = createHash('sha256')
            .update(bundled.get('extension/main.mjs'))
            .digest('hex');
        writeReports();
        writeVsix(filename, bundled);
        for (const bundler of ['webpack', undefined]) {
            views.report.bundler = bundler;
            writeReports();
            assert.throws(() => inspect(filename, { reports: directory }), /non-Vite views bundle report; regenerate/);
        }
        views.report.bundler = 'vite';
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

test('production render export and native imports are checked', () => {
    inspectJavaScript(files, [viewReport]);
    for (const [source, error] of [
        ['export function renamed() {}', /does not export render/],
        ['export function render() {}; import("./absent.js")', /missing dynamic/],
        ['export function render() {}; import("/root.js")', /root-relative/],
        ['export function render() {}; import(variable)', /nonliteral/],
        ['export function render() {}; console.log("DEVSERVER")', /development-server/],
        ['export function render() {}; console.log("127.0.0.1:18080")', /development-server/],
    ]) {
        const broken = new Map(files);
        broken.set('extension/views.js', Buffer.from(source));
        assert.throws(() => inspectJavaScript(broken, [viewReport]), error);
    }
    const split = new Map(files);
    split.set('extension/views.js', Buffer.from('function render() {}; export {render}; import("./chunk.js");'));
    split.set('extension/chunk.js', Buffer.from('export const value = 1'));
    const reports = [{ ...viewReport, assetHashes: { 'views.js': 'fixture', 'chunk.js': 'fixture' } }];
    inspectJavaScript(split, reports);
    split.delete('extension/chunk.js');
    assert.throws(() => inspectJavaScript(split, reports), /missing/);
});

test('import.meta is rejected in CommonJS bundles only, by syntax rather than text', () => {
    const bundled = new Map([
        ...files,
        ['extension/main.js', Buffer.from('module.exports.dir = import.meta.dirname;')],
    ]);
    const host = { bundler: 'vite', chunkFormat: 'commonjs', assetHashes: { 'main.js': 'fixture' }, chunks: [] };
    const views = viewReport;
    assert.throws(() => inspectJavaScript(bundled, [host, views]), /main\.js: import\.meta in a CommonJS bundle/);
    bundled.set('extension/main.js', Buffer.from('module.exports.text = "import.meta.dirname";'));
    inspectJavaScript(bundled, [host, views]);
    bundled.set('extension/views.js', Buffer.from('export function render() { return import.meta.url; }'));
    inspectJavaScript(bundled, [host, views]);
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

test('Vite always enforces lightweight views', () => {
    for (const name of ['localQuickStart', 'atlasCredentials']) {
        for (const asset of ['monaco-AbC12345.js', 'slickgrid.js']) {
            const { report, bundled } = viteFixture();
            report.chunks.find((chunk) => chunk.fileName === `${name}.js`).imports.push(asset);
            assert.throws(
                () => viewGraphs(report, bundled),
                (error) => error.message === `${name} must exclude Monaco and SlickGrid`,
            );
        }
    }
});

test('views reject webpack-format and unidentified reports instead of using the shared entry fallback', () => {
    const report = {
        entrypoints: { views: { chunks: [1] } },
        chunks: [
            { id: 1, files: ['views.js'], modules: [{ identifier: '/repo/node_modules/monaco-editor/index.js' }] },
        ],
    };
    for (const bundler of ['webpack', undefined]) {
        assert.throws(() => viewGraphs({ ...report, bundler }, files), /non-Vite views bundle report; regenerate/);
        assert.throws(
            () => inspectJavaScript(files, [{ ...viewReport, bundler }]),
            /non-Vite bundle report; regenerate/,
        );
    }
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

test('Vite expression-free template imports are static references, not budgeted expressions', () => {
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
        /non-Vite bundle report; regenerate/,
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

test('VSIX writer can deflate entries and keeps stored entries when deflating does not help', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-inspect-deflate-'));
    try {
        const input = new Map([
            ['extension/package.json', Buffer.from('{}')],
            ['extension/views.js', Buffer.from('export function render() {}\n'.repeat(1000))],
        ]);
        const stored = path.join(directory, 'stored.vsix');
        const deflated = path.join(directory, 'deflated.vsix');
        writeVsix(stored, input);
        writeVsix(deflated, input, { compress: true });
        assert.deepEqual(readVsix(deflated), input);
        assert.ok(fs.statSync(deflated).size < fs.statSync(stored).size / 10);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('size graphs sum packaged bytes of report-owned host, startup, view, entry and worker closures', () => {
    const host = hostFixture();
    const views = viteFixture();
    views.report.assetHashes['editor.worker-Ab_C-12x.js'] = 'fixture';
    views.report.assetHashes['codicon-AbC12345.ttf'] = 'fixture';
    const bundled = new Map([...host.bundled, ...views.bundled]);
    const sizes = {
        'main.mjs': 1,
        'runtime.mjs': 10,
        'extension-AbC12345.mjs': 100,
        'bson.mjs': 1000,
        'kubernetes.mjs': 10_000,
    };
    for (const [asset, bytes] of Object.entries(sizes)) {
        bundled.set(`extension/${asset}`, Buffer.alloc(bytes));
    }
    bundled.set('extension/views.js', Buffer.alloc(3));
    bundled.set('extension/localQuickStart.js', Buffer.alloc(5));
    bundled.set('extension/editor.worker-Ab_C-12x.js', Buffer.alloc(7));
    bundled.set('extension/codicon-AbC12345.ttf', Buffer.alloc(100_000));
    const graphs = { ...hostGraphs(host.report, bundled), ...viewGraphs(views.report, bundled) };
    const measured = measureSizeGraphs(bundled, host.report, views.report, graphs, 42);
    assert.deepEqual(Object.keys(measured), [
        'main',
        'mainStartup',
        'playgroundWorker',
        'playgroundTsPlugin',
        'viewsEntry',
        'viewsAssets',
        ...Object.keys(viewModules),
        'editorWorker',
        'vsix',
    ]);
    assert.equal(measured.main, 11_111);
    // The startup closure excludes the dynamic-only Kubernetes chunk.
    assert.equal(measured.mainStartup, 1111);
    assert.equal(measured.viewsEntry, 3);
    assert.equal(measured.viewsAssets, 100_000);
    assert.equal(measured.localQuickStart, 8);
    assert.equal(measured.editorWorker, 7);
    assert.equal(measured.vsix, 42);
    views.report.assetHashes['editor.worker-Zz_Y-98x.js'] = 'fixture';
    bundled.set('extension/editor.worker-Zz_Y-98x.js', Buffer.alloc(1));
    assert.throws(
        () => measureSizeGraphs(bundled, host.report, views.report, graphs, 42),
        /editorWorker: more than one packaged worker script/,
    );
    delete views.report.assetHashes['editor.worker-Zz_Y-98x.js'];
    delete views.report.assetHashes['localQuickStart.js'];
    assert.throws(
        () => measureSizeGraphs(bundled, host.report, views.report, graphs, 42),
        /localQuickStart: size graph counts localQuickStart\.js, which its bundle report does not own/,
    );
});

test('viewsAssets counts every owned non-script asset, excluding JavaScript and unrelated files', () => {
    const host = hostFixture();
    const views = viteFixture();
    const bundled = new Map([...host.bundled, ...views.bundled]);
    for (const [asset, bytes] of Object.entries({
        'codicon-fixture.ttf': 100,
        'styles.css': 20,
        'images/icon.svg': 7,
        'future-resource.bin': 3,
        'helper.js': 1000,
        'helper.cjs': 1000,
        'helper.mjs': 1000,
    })) {
        views.report.assetHashes[asset] = 'fixture';
        bundled.set(`extension/${asset}`, Buffer.alloc(bytes));
    }
    host.report.assetHashes['host-only.ttf'] = 'fixture';
    bundled.set('extension/host-only.ttf', Buffer.alloc(1000));
    bundled.set('extension/unowned.ttf', Buffer.alloc(1000));
    // Report size metadata cannot substitute for the packaged bytes.
    views.report.assets = [{ fileName: 'codicon-fixture.ttf', bytes: 1 }];
    const graphs = { ...hostGraphs(host.report, bundled), ...viewGraphs(views.report, bundled) };
    assert.equal(measureSizeGraphs(bundled, host.report, views.report, graphs, 42).viewsAssets, 130);
    bundled.delete('extension/styles.css');
    assert.throws(
        () => measureSizeGraphs(bundled, host.report, views.report, graphs, 42),
        /viewsAssets: missing packaged asset styles\.css/,
    );
});

test('viewsAssets remains required even when the views report owns no non-script assets', () => {
    const host = hostFixture();
    const views = viteFixture();
    const bundled = new Map([...host.bundled, ...views.bundled]);
    const graphs = { ...hostGraphs(host.report, bundled), ...viewGraphs(views.report, bundled) };
    const measured = measureSizeGraphs(bundled, host.report, views.report, graphs, 42);
    assert.ok(Object.hasOwn(measured, 'viewsAssets'));
    assert.equal(measured.viewsAssets, 0);
});

test('package attribution names npm packages, scoped or not, and groups our code by folder', () => {
    for (const [moduleId, expected] of [
        ['./node_modules/acorn/dist/acorn.mjs', 'acorn'],
        ['./node_modules/@fluentui/react-combobox/lib/index.js', '@fluentui/react-combobox'],
        ['./node_modules/foo/node_modules/@scope/bar/x.js?commonjs-proxy', '@scope/bar'],
        ['C:/agent/repo/node_modules/react/index.js', 'react'],
        ['C:\\agent\\repo\\node_modules\\react\\index.js', 'react'],
        ['./src/webviews/documentdb/collectionView/CollectionView.tsx', 'src/webviews'],
        ['./src/extension.ts', 'src'],
        ['./packages/vscode-ext-webview/src/index.ts', 'packages/vscode-ext-webview'],
        ['./l10n/bundle.l10n.json', 'l10n'],
        ['virtual:vite/preload-helper.js', '(virtual)'],
        ['/elsewhere/file.js', '(outside the repository)'],
    ]) {
        assert.equal(packageOf(moduleId), expected, moduleId);
    }
});

test('package graphs sum moduleBytes per package over the size graphs made of chunks', () => {
    const host = hostFixture();
    const views = viteFixture();
    const chunk = (report, fileName) => report.chunks.find((candidate) => candidate.fileName === fileName);
    chunk(host.report, 'main.mjs').moduleBytes = { './main.ts': 20 };
    chunk(host.report, 'extension-AbC12345.mjs').moduleBytes = { './src/extension.ts': 30, './src/tree/a.ts': 10 };
    chunk(host.report, 'bson.mjs').moduleBytes = { './node_modules/bson/lib/bson.cjs': 40 };
    chunk(host.report, 'kubernetes.mjs').moduleBytes = {
        './node_modules/@kubernetes/client-node/dist/index.js': 50,
        './node_modules/@kubernetes/client-node/dist/api.js': 50,
    };
    chunk(views.report, 'views.js').moduleBytes = { './src/webviews/index.tsx': 3 };
    chunk(views.report, 'shared.js').moduleBytes = { './node_modules/react/index.js': 40 };
    views.report.assetHashes['editor.worker-Ab_C-12x.js'] = 'fixture';
    const bundled = new Map([...host.bundled, ...views.bundled]);
    bundled.set('extension/editor.worker-Ab_C-12x.js', Buffer.alloc(7));
    const graphs = { ...hostGraphs(host.report, bundled), ...viewGraphs(views.report, bundled) };
    const packages = measurePackageGraphs(bundled, host.report, views.report, graphs);
    // Workers, viewsAssets and vsix have no module data; playgroundTsPlugin's chunk has none either.
    assert.deepEqual(Object.keys(packages), [
        'main',
        'mainStartup',
        'playgroundWorker',
        'viewsEntry',
        ...Object.keys(viewModules),
    ]);
    assert.deepEqual(packages.main, {
        '@kubernetes/client-node': 100,
        bson: 40,
        src: 30,
        'main.ts': 20,
        'src/tree': 10,
    });
    assert.deepEqual(packages.mainStartup, { bson: 40, src: 30, 'main.ts': 20, 'src/tree': 10 });
    assert.deepEqual(packages.collectionView, { react: 40, 'src/webviews': 3 });
});

test('package graphs keep exactly the 60 largest packages and add up the rest as (other)', () => {
    const host = hostFixture();
    const views = viteFixture();
    const bundled = new Map([...host.bundled, ...views.bundled]);
    const graphs = { ...hostGraphs(host.report, bundled), ...viewGraphs(views.report, bundled) };
    const main = host.report.chunks.find((chunk) => chunk.fileName === 'main.mjs');
    // No share cut-off: a tiny package stays tracked while there is room.
    const small = Array.from({ length: 10 }, (_, index) => [`./node_modules/small-${index}/index.js`, 1]);
    main.moduleBytes = Object.fromEntries([['./node_modules/big/index.js', 990], ...small]);
    const few = measurePackageGraphs(bundled, host.report, views.report, graphs).main;
    assert.equal(Object.keys(few).length, 11);
    assert.equal(few['small-9'], 1);
    assert.equal(few['(other)'], undefined);
    main.moduleBytes = Object.fromEntries(
        Array.from({ length: 70 }, (_, index) => [`./node_modules/package-${index}/index.js`, 100 + index]),
    );
    const bounded = measurePackageGraphs(bundled, host.report, views.report, graphs).main;
    assert.equal(Object.keys(bounded).length, 61);
    assert.equal(bounded['package-69'], 169);
    assert.equal(bounded['package-10'], 110);
    assert.equal(bounded['package-9'], undefined);
    assert.equal(bounded['(other)'], 100 + 101 + 102 + 103 + 104 + 105 + 106 + 107 + 108 + 109);
    main.moduleBytes = { './main.ts': -1 };
    assert.throws(
        () => measurePackageGraphs(bundled, host.report, views.report, graphs),
        /main: invalid moduleBytes for \.\/main\.ts/,
    );
});

test('keepNames check accepts the class name in each form Rolldown emits and fails when it is lost', () => {
    const check = (source) =>
        inspectKeptClassName(
            new Map([
                ['extension/other.mjs', Buffer.from('export const x = 1;')],
                ['extension/main.mjs', Buffer.from(source)],
            ]),
            ['other.mjs', 'main.mjs'],
        );
    for (const source of [
        keptClassSource,
        'class UserCancelledError extends Error{}',
        'var W=class UserCancelledError extends Error{}',
        'var W=class extends Error{static{__name(this,`UserCancelledError`)}}',
    ]) {
        check(source);
    }
    for (const source of [
        // Rolldown output without keepNames; the name survives only as an export alias and strings.
        'var W=class extends Error{_isUserCancelledError=!0};export{W as UserCancelledError}',
        'let{UserCancelledError:t}=x;const s=`UserCancelledError`;throw new UserCancelledError',
        'var UserCancelledError=class e extends Error{}',
        'f(class extends Error{})',
        'export {};',
    ]) {
        assert.throws(
            () => check(source),
            (error) =>
                error.message.startsWith(
                    'keepNames: no class named UserCancelledError in the main graph; the host build must keep class names (',
                ),
            source,
        );
    }
});
