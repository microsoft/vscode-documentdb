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
        assert.ok(!/127\.0\.0\.1:18080|DEVSERVER/.test(source), `${filename}: development-server string in production`);
        const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true });
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
        simple(tree, {
            MetaProperty(node) {
                // A CommonJS bundle that contains `import.meta` throws a SyntaxError when `require`d.
                assert.ok(!(commonJs && node.meta.name === 'import'), `${filename}: import.meta in a CommonJS bundle`);
            },
            ImportExpression(node) {
                assert.ok(
                    node.source.type === 'Literal' && typeof node.source.value === 'string',
                    `${filename}: nonliteral dynamic import cannot be verified`,
                );
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
                if (
                    node.callee.type === 'MemberExpression' &&
                    node.callee.property.name === 'e' &&
                    node.arguments.length === 1 &&
                    node.arguments[0].type === 'Literal' &&
                    typeof node.arguments[0].value === 'number'
                ) {
                    assert.equal(
                        compilations.length,
                        1,
                        `${filename}: missing or ambiguous webpack compilation provenance`,
                    );
                    const id = String(node.arguments[0].value);
                    const chunk = compilations[0].chunks.find((candidate) => String(candidate.id) === id);
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

function inspect(filename, options = {}) {
    const files = readVsix(filename);
    inspectRequiredFiles(files);
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
    };
    for (const name of viewNames) {
        graphs[name] = entryGraph(reports[1], reports[1].entrypoints[name] ? name : 'views', files, {
            allowAbsentBson: true,
        });
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

module.exports = { inspect, compareManifest, inspectRequiredFiles, inspectJavaScript, entryGraph, manifest };
