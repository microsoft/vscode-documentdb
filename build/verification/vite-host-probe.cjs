/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Builds probe entries with the shipped Vite host environment (production mode), not a parallel config.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repository = path.resolve(__dirname, '../..');

/**
 * @param {{ input: Record<string, string>, outputPath: string, pinned: string, withoutAlias: boolean }} options
 * `pinned` is a bare specifier that `vite.config.ext.mjs` must alias; `withoutAlias` drops that alias.
 */
async function buildHostProbes({ input, outputPath, pinned, withoutAlias }) {
    const { createBuilder } = await import('vite');
    const { default: createConfig } = await import(pathToFileURL(path.join(repository, 'vite.config.ext.mjs')));
    const config = await createConfig({ mode: 'production', command: 'build' });
    const pin = config.resolve.alias.find((alias) => alias.find instanceof RegExp && alias.find.test(pinned));
    assert.ok(pin, `vite.config.ext.mjs no longer pins ${pinned} (resolve.alias)`);
    const host = config.environments.host;
    let chunks;
    const builder = await createBuilder({
        ...config,
        configFile: false,
        mode: 'production',
        logLevel: 'silent',
        resolve: {
            ...config.resolve,
            alias: config.resolve.alias.filter((alias) => !(withoutAlias && alias === pin)),
        },
        environments: {
            host: {
                ...host,
                build: {
                    ...host.build,
                    outDir: outputPath,
                    rolldownOptions: { ...host.build.rolldownOptions, input },
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
                name: 'documentdb:host-probe-chunks',
                generateBundle(_options, bundle) {
                    chunks = Object.values(bundle).filter((output) => output.type === 'chunk');
                },
            },
        ],
    });
    await builder.buildApp();
    assert.ok(chunks, 'Host probe build produced no chunks');
    return chunks;
}

module.exports = { buildHostProbes };
