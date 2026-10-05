/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('acorn');
const { ancestor, fullAncestor } = require('acorn-walk');
const { readVsix } = require('./vsix.cjs');

const viewModules = {
    collectionView: './src/webviews/documentdb/collectionView/CollectionView.tsx',
    documentView: './src/webviews/documentdb/documentView/documentView.tsx',
    localQuickStart: './src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx',
    atlasCredentials: './src/webviews/documentdb/atlasCredentials/AtlasCredentialsView.tsx',
    clusterDashboard: './src/webviews/documentdb/clusterDashboard/ClusterDashboard.tsx',
};
// Monaco's bootstrap loaders are unused: our ESM worker entries pass request-handler factories,
// and we never use foreign modules. Keep their reviewed import shapes and counts tightly scoped.
const monacoModuleLoaderImports = [
    { filename: /^extension\/monaco-[A-Za-z0-9_-]+\.js$/, maximum: 1, allowIdentifier: true },
    { filename: /^extension\/(?:editor|json)\.worker-[A-Za-z0-9_-]+\.js$/, maximum: 2, allowIdentifier: false },
];
const requiredFiles = [
    'extension.vsixmanifest',
    '[Content_Types].xml',
    'extension/package.json',
    'extension/views.js',
    'extension/playgroundWorker.js',
    'extension/playgroundTsPlugin.js',
    'extension/package.nls.json',
    'extension/LICENSE.md',
    'extension/NOTICE.html',
];
const runtimeAssets = [
    {
        path: 'extension/typeDefs/documentdb-shell-api.d.ts',
        reason: 'Playground TS plugin and getShellApiDtsContent read shell declarations',
    },
    {
        path: 'extension/resources/prompts/index-advisor-find.prompt.md',
        reason: 'Index advisor loads the find prompt body',
    },
    {
        path: 'extension/resources/prompts/index-advisor-aggregate.prompt.md',
        reason: 'Index advisor loads the aggregate prompt body',
    },
    {
        path: 'extension/resources/prompts/index-advisor-count.prompt.md',
        reason: 'Index advisor loads the count prompt body',
    },
    {
        path: 'extension/resources/icons/playground-block-active.svg',
        reason: 'Playground block highlighter loads the dark active gutter icon',
    },
    {
        path: 'extension/resources/icons/playground-block-active-light.svg',
        reason: 'Playground block highlighter loads the light active gutter icon',
    },
    {
        path: 'extension/resources/icons/playground-block-inactive.svg',
        reason: 'Playground block highlighter loads the dark inactive gutter icon',
    },
    {
        path: 'extension/resources/icons/playground-block-inactive-light.svg',
        reason: 'Playground block highlighter loads the light inactive gutter icon',
    },
    { path: 'extension/resources/icons/document-view-light.svg', reason: 'Document View loads its light panel icon' },
    { path: 'extension/resources/icons/document-view-dark.svg', reason: 'Document View loads its dark panel icon' },
    {
        path: 'extension/resources/icons/collection-view-light.svg',
        reason: 'Collection View and Cluster Dashboard load their light panel icon',
    },
    {
        path: 'extension/resources/icons/collection-view-dark.svg',
        reason: 'Collection View and Cluster Dashboard load their dark panel icon',
    },
    {
        path: 'extension/resources/icons/vscode-documentdb-icon-light-themes.svg',
        reason: 'Quick Start, credentials and local connection nodes load their light icon',
    },
    {
        path: 'extension/resources/icons/vscode-documentdb-icon-dark-themes.svg',
        reason: 'Quick Start, credentials and local connection nodes load their dark icon',
    },
    {
        path: 'extension/resources/icons/vscode-documentdb-cluster-light-themes.svg',
        reason: 'Kubernetes cluster nodes load their light icon',
    },
    {
        path: 'extension/resources/icons/vscode-documentdb-cluster-dark-themes.svg',
        reason: 'Kubernetes cluster nodes load their dark icon',
    },
    {
        path: 'extension/resources/icons/theme-agnostic/AzureDocumentDb.svg',
        reason: 'Azure DocumentDB nodes and selection steps load their icon',
    },
    {
        path: 'extension/resources/from_node_modules/@microsoft/vscode-azext-azureutils/resources/azureSubscription.svg',
        reason: 'Azure subscription nodes and selection steps load their icon',
    },
    {
        path: 'extension/resources/from_node_modules/@microsoft/vscode-azext-azureutils/resources/azureIcons/AzureCosmosDb.svg',
        reason: 'Azure RU nodes and selection steps load their icon',
    },
    {
        path: 'extension/resources/from_node_modules/@microsoft/vscode-azext-azureutils/resources/azureIcons/MongoClusters.svg',
        reason: 'Azure discovery subscription nodes load their icon',
    },
    {
        path: 'extension/resources/debug/query-insights-stage1.json',
        reason: 'Query Insights reads the stage 1 debug override when present',
    },
    {
        path: 'extension/resources/debug/query-insights-stage2.json',
        reason: 'Query Insights reads the stage 2 debug override when present',
    },
];
// ADO regenerates NOTICE.html (notice@0) and falls back to the committed copy if that task fails.
const sizeExempt = new Set(['extension/NOTICE.html']);

function manifest(files) {
    return [...files]
        .map(([name, data]) => ({ path: name, bytes: data.length }))
        .sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeAssetPath(filename) {
    const basename = path.posix.basename(filename);
    // Match the usual eight-character hash first: its alphabet includes hyphens.
    const normalized = basename
        .replace(/^[a-f0-9]{20}(\.[^.]+)$/i, '[hash]$1')
        .replace(/-[A-Za-z0-9_-]{8}(\.[^.]+)$/, '-[hash]$1')
        .replace(/-([A-Za-z0-9_]{3,})(\.[^.]+)$/, (match, hash, extension) =>
            /[A-Z0-9_]/.test(hash) ? `-[hash]${extension}` : match,
        );
    return path.posix.join(path.posix.dirname(filename), normalized);
}

function inspectRequiredFiles(files) {
    for (const filename of requiredFiles) {
        assert.ok(files.has(filename), `VSIX missing required file: ${filename}`);
    }
    const { main } = JSON.parse(files.get('extension/package.json').toString('utf8'));
    assert.ok(typeof main === 'string' && main.length > 0, 'extension/package.json: required main field is missing');
    const resolved = path.posix.normalize(path.posix.join('extension', main));
    assert.ok(
        !path.posix.isAbsolute(main) && resolved.startsWith('extension/'),
        `extension/package.json: main must resolve inside extension/: ${main}`,
    );
    assert.ok(
        files.has(resolved) || files.has(`${resolved}.js`),
        `VSIX missing required file for package.json main: ${resolved} (or ${resolved}.js)`,
    );
}

function manifestAssets(packageJson) {
    const assets = [];
    function walk(value, pointer) {
        if (typeof value === 'string') {
            if (/^[A-Za-z][A-Za-z0-9+.-]*:|^[/\\]|\$\{|\$\(/.test(value)) {
                return;
            }
            const reference = value.split(/[?#]/)[0];
            // Bare dotted identifiers and language suffixes are not file paths; qualified paths
            // may have multi-dot filenames (grammars, declarations), as may bare .d.ts files.
            if (
                !/^[^\s\\]+\.[A-Za-z][A-Za-z0-9]*$/.test(reference) ||
                (!reference.includes('/') && !/^[^.\s]+(?:\.d)?\.[A-Za-z][A-Za-z0-9]*$/.test(reference))
            ) {
                return;
            }
            const resolved = path.posix.normalize(path.posix.join('extension', reference));
            assert.ok(
                resolved.startsWith('extension/'),
                `Manifest asset must resolve inside extension/: ${value} (${pointer})`,
            );
            assets.push({ path: resolved, pointer });
        } else if (value && typeof value === 'object') {
            for (const [key, child] of Object.entries(value)) {
                walk(child, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
            }
        }
    }
    walk(packageJson.icon, '/icon');
    walk(packageJson.contributes, '/contributes');
    return assets;
}

function inspectManifestAssets(files) {
    const assets = manifestAssets(JSON.parse(files.get('extension/package.json').toString('utf8')));
    for (const asset of assets) {
        assert.ok(files.has(asset.path), `VSIX missing manifest-declared asset: ${asset.path} (${asset.pointer})`);
    }
    return assets;
}

function inspectRuntimeAssets(files) {
    for (const asset of runtimeAssets) {
        assert.ok(files.has(asset.path), `VSIX missing runtime asset: ${asset.path} (${asset.reason})`);
    }
}

function compareManifest(files, baseline) {
    assert.equal(baseline.version, 1, 'Unsupported VSIX baseline version');
    const remaining = new Map(manifest(files).map((entry) => [entry.path, entry]));
    const pairs = [];
    const unmatched = [];
    for (const entry of baseline.files) {
        if (remaining.has(entry.path)) {
            pairs.push([entry, remaining.get(entry.path)]);
            remaining.delete(entry.path);
        } else {
            unmatched.push(entry);
        }
    }
    const logicalFiles = new Map();
    for (const entry of remaining.values()) {
        const logicalPath = normalizeAssetPath(entry.path);
        if (!logicalFiles.has(logicalPath)) {
            logicalFiles.set(logicalPath, []);
        }
        logicalFiles.get(logicalPath).push(entry);
    }
    const removed = [];
    for (const entry of unmatched) {
        const actual = logicalFiles.get(normalizeAssetPath(entry.path))?.shift();
        if (actual) {
            pairs.push([entry, actual]);
            remaining.delete(actual.path);
        } else {
            removed.push(entry.path);
        }
    }
    const sizeChanges = [];
    for (const [entry, actual] of pairs) {
        const tolerance = Math.max(baseline.tolerance.absoluteBytes, entry.bytes * baseline.tolerance.fraction);
        if (!sizeExempt.has(entry.path) && Math.abs(actual.bytes - entry.bytes) > tolerance) {
            sizeChanges.push({
                path: actual.path,
                baselinePath: entry.path,
                baselineBytes: entry.bytes,
                bytes: actual.bytes,
                deltaBytes: actual.bytes - entry.bytes,
                toleranceBytes: tolerance,
            });
        }
    }
    return {
        added: [...remaining.keys()].sort(),
        removed: removed.sort(),
        sizeChanges: sizeChanges.sort((left, right) => left.path.localeCompare(right.path)),
    };
}

function resolveAsset(files, filename, reference) {
    assert.ok(!reference.startsWith('/'), `${filename}: root-relative asset ${reference}`);
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(filename), reference.split(/[?#]/)[0]));
    assert.ok(files.has(resolved), `${filename}: missing dynamic import/asset ${reference}`);
}

function literalString(node, allowTemplate = false) {
    if (node?.type === 'Literal' && typeof node.value === 'string') {
        return node.value;
    }
    // Vite's minifier also prints constant strings as expression-free templates.
    if (
        allowTemplate &&
        node?.type === 'TemplateLiteral' &&
        node.expressions.length === 0 &&
        node.quasis.length === 1
    ) {
        return node.quasis[0].value.cooked;
    }
}

function isFunction(node) {
    return ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type);
}

function isScope(node) {
    return (
        isFunction(node) ||
        [
            'Program',
            'BlockStatement',
            'CatchClause',
            'ForStatement',
            'ForInStatement',
            'ForOfStatement',
            'SwitchStatement',
        ].includes(node.type)
    );
}

function bindingNames(pattern) {
    if (!pattern) return [];
    if (pattern.type === 'Identifier') return [pattern.name];
    if (pattern.type === 'RestElement') return bindingNames(pattern.argument);
    if (pattern.type === 'AssignmentPattern') return bindingNames(pattern.left);
    if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(bindingNames);
    if (pattern.type === 'ObjectPattern')
        return pattern.properties.flatMap((property) =>
            bindingNames(property.type === 'RestElement' ? property.argument : property.value),
        );
    return [];
}

function workerUriForm(expression) {
    const callee = expression?.callee;
    const uri = callee?.object;
    return (
        expression?.type === 'CallExpression' &&
        callee?.type === 'MemberExpression' &&
        !callee.computed &&
        callee.property.name === 'toString' &&
        uri?.type === 'CallExpression' &&
        uri.callee.type === 'MemberExpression' &&
        !uri.callee.computed &&
        uri.callee.property.name === 'asBrowserUri'
    );
}

function moduleLoaderBindings(tree) {
    const bindings = new Map();
    const assignments = [];
    function record(scope, pattern, node, value, valueScope = scope) {
        if (!bindings.has(scope)) bindings.set(scope, new Map());
        for (const name of bindingNames(pattern)) {
            const names = bindings.get(scope);
            if (!names.has(name)) names.set(name, []);
            names.get(name).push({ node, value, scope: valueScope });
        }
    }
    fullAncestor(tree, (node, _state, ancestors) => {
        const scopes = ancestors.filter(isScope);
        const scope = scopes.at(-1);
        if (node.type === 'VariableDeclarator') {
            const declaration = ancestors.at(-2);
            const bindingScope =
                declaration.kind === 'var'
                    ? scopes.findLast((entry) => isFunction(entry) || entry.type === 'Program')
                    : scope;
            record(bindingScope, node.id, node, node.id.type === 'Identifier' ? node.init : node.id);
        } else if (isFunction(node)) {
            for (const parameter of node.params) record(node, parameter, node, parameter);
            if (node.id) record(node.type === 'FunctionDeclaration' ? scopes.at(-2) : node, node.id, node, node);
        } else if (node.type === 'ClassDeclaration') {
            record(scope, node.id, node, node);
        } else if (node.type === 'CatchClause') {
            record(scope, node.param, node, node);
        } else if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
            assignments.push({ node, scopes });
        }
    });
    for (const { node, scopes } of assignments) {
        const target = node.type === 'AssignmentExpression' ? node.left : node.argument;
        for (const name of bindingNames(target)) {
            const scope = scopes.findLast((entry) => bindings.get(entry)?.has(name)) || scopes.at(-1);
            record(
                scope,
                { type: 'Identifier', name },
                node,
                node.operator === '=' && target.type === 'Identifier' ? node.right : node,
                scopes.at(-1),
            );
        }
    }
    return bindings;
}

function monacoModuleLoaderImportLimit(filename, node, ancestors, bindings) {
    const source = node.source;
    const allowance = monacoModuleLoaderImports.find((entry) => entry.filename.test(filename));
    if (
        !allowance ||
        !ancestors.some(isFunction) ||
        source.type !== 'TemplateLiteral' ||
        source.expressions.length !== 1 ||
        source.quasis.length !== 2 ||
        !source.quasis.every((quasi) => quasi.value.raw === '')
    ) {
        return 0;
    }
    const expression = source.expressions[0];
    if (workerUriForm(expression)) return allowance.maximum;
    if (allowance.allowIdentifier && expression.type === 'Identifier') {
        for (const scope of ancestors.filter(isScope).reverse()) {
            if (scope.type === 'Program') break;
            const writes = bindings.get(scope)?.get(expression.name);
            if (writes) {
                // Stop at the nearest binding, including shadows. Reject unreviewed writes even
                // after the import: a nested loader callback may run after those writes execute.
                const values = writes.filter((write) => write.value);
                return values.length > 0 &&
                    values.every((write) => workerUriForm(write.value)) &&
                    values.some((write) => write.node.end <= node.start && ancestors.includes(write.scope))
                    ? allowance.maximum
                    : 0;
            }
        }
    }
    return 0;
}

function inspectJavaScript(files, reports) {
    for (const [filename, data] of files) {
        if (!/\.(?:js|cjs|mjs)$/.test(filename)) {
            continue;
        }
        const source = data.toString('utf8');
        const compilations = reports.filter((report) =>
            Object.hasOwn(report.assetHashes || {}, filename.slice('extension/'.length)),
        );
        if (filename.startsWith('extension/')) {
            assert.ok(compilations.length > 0, `${filename}: unowned script; no bundle report assetHashes entry`);
        }
        const commonJs = filename.endsWith('.cjs') || compilations.some((report) => report.chunkFormat === 'commonjs');
        const viteOwned = compilations.some((report) => report.bundler === 'vite');
        const webpackCompilations = compilations.filter((report) => report.bundler !== 'vite');
        let monacoModuleLoaderImportCount = 0;
        assert.ok(!/127\.0\.0\.1:18080|DEVSERVER/.test(source), `${filename}: development-server string in production`);
        const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true });
        const bindings =
            viteOwned &&
            monacoModuleLoaderImports.some((entry) => entry.allowIdentifier && entry.filename.test(filename))
                ? moduleLoaderBindings(tree)
                : new Map();
        if (filename === 'extension/views.js') {
            assert.ok(
                tree.body.some(
                    (node) =>
                        node.type === 'ExportNamedDeclaration' &&
                        (node.specifiers.some(
                            (specifier) => (specifier.exported.name || specifier.exported.value) === 'render',
                        ) ||
                            node.declaration?.id?.name === 'render' ||
                            node.declaration?.declarations?.some((declaration) => declaration.id.name === 'render')),
                ),
                'views.js does not export render',
            );
        }
        ancestor(tree, {
            MetaProperty(node) {
                // A CommonJS bundle that contains `import.meta` throws a SyntaxError when `require`d.
                assert.ok(!(commonJs && node.meta.name === 'import'), `${filename}: import.meta in a CommonJS bundle`);
            },
            ImportExpression(node, _state, ancestors) {
                const maximum = viteOwned ? monacoModuleLoaderImportLimit(filename, node, ancestors, bindings) : 0;
                if (maximum > 0) {
                    monacoModuleLoaderImportCount++;
                    assert.ok(
                        monacoModuleLoaderImportCount <= maximum,
                        `${filename}: nonliteral dynamic import exceeds monacoModuleLoaderImports allowlist`,
                    );
                    return;
                }
                const reference = literalString(node.source, viteOwned);
                assert.ok(typeof reference === 'string', `${filename}: nonliteral dynamic import cannot be verified`);
                resolveAsset(files, filename, reference);
            },
            ImportDeclaration(node) {
                if (node.source.value.startsWith('.')) {
                    resolveAsset(files, filename, node.source.value);
                }
            },
            ExportNamedDeclaration(node) {
                if (node.source?.value.startsWith('.')) {
                    resolveAsset(files, filename, node.source.value);
                }
            },
            NewExpression(node) {
                const [reference, base] = node.arguments;
                const asset = literalString(reference, viteOwned);
                if (
                    viteOwned &&
                    node.callee.type === 'Identifier' &&
                    node.callee.name === 'URL' &&
                    typeof asset === 'string' &&
                    base?.type === 'MemberExpression' &&
                    !base.computed &&
                    base.property.name === 'url' &&
                    base.object.type === 'MetaProperty' &&
                    base.object.meta.name === 'import' &&
                    base.object.property.name === 'meta'
                ) {
                    resolveAsset(files, filename, asset);
                }
            },
            CallExpression(node) {
                // webpack lowers import() to its runtime's .e(chunkId) loader.
                if (
                    webpackCompilations.length > 0 &&
                    node.callee.type === 'MemberExpression' &&
                    node.callee.property.name === 'e' &&
                    node.arguments.length === 1 &&
                    node.arguments[0].type === 'Literal' &&
                    typeof node.arguments[0].value === 'number'
                ) {
                    assert.equal(
                        webpackCompilations.length,
                        1,
                        `${filename}: missing or ambiguous webpack compilation provenance`,
                    );
                    const id = String(node.arguments[0].value);
                    const chunk = webpackCompilations[0].chunks.find((candidate) => String(candidate.id) === id);
                    assert.ok(chunk, `${filename}: missing webpack chunk ${id} in its compilation report`);
                    for (const asset of chunk.files) {
                        assert.ok(files.has(`extension/${asset}`), `${filename}: missing webpack chunk asset ${asset}`);
                    }
                }
            },
        });
        // Inspect as a module first to retain the explicit CommonJS import.meta diagnostic.
        if (commonJs && !filename.endsWith('.mjs')) {
            parse(source, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
        }
    }
}

function collectModules(modules, collected) {
    for (const module of modules || []) {
        if (module.identifier) {
            collected.add(module.identifier.replaceAll('\\', '/'));
        }
        collectModules(module.modules, collected);
    }
}

function entryGraph(report, entryName, files, { allowAbsentBson = false } = {}) {
    const entry = report.entrypoints[entryName];
    assert.ok(entry, `Bundle report missing entry ${entryName}`);
    const pending = [...entry.chunks];
    const visited = new Set();
    const modules = new Set();
    const assets = new Set();
    while (pending.length) {
        const id = pending.pop();
        if (visited.has(id)) {
            continue;
        }
        visited.add(id);
        const chunk = report.chunks.find((candidate) => candidate.id === id);
        assert.ok(chunk, `Bundle report missing entry chunk ${id}`);
        for (const asset of chunk.files) {
            assert.ok(files.has(`extension/${asset}`), `${entryName}: missing chunk ${asset}`);
            assets.add(asset);
        }
        collectModules(chunk.modules, modules);
        pending.push(...(chunk.children || []), ...Object.values(chunk.childrenByOrder || {}).flat());
    }
    return summarizeGraph(entryName, assets, modules, allowAbsentBson);
}

function summarizeGraph(entryName, assets, modules, allowAbsentBson) {
    const bsonModules = [...modules].filter((identifier) =>
        /\/node_modules\/bson\/lib\/bson(?:\.bundle)?\.(?:mjs|cjs|js)(?:$|\?)/.test(identifier),
    );
    assert.ok(
        bsonModules.length === 1 || (allowAbsentBson && bsonModules.length === 0),
        `${entryName}: expected ${allowAbsentBson ? 'at most' : 'exactly'} one BSON module, got ${bsonModules.length}: ${bsonModules.join(', ')}`,
    );
    return {
        assets: [...assets].sort(),
        bsonModules: bsonModules.map((identifier) => identifier.slice(identifier.indexOf('/node_modules/') + 1)),
        monaco: [...modules].some((identifier) => identifier.includes('/monaco-editor/')),
        slickgrid: [...modules].some((identifier) => /\/(?:slickgrid|@slickgrid-universal)\//.test(identifier)),
    };
}

function viteViewGraph(report, name, files) {
    const entry = report.chunks.find((chunk) => chunk.isEntry && chunk.fileName === 'views.js');
    assert.ok(entry, 'Bundle report missing entry views.js');
    const lazy = report.chunks.find((chunk) => chunk.facadeModuleId === viewModules[name]);
    assert.ok(lazy && entry.dynamicImports.includes(lazy.fileName), `${name}: missing lazy chunk`);
    const chunks = new Map(report.chunks.map((chunk) => [chunk.fileName, chunk]));
    const pending = [entry.fileName, lazy.fileName];
    const assets = new Set();
    const modules = new Set();
    while (pending.length) {
        const asset = pending.pop();
        if (assets.has(asset)) {
            continue;
        }
        const chunk = chunks.get(asset);
        assert.ok(chunk, `${name}: bundle report missing chunk ${asset}`);
        assert.ok(files.has(`extension/${asset}`), `${name}: missing chunk ${asset}`);
        assets.add(asset);
        for (const moduleId of chunk.moduleIds) {
            modules.add(moduleId.replaceAll('\\', '/'));
        }
        // Only static edges: other views' lazy imports are not part of this view's graph.
        pending.push(...chunk.imports);
    }
    return summarizeGraph(name, assets, modules, true);
}

function viewGraphs(report, files, { requireLightweightViews = false } = {}) {
    const graphs = {};
    for (const name of Object.keys(viewModules)) {
        graphs[name] =
            report.bundler === 'vite'
                ? viteViewGraph(report, name, files)
                : entryGraph(report, report.entrypoints[name] ? name : 'views', files, { allowAbsentBson: true });
    }
    if (report.bundler === 'vite' || requireLightweightViews) {
        for (const name of ['localQuickStart', 'atlasCredentials']) {
            assert.ok(!graphs[name].monaco && !graphs[name].slickgrid, `${name} must exclude Monaco and SlickGrid`);
        }
    }
    return graphs;
}

function inspect(filename, options = {}) {
    const files = readVsix(filename);
    inspectRequiredFiles(files);
    const declaredAssets = inspectManifestAssets(files);
    inspectRuntimeAssets(files);
    const directory = options.reports || path.join(__dirname, 'reports');
    const reports = ['host', 'views'].map((name) =>
        JSON.parse(fs.readFileSync(path.join(directory, `${name}.json`), 'utf8')),
    );
    for (const report of reports) {
        assert.ok(
            ['commonjs', 'module'].includes(report.chunkFormat),
            `Bundle report has unknown chunk format ${report.chunkFormat}; regenerate it`,
        );
    }
    inspectJavaScript(files, reports);
    const graphs = {
        main: entryGraph(reports[0], 'main', files),
        playgroundWorker: entryGraph(reports[0], 'playgroundWorker', files),
        ...viewGraphs(reports[1], files, options),
    };
    for (const report of reports) {
        assert.ok(Object.keys(report.assetHashes).length > 0, 'Bundle report has no asset provenance');
        for (const [asset, hash] of Object.entries(report.assetHashes)) {
            assert.ok(files.has(`extension/${asset}`), `Bundle report references absent asset ${asset}`);
            assert.equal(
                createHash('sha256')
                    .update(files.get(`extension/${asset}`))
                    .digest('hex'),
                hash,
                `${asset}: bundle report does not match packaged JavaScript`,
            );
        }
    }
    const result = {
        version: 1,
        tolerance: { fraction: 0.1, absoluteBytes: 4096 },
        vsixBytes: fs.statSync(filename).size,
        files: manifest(files),
        graphs,
        requiredAssets: { manifestDeclared: declaredAssets, runtime: runtimeAssets },
    };
    const baseline = options.baseline ? JSON.parse(fs.readFileSync(options.baseline, 'utf8')) : undefined;
    result.manifestReport = {
        ...(baseline ? compareManifest(files, baseline) : { added: [], removed: [], sizeChanges: [] }),
        vsixBytes: {
            baselineBytes: baseline ? baseline.vsixBytes : null,
            bytes: result.vsixBytes,
            deltaBytes: baseline ? result.vsixBytes - baseline.vsixBytes : null,
        },
        graphAssetBytes: Object.fromEntries(
            Object.entries(graphs).map(([name, graph]) => [
                name,
                graph.assets.reduce((bytes, asset) => bytes + files.get(`extension/${asset}`).length, 0),
            ]),
        ),
    };
    return result;
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const filename = args.shift();
    if (!filename) {
        throw new Error(
            'Usage: node build/verification/inspect.cjs <vsix> [--write-baseline <file>] [--baseline <file>] [--manifest-report <file>] [--reports <directory>] [--require-lightweight-views]',
        );
    }
    const options = { baseline: path.join(__dirname, 'baseline.json') };
    let output;
    let manifestOutput;
    while (args.length) {
        const flag = args.shift();
        if (flag === '--write-baseline') {
            output = args.shift();
            assert.ok(output, '--write-baseline requires a filename');
            delete options.baseline;
        } else if (flag === '--baseline') {
            options.baseline = args.shift();
            assert.ok(options.baseline, '--baseline requires a filename');
        } else if (flag === '--manifest-report') {
            manifestOutput = args.shift();
            assert.ok(manifestOutput, '--manifest-report requires a filename');
        } else if (flag === '--reports') {
            options.reports = args.shift();
            assert.ok(options.reports, '--reports requires a directory');
        } else if (flag === '--require-lightweight-views') {
            options.requireLightweightViews = true;
        } else {
            throw new Error(`Unknown inspection option: ${flag}`);
        }
    }
    const result = inspect(filename, options);
    if (output) {
        const baseline = { ...result };
        delete baseline.manifestReport;
        fs.writeFileSync(output, JSON.stringify(baseline, null, 2) + '\n');
    }
    if (manifestOutput) {
        fs.writeFileSync(manifestOutput, JSON.stringify(result.manifestReport, null, 2) + '\n');
    }
    const report = result.manifestReport;
    console.error(
        `Manifest report (non-failing): ${report.added.length} added, ${report.removed.length} removed, ${report.sizeChanges.length} size changes beyond tolerance`,
    );
    console.error(
        `VSIX: ${report.vsixBytes.bytes} bytes; delta ${report.vsixBytes.deltaBytes ?? 'unavailable (no baseline)'} bytes`,
    );
    console.error(
        `Graph assets (bytes): ${Object.entries(report.graphAssetBytes)
            .map(([name, bytes]) => `${name}=${bytes}`)
            .join(', ')}`,
    );
    console.log(JSON.stringify(result, null, 2));
}

module.exports = {
    inspect,
    compareManifest,
    inspectRequiredFiles,
    manifestAssets,
    inspectManifestAssets,
    inspectRuntimeAssets,
    runtimeAssets,
    inspectJavaScript,
    entryGraph,
    viteViewGraph,
    viewGraphs,
    viewModules,
    manifest,
};
