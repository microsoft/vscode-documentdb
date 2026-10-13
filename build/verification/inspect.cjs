/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { builtinModules } = require('node:module');
const path = require('node:path');
const { parse } = require('acorn');
const { ancestor, fullAncestor, simple } = require('acorn-walk');
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
const babelConfigFileImports = {
    moduleId: './node_modules/@babel/core/lib/config/files/import.cjs',
    maximum: 1,
};
const nodeBuiltins = new Set(builtinModules);
const requiredFiles = [
    'extension.vsixmanifest',
    '[Content_Types].xml',
    'extension/package.json',
    'extension/views.js',
    'extension/main.mjs',
    'extension/playgroundWorker.mjs',
    'extension/playgroundTsPlugin.cjs',
    'extension/package.nls.json',
    'extension/LICENSE.md',
    'extension/NOTICE.html',
];
const runtimeAssets = [
    {
        path: 'extension/playgroundWorker.mjs',
        reason: "Playground starts the worker from path.join(ext.context.extensionPath, 'playgroundWorker.mjs')",
    },
    {
        path: 'extension/playgroundTsPlugin.cjs',
        reason: 'Runtime node_modules/documentdb-playground-ts-plugin/{package.json,index.cjs} stub loads ../../playgroundTsPlugin.cjs',
    },
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
// The host build sets Rolldown `keepNames` because runtime code reads `constructor.name`. Each entry
// names one class in the `main` graph, located by a member name the minifier does not rename.
const keptClassNames = [
    {
        name: 'UserCancelledError',
        member: '_isUserCancelledError',
        reason: 'Query Insights telemetry records err.constructor.name as errorKind, and its stream path throws @microsoft/vscode-azext-utils UserCancelledError on cancellation',
    },
];

function manifest(files) {
    return [...files]
        .map(([name, data]) => ({ path: name, bytes: data.length }))
        .sort((left, right) => left.path.localeCompare(right.path));
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

function isRuntimeExternal(reference) {
    return reference === 'vscode' || reference.startsWith('node:') || nodeBuiltins.has(reference);
}

function isViteHostReport(report) {
    return report.bundler === 'vite' && report.chunks?.some((chunk) => chunk.isEntry && chunk.fileName === 'main.mjs');
}

function bundleReportName(report, index) {
    if (isViteHostReport(report)) return 'host bundle report';
    if (report.chunks?.some((chunk) => chunk.isEntry && chunk.fileName === 'views.js')) return 'views bundle report';
    return `bundle report ${index + 1}`;
}

function babelConfigFileImportLimit(node, ancestors) {
    const helper = ancestors.at(-4);
    const assignment = ancestors.at(-5);
    const statement = ancestors.at(-6);
    const block = ancestors.at(-7);
    const factory = ancestors.at(-8);
    const call = ancestors.at(-9);
    const declaration = ancestors.at(-10);
    // Babel's import.cjs exports only function import_(filepath) { return import(filepath); }.
    // Its argument is a parameter, not an arbitrary binding/template. The bundled factory and
    // its exact body prevent another import elsewhere in the owning worker reusing this allowance.
    return node.source.type === 'Identifier' &&
        helper?.type === 'FunctionExpression' &&
        helper.id?.name === 'import_' &&
        !helper.async &&
        !helper.generator &&
        helper.params.length === 1 &&
        helper.params[0].type === 'Identifier' &&
        helper.params[0].name === node.source.name &&
        helper.body.body.length === 1 &&
        helper.body.body[0].type === 'ReturnStatement' &&
        helper.body.body[0].argument === node &&
        assignment?.type === 'AssignmentExpression' &&
        assignment.operator === '=' &&
        assignment.right === helper &&
        assignment.left.type === 'MemberExpression' &&
        !assignment.left.computed &&
        assignment.left.property.name === 'exports' &&
        assignment.left.object.type === 'Identifier' &&
        factory?.type === 'ArrowFunctionExpression' &&
        factory.params.length === 2 &&
        factory.params[1].type === 'Identifier' &&
        factory.params[1].name === assignment.left.object.name &&
        block === factory.body &&
        block.body.length === 1 &&
        block.body[0] === statement &&
        statement.type === 'ExpressionStatement' &&
        call?.type === 'CallExpression' &&
        call.arguments.length === 1 &&
        call.arguments[0] === factory &&
        call.callee.type === 'Identifier' &&
        ['__commonJSMin', '__commonJS'].includes(call.callee.name) &&
        declaration?.type === 'VariableDeclarator' &&
        declaration.id.name === 'require_import' &&
        declaration.init === call
        ? babelConfigFileImports.maximum
        : 0;
}

function inspectJavaScript(files, reports) {
    for (const report of reports) {
        assert.equal(report.bundler, 'vite', 'Obsolete non-Vite bundle report; regenerate with npm run package');
    }
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
            // One owner decides the script's permissions (host-only runtime imports, Babel allowance).
            if (compilations.length > 1) {
                const owners = reports.flatMap((report, index) =>
                    compilations.includes(report) ? [bundleReportName(report, index)] : [],
                );
                assert.fail(`${filename}: ambiguous script owner; owned by ${owners.join(' and ')}`);
            }
        }
        const commonJs =
            filename.endsWith('.cjs') ||
            (!filename.endsWith('.mjs') && compilations.some((report) => report.chunkFormat === 'commonjs'));
        const viteOwned = compilations.some((report) => report.bundler === 'vite');
        const hostOwned = compilations.some(isViteHostReport);
        const babelOwned =
            hostOwned &&
            filename.endsWith('.mjs') &&
            compilations.some(
                (report) =>
                    isViteHostReport(report) &&
                    report.chunks.some(
                        (chunk) =>
                            `extension/${chunk.fileName}` === filename &&
                            chunk.moduleIds.includes(babelConfigFileImports.moduleId),
                    ),
            );
        let monacoModuleLoaderImportCount = 0;
        let babelConfigFileImportCount = 0;
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
                if (babelOwned && babelConfigFileImportLimit(node, ancestors) > 0) {
                    babelConfigFileImportCount++;
                    assert.ok(
                        babelConfigFileImportCount <= babelConfigFileImports.maximum,
                        `${filename}: nonliteral dynamic import exceeds babelConfigFileImports allowlist`,
                    );
                    return;
                }
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
                if (hostOwned && filename.endsWith('.mjs') && isRuntimeExternal(reference)) return;
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
        });
        if (babelOwned) {
            assert.equal(
                babelConfigFileImportCount,
                babelConfigFileImports.maximum,
                `${filename}: expected exactly ${babelConfigFileImports.maximum} babelConfigFileImports allowlisted import`,
            );
        }
        // Inspect as a module first to retain the explicit CommonJS import.meta diagnostic.
        if (commonJs && !filename.endsWith('.mjs')) {
            parse(source, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
        }
    }
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

function viteChunkClosure(report, name, roots, files, { dynamic = false, host = false } = {}) {
    const chunks = new Map(report.chunks.map((chunk) => [chunk.fileName, chunk]));
    const pending = [...roots];
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
        if (host) {
            assert.ok(
                Object.hasOwn(report.assetHashes || {}, asset),
                `${name}: host bundle report missing assetHashes ownership for chunk ${asset}`,
            );
        }
        assets.add(asset);
        for (const moduleId of chunk.moduleIds) {
            modules.add(moduleId.replaceAll('\\', '/'));
        }
        const references = [...chunk.imports, ...(dynamic ? chunk.dynamicImports || [] : [])];
        pending.push(...references.filter((reference) => !(host && isRuntimeExternal(reference))));
    }
    return { assets, modules };
}

function viteViewGraph(report, name, files) {
    const entry = report.chunks.find((chunk) => chunk.isEntry && chunk.fileName === 'views.js');
    assert.ok(entry, 'Bundle report missing entry views.js');
    const lazy = report.chunks.find((chunk) => chunk.facadeModuleId === viewModules[name]);
    assert.ok(lazy && entry.dynamicImports.includes(lazy.fileName), `${name}: missing lazy chunk`);
    // Other views' lazy imports are not part of this view's graph.
    const { assets, modules } = viteChunkClosure(report, name, [entry.fileName, lazy.fileName], files);
    return summarizeGraph(name, assets, modules, true);
}

function hostGraphs(report, files) {
    assert.equal(report.bundler, 'vite', 'Obsolete non-Vite host bundle report; regenerate with npm run package');
    const graphs = {};
    for (const name of ['main', 'playgroundWorker', 'playgroundTsPlugin']) {
        const entry = report.chunks.find((chunk) => chunk.isEntry && chunk.name === name);
        assert.ok(entry, `Bundle report missing host entry ${name}`);
        const roots = [entry.fileName];
        const { assets, modules } = viteChunkClosure(report, name, roots, files, { dynamic: true, host: true });
        graphs[name] = summarizeGraph(name, assets, modules, name === 'playgroundTsPlugin');
        if (name === 'main') {
            const staticGraph = mainStartupClosure(report, entry, files);
            assert.ok(
                ![...staticGraph.modules].some((id) => /\/node_modules\/@kubernetes\/client-node\//.test(id)),
                'main: static closure must exclude @kubernetes/client-node; keep the SDK behind a dynamic import',
            );
        }
    }
    return graphs;
}

/** Imports-only closure of the `main` loader plus the extension implementation it awaits. */
function mainStartupClosure(report, entry, files) {
    const implementations = report.chunks.filter((chunk) => chunk.facadeModuleId === './src/extension.ts');
    assert.equal(
        implementations.length,
        1,
        'main: expected exactly one extension implementation facade ./src/extension.ts',
    );
    const implementation = implementations[0];
    assert.ok(
        entry.dynamicImports?.includes(implementation.fileName),
        'main: extension implementation must be a dynamic import of main',
    );
    // The thin loader awaits the implementation before activation; its static imports are startup code too.
    return viteChunkClosure(report, 'main', [entry.fileName, implementation.fileName], files, { host: true });
}

function viewGraphs(report, files) {
    assert.equal(report.bundler, 'vite', 'Obsolete non-Vite views bundle report; regenerate with npm run package');
    const graphs = {};
    for (const name of Object.keys(viewModules)) {
        graphs[name] = viteViewGraph(report, name, files);
    }
    for (const name of ['localQuickStart', 'atlasCredentials']) {
        assert.ok(!graphs[name].monaco && !graphs[name].slickgrid, `${name} must exclude Monaco and SlickGrid`);
    }
    return graphs;
}

function classRuntimeName(node, parent) {
    // Rolldown's keepNames helper form, and an explicit static `name`, override the binding name.
    for (const element of node.body.body) {
        if (element.type === 'StaticBlock') {
            for (const statement of element.body) {
                const call = statement.type === 'ExpressionStatement' ? statement.expression : undefined;
                if (
                    call?.type === 'CallExpression' &&
                    call.callee.type === 'Identifier' &&
                    call.callee.name === '__name' &&
                    call.arguments.length === 2 &&
                    call.arguments[0].type === 'ThisExpression' &&
                    typeof literalString(call.arguments[1], true) === 'string'
                ) {
                    return literalString(call.arguments[1], true);
                }
            }
        } else if (
            element.type === 'PropertyDefinition' &&
            element.static &&
            !element.computed &&
            element.key.type === 'Identifier' &&
            element.key.name === 'name' &&
            typeof literalString(element.value, true) === 'string'
        ) {
            return literalString(element.value, true);
        }
    }
    if (node.id) {
        return node.id.name;
    }
    // Anonymous class expressions take their name from the binding they initialise (NamedEvaluation).
    if (parent?.type === 'VariableDeclarator' && parent.init === node && parent.id.type === 'Identifier') {
        return parent.id.name;
    }
    if (
        parent?.type === 'AssignmentExpression' &&
        parent.operator === '=' &&
        parent.right === node &&
        parent.left.type === 'Identifier'
    ) {
        return parent.left.name;
    }
    if (parent?.type === 'AssignmentPattern' && parent.right === node && parent.left.type === 'Identifier') {
        return parent.left.name;
    }
    if (
        (parent?.type === 'Property' || parent?.type === 'PropertyDefinition') &&
        parent.value === node &&
        !parent.computed
    ) {
        return parent.key.type === 'Identifier' ? parent.key.name : String(parent.key.value);
    }
    return '';
}

function hasClassMember(node, member) {
    let found = node.body.body.some(
        (element) =>
            element.type === 'PropertyDefinition' &&
            !element.computed &&
            element.key.type === 'Identifier' &&
            element.key.name === member,
    );
    simple(node.body, {
        AssignmentExpression(assignment) {
            const target = assignment.left;
            found ||=
                target.type === 'MemberExpression' &&
                target.object.type === 'ThisExpression' &&
                !target.computed &&
                target.property.name === member;
        },
    });
    return found;
}

/** Every class in `source` carrying `entry.member`, with the `.name` it has at runtime. */
function keptClassNameSites(source, entry) {
    if (!source.includes(entry.member)) {
        return [];
    }
    const sites = [];
    const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true });
    const visit = (node, _state, ancestors) => {
        if (hasClassMember(node, entry.member)) {
            sites.push({ node, name: classRuntimeName(node, ancestors.at(-2)) });
        }
    };
    ancestor(tree, { ClassDeclaration: visit, ClassExpression: visit });
    return sites;
}

function inspectKeptClassNames(files, assets) {
    for (const entry of keptClassNames) {
        let count = 0;
        for (const asset of [...assets].sort()) {
            const filename = `extension/${asset}`;
            for (const site of keptClassNameSites(files.get(filename).toString('utf8'), entry)) {
                count++;
                assert.equal(
                    site.name,
                    entry.name,
                    `${filename}: keepNames: class with member ${entry.member} is named "${site.name || '(anonymous)'}" at runtime, expected "${entry.name}"; the host build must keep class names (${entry.reason})`,
                );
            }
        }
        assert.ok(
            count > 0,
            `keepNames: no class with member ${entry.member} (${entry.name}) in the main graph; re-review keptClassNames (${entry.reason})`,
        );
    }
}

function monacoWorkerAssets(report, files) {
    const chunkFiles = new Set(report.chunks.map((chunk) => chunk.fileName));
    const workers = {};
    for (const asset of Object.keys(report.assetHashes || {}).sort()) {
        const match = /^([A-Za-z0-9_]+)\.worker-[A-Za-z0-9_-]+\.js$/.exec(asset);
        if (!match || chunkFiles.has(asset)) {
            continue;
        }
        const name = `${match[1]}Worker`;
        assert.ok(!workers[name], `${name}: more than one packaged worker script (${workers[name]?.[0]}, ${asset})`);
        assert.ok(files.has(`extension/${asset}`), `${name}: missing worker script ${asset}`);
        workers[name] = [asset];
    }
    return workers;
}

/** Report-owned files per size graph, paired with the bundle report each set comes from. */
function sizeGraphAssets(files, hostReport, viewsReport, graphs) {
    const mainEntry = hostReport.chunks.find((chunk) => chunk.isEntry && chunk.name === 'main');
    assert.ok(mainEntry, 'Bundle report missing host entry main');
    const host = {
        main: graphs.main.assets,
        mainStartup: [...mainStartupClosure(hostReport, mainEntry, files).assets],
        playgroundWorker: graphs.playgroundWorker.assets,
        playgroundTsPlugin: graphs.playgroundTsPlugin.assets,
    };
    const views = {
        viewsEntry: [...viteChunkClosure(viewsReport, 'viewsEntry', ['views.js'], files).assets],
        viewsAssets: Object.keys(viewsReport.assetHashes).filter((asset) => !/\.(?:js|cjs|mjs)$/.test(asset)),
        ...Object.fromEntries(Object.keys(viewModules).map((name) => [name, graphs[name].assets])),
        ...monacoWorkerAssets(viewsReport, files),
    };
    return [
        [hostReport, host],
        [viewsReport, views],
    ];
}

/**
 * Packaged bytes per size graph. Every counted file must be owned by the bundle report its
 * graph comes from; `inspect` checks those reports' hashes against the packaged bytes.
 */
function measureSizeGraphs(files, hostReport, viewsReport, graphs, vsixBytes) {
    const measured = {};
    for (const [report, sizeGraphs] of sizeGraphAssets(files, hostReport, viewsReport, graphs)) {
        for (const [name, assets] of Object.entries(sizeGraphs)) {
            measured[name] = assets.reduce((bytes, asset) => {
                assert.ok(
                    Object.hasOwn(report.assetHashes, asset),
                    `${name}: size graph counts ${asset}, which its bundle report does not own`,
                );
                assert.ok(files.has(`extension/${asset}`), `${name}: missing packaged asset ${asset}`);
                return bytes + files.get(`extension/${asset}`).length;
            }, 0);
        }
    }
    measured.vsix = vsixBytes;
    return measured;
}

/** The npm package a bundle report module ID belongs to, or a short group for our own code. */
function packageOf(moduleId) {
    const id = moduleId.replaceAll('\\', '/').split('?')[0];
    if (id.startsWith('virtual:')) {
        return '(virtual)';
    }
    const nodeModules = id.lastIndexOf('/node_modules/');
    if (nodeModules >= 0) {
        const [first, second] = id.slice(nodeModules + '/node_modules/'.length).split('/');
        return first.startsWith('@') ? `${first}/${second}` : first;
    }
    if (!id.startsWith('./')) {
        return '(outside the repository)';
    }
    const segments = id.slice(2).split('/');
    return ['src', 'packages'].includes(segments[0]) && segments.length > 2
        ? `${segments[0]}/${segments[1]}`
        : segments[0];
}

// Stored as `graphPackagesLimit`, so the size comment's "top 60" wording follows the data.
const PACKAGE_LIMIT = 60;

/**
 * Approximate bytes per package (bundle report `moduleBytes`, before minification) for every size
 * graph made of chunks. The 60 largest packages of a graph are kept; the rest add up to `(other)`.
 * Graphs without module data (workers, `viewsAssets`, `vsix`) are omitted.
 */
function measurePackageGraphs(files, hostReport, viewsReport, graphs) {
    const measured = {};
    for (const [report, sizeGraphs] of sizeGraphAssets(files, hostReport, viewsReport, graphs)) {
        const chunks = new Map(report.chunks.map((chunk) => [chunk.fileName, chunk]));
        for (const [name, assets] of Object.entries(sizeGraphs)) {
            const chunkModules = assets.map((asset) => chunks.get(asset)?.moduleBytes).filter(Boolean);
            if (chunkModules.length === 0) {
                continue;
            }
            const packages = new Map();
            for (const [moduleId, bytes] of chunkModules.flatMap((moduleBytes) => Object.entries(moduleBytes))) {
                assert.ok(Number.isSafeInteger(bytes) && bytes >= 0, `${name}: invalid moduleBytes for ${moduleId}`);
                const pkg = packageOf(moduleId);
                packages.set(pkg, (packages.get(pkg) ?? 0) + bytes);
            }
            const kept = {};
            let other = 0;
            for (const [pkg, bytes] of [...packages].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))) {
                if (Object.keys(kept).length < PACKAGE_LIMIT) {
                    kept[pkg] = bytes;
                } else {
                    other += bytes;
                }
            }
            if (other > 0) {
                kept['(other)'] = other;
            }
            measured[name] = kept;
        }
    }
    return measured;
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
    assert.equal(reports[0].bundler, 'vite', 'Obsolete non-Vite host bundle report; regenerate with npm run package');
    assert.equal(reports[1].bundler, 'vite', 'Obsolete non-Vite views bundle report; regenerate with npm run package');
    inspectJavaScript(files, reports);
    const graphs = {
        ...hostGraphs(reports[0], files),
        ...viewGraphs(reports[1], files),
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
    inspectKeptClassNames(files, graphs.main.assets);
    const result = {
        version: 1,
        vsixBytes: fs.statSync(filename).size,
        files: manifest(files),
        graphs,
        requiredAssets: { manifestDeclared: declaredAssets, runtime: runtimeAssets },
    };
    result.manifestReport = {
        vsixBytes: {
            bytes: result.vsixBytes,
        },
        graphAssetBytes: Object.fromEntries(
            Object.entries(graphs).map(([name, graph]) => [
                name,
                graph.assets.reduce((bytes, asset) => bytes + files.get(`extension/${asset}`).length, 0),
            ]),
        ),
        graphSizes: measureSizeGraphs(files, reports[0], reports[1], graphs, result.vsixBytes),
        graphPackages: measurePackageGraphs(files, reports[0], reports[1], graphs),
        graphPackagesLimit: PACKAGE_LIMIT,
    };
    return result;
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const filename = args.shift();
    if (!filename) {
        throw new Error(
            'Usage: node build/verification/inspect.cjs <vsix> [--manifest-report <file>] [--reports <directory>]',
        );
    }
    const options = {};
    let manifestOutput;
    while (args.length) {
        const flag = args.shift();
        if (flag === '--manifest-report') {
            manifestOutput = args.shift();
            assert.ok(manifestOutput, '--manifest-report requires a filename');
        } else if (flag === '--reports') {
            options.reports = args.shift();
            assert.ok(options.reports, '--reports requires a directory');
        } else {
            throw new Error(`Unknown inspection option: ${flag}`);
        }
    }
    const result = inspect(filename, options);
    if (manifestOutput) {
        fs.writeFileSync(manifestOutput, JSON.stringify(result.manifestReport, null, 2) + '\n');
    }
    const report = result.manifestReport;
    console.error(`VSIX: ${report.vsixBytes.bytes} bytes`);
    console.error(
        `Graph assets (bytes): ${Object.entries(report.graphAssetBytes)
            .map(([name, bytes]) => `${name}=${bytes}`)
            .join(', ')}`,
    );
    console.error(
        `Graph sizes (bytes; not enforced): ${Object.entries(report.graphSizes)
            .map(([name, bytes]) => `${name}=${bytes}`)
            .join(', ')}`,
    );
    console.log(JSON.stringify(result, null, 2));
}

module.exports = {
    inspectKeptClassNames,
    keptClassNames,
    keptClassNameSites,
    measureSizeGraphs,
    measurePackageGraphs,
    packageOf,
    babelConfigFileImports,
    babelConfigFileImportLimit,
    viteChunkClosure,
    hostGraphs,
    inspect,
    inspectRequiredFiles,
    manifestAssets,
    inspectManifestAssets,
    inspectRuntimeAssets,
    runtimeAssets,
    inspectJavaScript,
    viteViewGraph,
    viewGraphs,
    viewModules,
    manifest,
};
