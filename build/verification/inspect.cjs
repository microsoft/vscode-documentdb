/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('acorn');
const { simple } = require('acorn-walk');
const { readVsix } = require('./vsix.cjs');

const viewNames = ['collectionView', 'documentView', 'localQuickStart', 'atlasCredentials', 'clusterDashboard'];

function manifest(files) {
    return [...files].map(([name, data]) => ({ path: name, bytes: data.length })).sort((left, right) => left.path.localeCompare(right.path));
}

function compareManifest(files, baseline) {
    assert.equal(baseline.version, 1, 'Unsupported VSIX baseline version');
    assert.deepEqual(manifest(files).map((entry) => entry.path), baseline.files.map((entry) => entry.path), 'VSIX file list differs from baseline');
    for (const entry of baseline.files) {
        const actual = files.get(entry.path).length;
        const tolerance = Math.max(baseline.tolerance.absoluteBytes, entry.bytes * baseline.tolerance.fraction);
        assert.ok(Math.abs(actual - entry.bytes) <= tolerance, `${entry.path}: size ${actual} differs from ${entry.bytes} by more than ${tolerance} bytes`);
    }
}

function resolveAsset(files, filename, reference) {
    assert.ok(!reference.startsWith('/'), `${filename}: root-relative asset ${reference}`);
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(filename), reference.split(/[?#]/)[0]));
    assert.ok(files.has(resolved), `${filename}: missing dynamic import/asset ${reference}`);
}

function inspectJavaScript(files, reports) {
    for (const [filename, data] of files) {
        if (!filename.endsWith('.js')) {
            continue;
        }
        const source = data.toString('utf8');
        const compilations = reports.filter((report) => Object.hasOwn(report.assetHashes || {}, filename.slice('extension/'.length)));
        assert.ok(!/127\.0\.0\.1:18080|DEVSERVER/.test(source), `${filename}: development-server string in production`);
        const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true });
        if (filename === 'extension/views.js') {
            assert.ok(tree.body.some((node) =>
                node.type === 'ExportNamedDeclaration' &&
                (node.specifiers.some((specifier) => (specifier.exported.name || specifier.exported.value) === 'render') ||
                    node.declaration?.id?.name === 'render' ||
                    node.declaration?.declarations?.some((declaration) => declaration.id.name === 'render'))),
            'views.js does not export render');
        }
        simple(tree, {
            ImportExpression(node) {
                assert.ok(node.source.type === 'Literal' && typeof node.source.value === 'string', `${filename}: nonliteral dynamic import cannot be verified`);
                resolveAsset(files, filename, node.source.value);
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
            CallExpression(node) {
                // webpack lowers import() to its runtime's .e(chunkId) loader.
                if (node.callee.type === 'MemberExpression' && node.callee.property.name === 'e' &&
                    node.arguments.length === 1 && node.arguments[0].type === 'Literal' && typeof node.arguments[0].value === 'number') {
                    assert.equal(compilations.length, 1, `${filename}: missing or ambiguous webpack compilation provenance`);
                    const id = String(node.arguments[0].value);
                    const chunk = compilations[0].chunks.find((candidate) => String(candidate.id) === id);
                    assert.ok(chunk, `${filename}: missing webpack chunk ${id} in its compilation report`);
                    for (const asset of chunk.files) {
                        assert.ok(files.has(`extension/${asset}`), `${filename}: missing webpack chunk asset ${asset}`);
                    }
                }
            },
        });
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
    const bsonModules = [...modules].filter((identifier) => /\/node_modules\/bson\/lib\/bson(?:\.bundle)?\.(?:mjs|cjs|js)(?:$|\?)/.test(identifier));
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

function inspect(filename, options = {}) {
    const files = readVsix(filename);
    const directory = options.reports || path.join(__dirname, 'reports');
    const reports = ['host', 'views'].map((name) => JSON.parse(fs.readFileSync(path.join(directory, `${name}.json`), 'utf8')));
    inspectJavaScript(files, reports);
    const graphs = {
        main: entryGraph(reports[0], 'main', files),
        playgroundWorker: entryGraph(reports[0], 'playgroundWorker', files),
    };
    for (const name of viewNames) {
        graphs[name] = entryGraph(reports[1], reports[1].entrypoints[name] ? name : 'views', files, { allowAbsentBson: true });
    }
    if (options.requireLightweightViews) {
        for (const name of ['localQuickStart', 'atlasCredentials']) {
            assert.ok(!graphs[name].monaco && !graphs[name].slickgrid, `${name} must exclude Monaco and SlickGrid`);
        }
    }
    for (const report of reports) {
        assert.ok(Object.keys(report.assetHashes).length > 0, 'Bundle report has no asset provenance');
        for (const [asset, hash] of Object.entries(report.assetHashes)) {
            assert.ok(files.has(`extension/${asset}`), `Bundle report references absent asset ${asset}`);
            assert.equal(createHash('sha256').update(files.get(`extension/${asset}`)).digest('hex'), hash, `${asset}: bundle report does not match packaged JavaScript`);
        }
    }
    const result = {
        version: 1,
        tolerance: { fraction: 0.1, absoluteBytes: 4096 },
        vsixBytes: fs.statSync(filename).size,
        files: manifest(files),
        graphs,
    };
    if (options.baseline) {
        compareManifest(files, JSON.parse(fs.readFileSync(options.baseline, 'utf8')));
    }
    return result;
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const filename = args.shift();
    if (!filename) {
        throw new Error('Usage: node build/verification/inspect.cjs <vsix> [--write-baseline <file>] [--baseline <file>] [--reports <directory>] [--require-lightweight-views]');
    }
    const options = { baseline: path.join(__dirname, 'baseline.json') };
    let output;
    while (args.length) {
        const flag = args.shift();
        if (flag === '--write-baseline') {
            output = args.shift();
            assert.ok(output, '--write-baseline requires a filename');
            delete options.baseline;
        } else if (flag === '--baseline') {
            options.baseline = args.shift();
            assert.ok(options.baseline, '--baseline requires a filename');
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
        fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    }
    console.log(JSON.stringify(result, null, 2));
}

module.exports = { inspect, compareManifest, inspectJavaScript, entryGraph, manifest };
