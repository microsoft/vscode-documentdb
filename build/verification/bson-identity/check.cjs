/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Runtime `bson` identity check. Builds small probe entries with `webpack.config.ext.cjs` (its
// resolve aliases, loaders, externals and production mode), runs them in Node, and requires every
// route to `ObjectId` in each graph to be the same constructor. L1 counts BSON modules in the shipped
// graphs; this checks identity at runtime. Stage 5 moved the shipped host build to
// vite.config.ext.mjs (same `bson` pin); until this check is ported to it, it exercises the webpack
// configuration's equivalent pin, not the shipped bundler.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');
const { BundleReportPlugin } = require('../BundleReportPlugin.cjs');

const repository = path.resolve(__dirname, '../../..');
const createConfig = require(path.join(repository, 'webpack.config.ext.cjs'));
const probes = { main: 'hostProbe.ts', playgroundWorker: 'workerProbe.ts' };
const reference = 'mongodb';

function probeConfig(outputPath, { withoutAlias }) {
    const config = createConfig({}, { mode: 'production' });
    assert.ok(config.resolve?.alias?.bson$, 'webpack.config.ext.cjs no longer pins bson (resolve.alias.bson$)');
    if (withoutAlias) {
        delete config.resolve.alias.bson$;
    }
    return {
        ...config,
        context: repository,
        entry: Object.fromEntries(Object.entries(probes).map(([name, file]) => [name, path.join(__dirname, file)])),
        output: { ...config.output, path: outputPath },
        // The report plugin would overwrite the real bundle report; copying assets is irrelevant here.
        plugins: config.plugins.filter(
            (plugin) => !(plugin instanceof BundleReportPlugin) && !(plugin instanceof CopyWebpackPlugin),
        ),
        infrastructureLogging: { level: 'error' },
    };
}

function compile(config) {
    return new Promise((resolve, reject) => {
        webpack(config, (error, stats) => {
            if (error) {
                reject(error);
            } else if (stats.hasErrors()) {
                reject(new Error(stats.toString({ all: false, errors: true })));
            } else {
                resolve(stats);
            }
        });
    });
}

function bsonModules(stats, entryName) {
    const json = stats.toJson({
        all: false,
        entrypoints: true,
        chunks: true,
        chunkModules: true,
        nestedModules: true,
        dependentModules: true,
        ids: true,
        chunkModulesSpace: Infinity,
        nestedModulesSpace: Infinity,
        groupModulesByAttributes: false,
        groupModulesByType: false,
        groupModulesByCacheStatus: false,
        groupModulesByLayer: false,
        groupModulesByPath: false,
        groupModulesByExtension: false,
    });
    const chunkIds = new Set(json.entrypoints[entryName].chunks);
    const found = new Set();
    const collect = (modules) => {
        for (const module of modules || []) {
            const identifier = (module.identifier || '').replaceAll('\\', '/');
            const match = /\/node_modules\/((?:.*\/node_modules\/)?bson\/.*)$/.exec(identifier);
            if (match) {
                found.add(match[1]);
            }
            collect(module.modules);
        }
    };
    for (const chunk of json.chunks.filter((candidate) => chunkIds.has(candidate.id))) {
        collect(chunk.modules);
    }
    return [...found].sort();
}

async function checkBsonIdentity({ withoutAlias = false } = {}) {
    const outputPath = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-bson-identity-'));
    try {
        const stats = await compile(probeConfig(outputPath, { withoutAlias }));
        const results = {};
        const failures = [];
        for (const name of Object.keys(probes)) {
            const modules = bsonModules(stats, name);
            const routes = require(path.join(outputPath, `${name}.js`)).objectIdRoutes();
            const expected = routes[reference];
            assert.equal(typeof expected, 'function', `${name}: ObjectId via ${reference} is not a constructor`);
            const instance = new expected();
            for (const [route, actual] of Object.entries(routes)) {
                if (actual !== expected || !(typeof actual === 'function' && instance instanceof actual)) {
                    failures.push(
                        `${name}: ObjectId via ${route} is not the same constructor as via ${reference} (bson modules in graph: ${modules.join(', ')})`,
                    );
                }
            }
            results[name] = { routes: Object.keys(routes), bsonModules: modules };
        }
        assert.equal(failures.length, 0, failures.join('\n'));
        return results;
    } finally {
        fs.rmSync(outputPath, { recursive: true, force: true });
    }
}

async function main(args) {
    const prove = args.includes('--prove');
    const results = await checkBsonIdentity({ withoutAlias: args.includes('--without-alias') });
    for (const [name, result] of Object.entries(results)) {
        console.log(
            `PASS: ${name}: ${result.routes.length} routes to ObjectId share one constructor (${result.bsonModules.join(', ')})`,
        );
    }
    if (prove) {
        // Negative control: without the alias, the ES-module route gets bson's ESM build.
        await assert.rejects(checkBsonIdentity({ withoutAlias: true }), /bson\/lib\/bson\.node\.mjs/);
        console.log('PASS: bson-alias-removed rejected for the expected reason');
    }
}

if (require.main === module) {
    main(process.argv.slice(2)).catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}

module.exports = { checkBsonIdentity };
