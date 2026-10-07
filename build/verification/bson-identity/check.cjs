/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Build runtime identity probes with the shipped Vite host environment, not a parallel config.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repository = path.resolve(__dirname, '../../..');
const probes = { main: 'hostProbe.ts', playgroundWorker: 'workerProbe.ts' };
const reference = 'mongodb';

async function compile(outputPath, { withoutAlias }) {
    const { createBuilder } = await import('vite');
    const { default: createConfig } = await import(pathToFileURL(path.join(repository, 'vite.config.ext.mjs')));
    const config = await createConfig({ mode: 'production', command: 'build' });
    const bsonAlias = config.resolve.alias.find((alias) => alias.find instanceof RegExp && alias.find.test('bson'));
    assert.ok(bsonAlias, 'vite.config.ext.mjs no longer pins bson (resolve.alias)');
    const host = config.environments.host;
    let chunks;
    const builder = await createBuilder({
        ...config,
        configFile: false,
        mode: 'production',
        logLevel: 'silent',
        resolve: {
            ...config.resolve,
            alias: config.resolve.alias.filter((alias) => !(withoutAlias && alias === bsonAlias)),
        },
        environments: {
            host: {
                ...host,
                build: {
                    ...host.build,
                    outDir: outputPath,
                    rolldownOptions: {
                        ...host.build.rolldownOptions,
                        input: Object.fromEntries(
                            Object.entries(probes).map(([name, file]) => [name, path.join(__dirname, file)]),
                        ),
                    },
                },
            },
        },
        builder: {
            async buildApp(builder) {
                await builder.build(builder.environments.host);
            },
        },
        // Never copy product assets or overwrite the packaged artifact's provenance report.
        plugins: [
            {
                name: 'documentdb:bson-probe-chunks',
                generateBundle(_options, bundle) {
                    chunks = Object.values(bundle).filter((output) => output.type === 'chunk');
                },
            },
        ],
    });
    await builder.buildApp();
    assert.ok(chunks, 'BSON probe build produced no chunks');
    return chunks;
}

function bsonModules(chunks, entryName) {
    const entry = chunks.find((chunk) => chunk.isEntry && chunk.name === entryName);
    assert.ok(entry, `BSON probe build missing entry ${entryName}`);
    const pending = [entry.fileName];
    const visited = new Set();
    const found = new Set();
    while (pending.length) {
        const filename = pending.pop();
        if (visited.has(filename)) continue;
        visited.add(filename);
        const chunk = chunks.find((candidate) => candidate.fileName === filename);
        assert.ok(chunk, `BSON probe build missing chunk ${filename}`);
        for (const moduleId of chunk.moduleIds) {
            const match = /\/node_modules\/((?:.*\/node_modules\/)?bson\/.*)$/.exec(moduleId.replaceAll('\\', '/'));
            if (match) found.add(match[1]);
        }
        pending.push(
            ...[...chunk.imports, ...chunk.dynamicImports].filter((name) =>
                chunks.some((candidate) => candidate.fileName === name),
            ),
        );
    }
    return [...found].sort();
}

async function checkBsonIdentity({ withoutAlias = false } = {}) {
    const outputPath = fs.mkdtempSync(path.join(os.tmpdir(), 'documentdb-bson-identity-'));
    try {
        const chunks = await compile(outputPath, { withoutAlias });
        const results = {};
        const failures = [];
        for (const name of Object.keys(probes)) {
            const modules = bsonModules(chunks, name);
            const { objectIdRoutes } = await import(pathToFileURL(path.join(outputPath, `${name}.mjs`)));
            const routes = objectIdRoutes();
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
    const results = await checkBsonIdentity({ withoutAlias: args.includes('--without-alias') });
    for (const [name, result] of Object.entries(results)) {
        console.log(
            `PASS: ${name}: ${result.routes.length} routes to ObjectId share one constructor (${result.bsonModules.join(', ')})`,
        );
    }
    if (args.includes('--prove')) {
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
