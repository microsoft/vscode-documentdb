/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Vite build of the extension host. Writes into `dist/` next to the webview build
// (vite.config.views.mjs); `dist/` is the extension folder that gets packaged.
//
//   npm run vite-prod-ext   production build, writes build/verification/reports/host.json
//   npm run vite-dev-ext    unminified build with source maps, no report
//   npm run watch:ext       vite-dev-ext in watch mode
//
// Two builds (Vite environments), run one after the other by `builder.buildApp`:
//
//   host      `main.mjs` (thin loader, imports the extension chunk) and `playgroundWorker.mjs` (the
//             query playground's worker_threads entry), as ES modules with shared chunks.
//   tsPlugin  `playgroundTsPlugin.cjs`, the TypeScript server plugin. CommonJS, because TypeScript's
//             plugin loader `require`s the module and calls it as the plugin factory. Rolldown
//             emits one format per output, so it cannot share the host build.
//
// See docs/ai-and-plans/modernization/build-and-test-stack.md (Stage 5).

import fs from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vite';
import { bundleReport } from './build/vite/bundle-report.mjs'; // eslint-disable-line import/no-internal-modules
import { copyAssets } from './build/vite/copy-assets.mjs'; // eslint-disable-line import/no-internal-modules

const require = createRequire(import.meta.url);
const root = import.meta.dirname;
const reportFile = 'build/verification/reports/host.json';

// One `bson` per graph. `bson` ships separate CommonJS and ESM builds: the driver `require`s the
// CommonJS one, while an ES module (our ESM-only workspace packages) importing `bson` would get the
// ESM one. Two copies break `instanceof` across them. Pinned to the entry the driver uses;
// `build/verification/bson-identity/` checks it at runtime.
const bsonEntry = require.resolve('bson');

// Modules the bundles load at runtime instead of bundling. The VSIX ships no node_modules, so apart
// from `vscode` and Node built-ins these are optional dependencies whose loading is guarded (or
// only reached by shell proxy/configuration paths outside normal worker initialization).
// Keep guarded requires explicit even when
// Rolldown leaves them unresolved without an external: missing optional peers can become empty stubs.
const optionalExternals = new Set([
    // DocumentDB API driver (mongodb) optional dependencies
    'kerberos', // Guarded native loader: getKerberos and devtools-connect.
    '@mongodb-js/zstd', // Guarded optional compression loader: getZstdLibrary.
    '@aws-sdk/credential-providers', // Guarded auth loader: getAwsCredentialProvider; preserve webpack behavior.
    'gcp-metadata', // Guarded auth loader: getGcpMetadata; preserve webpack behavior.
    'snappy', // Guarded optional compression loader: getSnappy.
    'mongodb-client-encryption', // Guarded native loader: getMongoDBClientEncryption and devtools-connect.
    // ws (via @kubernetes/client-node) optional native accelerators
    'bufferutil', // Guarded buffer-util loader; JavaScript fallback remains available.
    'utf-8-validate', // Guarded validation loader; Node/JavaScript fallback remains available.
    // @mongosh transitive optional dependencies
    'electron', // Guarded OIDC browser opener; falls back to bundled open.
    'os-dns-native', // Guarded devtools-connect DNS loader.
    'ssh2', // Lazy SSH-proxy-only loader (not try/catch); preserve webpack's external behavior.
    'win-export-certificate-and-key', // Guarded system-ca Windows certificate loader.
    'macos-export-certificate-and-key', // Guarded system-ca macOS certificate loader.
    // Shared diagnostic dependencies
    'supports-color', // Guarded debug color probe; was already left as a runtime require.
]);
const nodeBuiltins = new Set(builtinModules);

/** @param {string} id */
function isExternal(id) {
    return (
        id === 'vscode' ||
        id.startsWith('node:') ||
        nodeBuiltins.has(id) ||
        optionalExternals.has(id) ||
        // Babel's optional .cts configuration loader (guarded preset; package.json in its error path).
        // The shell rewriter disables configuration files, so neither request executes.
        id.startsWith('@babel/preset-typescript')
    );
}

// Bundled CommonJS code expects the CommonJS module globals, which an ES module chunk does not have.
// - `require`: Rolldown rewrites every free `require` (calls, `require.resolve`, `typeof require`)
//   to its own `__require`, created with `createRequire(import.meta.url)` on `platform: 'node'`.
// - `__dirname`/`__filename`: the banner declares them under names no bundled module uses, and the
//   host environment's `define` points the free references at them. A banner declaring `__dirname`
//   itself would collide with ES modules that declare their own (for example `open`). The values
//   are those of the chunk, i.e. the extension root, which is what webpack's
//   `node: { __dirname: false }` gave the CommonJS bundle.
const dirnameBinding = '__documentdbDirname';
const filenameBinding = '__documentdbFilename';
const esmBanner = [
    `const ${filenameBinding} = import.meta.filename;`,
    `const ${dirnameBinding} = import.meta.dirname;`,
].join('\n');

const excludeFromMarketplace =
    /<!-- region exclude-from-marketplace -->.*?<!-- endregion exclude-from-marketplace -->/gis;
// No translations ship yet: like the webpack build, copy no `bundle.l10n.<language>.json` and no
// `package.nls.<language>.json` until languages are listed here.
const supportedLanguages = [];
const isSupportedTranslation = (prefix) => (fileName) =>
    supportedLanguages.some((language) => fileName === `${prefix}.${language}.json`);

export default defineConfig(({ mode }) => {
    const isDev = mode === 'development';
    const isProduction = mode === 'production';

    /** @type {import('vite').BuildEnvironmentOptions} */
    const sharedBuild = {
        outDir: 'dist',
        // The webview build writes to the same directory; `build-prod`/`build-dev` clean it first.
        emptyOutDir: false,
        target: 'node22',
        minify: !isDev,
        sourcemap: isDev,
        reportCompressedSize: false,
        // The playground worker bundles the shell runtime (about 7 MB); sizes are tracked by the
        // bundle report and L1 instead.
        chunkSizeWarningLimit: 16384,
    };

    /** @type {import('rolldown').OutputOptions} */
    const sharedOutput = {
        // The code compares `constructor.name` (webpack kept names with swc `keepClassNames` and
        // Terser `keep_classnames`/`keep_fnames`).
        keepNames: true,
        // Keep license comments inline (webpack's Terser moved them into `*.LICENSE.txt` files).
        comments: { legal: true },
    };

    /** @type {import('vite').EnvironmentOptions} */
    const sharedEnvironment = {
        consumer: 'server',
        // Bundle every dependency; only `isExternal` modules stay outside.
        resolve: { noExternal: true },
    };

    return {
        root,
        publicDir: false,
        clearScreen: false,
        define: {
            'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
            // `ext.isBundle` selects the bundled webview script.
            'process.env.IS_BUNDLE': JSON.stringify('true'),
            // WebviewController loads webviews from the dev server when this is set. Replaced at build
            // time so production code never contains the dev server switch.
            'process.env.DEVSERVER': JSON.stringify(isDev ? 'true' : ''),
        },
        resolve: {
            alias: [
                { find: /^bson$/, replacement: bsonEntry },
                // G5-I01: Rolldown 1.0.3 drops the namespace of azureauth's lowered import() in
                // VSCodeAzureSubscriptionProvider and AzureDevOpsSubscriptionProvider.
                // Pin CommonJS to restore webpack's behaviour for this package.
                // TODO(#990): Remove when @microsoft/vscode-azext-azureauth uses real import().
                {
                    find: /^@azure\/arm-resources-subscriptions$/,
                    replacement: require.resolve('@azure/arm-resources-subscriptions'),
                },
            ],
        },
        builder: {
            async buildApp(builder) {
                // Watch builds return independent watchers, not completed builds.
                const ready = new Set();
                for (const name of ['host', 'tsPlugin']) {
                    const environment = builder.environments[name];
                    const result = await builder.build(environment);
                    if (environment.config.build.watch && 'on' in result) {
                        result.on('event', (event) => {
                            if (event.code === 'BUNDLE_START' || event.code === 'ERROR') {
                                ready.delete(name);
                            } else if (event.code === 'BUNDLE_END') {
                                ready.add(name);
                                if (ready.size === 2) {
                                    environment.logger.info('[vite-ext] host and tsPlugin ready.');
                                }
                            }
                        });
                    }
                }
            },
        },
        environments: {
            host: {
                ...sharedEnvironment,
                define: {
                    __dirname: dirnameBinding,
                    __filename: filenameBinding,
                },
                build: {
                    ...sharedBuild,
                    rolldownOptions: {
                        input: {
                            main: path.resolve(root, 'main.ts'),
                            playgroundWorker: path.resolve(root, 'src/documentdb/playground/playgroundWorker.ts'),
                        },
                        // `main` must keep `activate`/`deactivate`.
                        preserveEntrySignatures: 'strict',
                        external: isExternal,
                        output: {
                            ...sharedOutput,
                            format: 'es',
                            entryFileNames: '[name].mjs',
                            chunkFileNames: '[name]-[hash].mjs',
                            banner: esmBanner,
                        },
                    },
                },
            },
            tsPlugin: {
                ...sharedEnvironment,
                build: {
                    ...sharedBuild,
                    rolldownOptions: {
                        input: {
                            playgroundTsPlugin: path.resolve(root, 'src/documentdb/playground/tsPlugin/index.ts'),
                        },
                        external: isExternal,
                        output: {
                            ...sharedOutput,
                            format: 'cjs',
                            // `module.exports = pluginModuleFactory`
                            exports: 'default',
                            entryFileNames: '[name].cjs',
                        },
                    },
                },
            },
        },
        plugins: [
            {
                ...copyAssets([
                    { from: 'l10n', to: 'l10n', filter: isSupportedTranslation('bundle.l10n') },
                    { from: 'resources', to: 'resources' },
                    { from: 'package.json', to: 'package.json' },
                    { from: 'package.nls.json', to: 'package.nls.json' },
                    ...fs
                        .readdirSync(root)
                        .filter(isSupportedTranslation('package.nls'))
                        .map((fileName) => ({ from: fileName, to: fileName })),
                    { from: 'playground-language-configuration.json', to: 'playground-language-configuration.json' },
                    { from: 'syntaxes', to: 'syntaxes' },
                    { from: 'CHANGELOG.md', to: 'CHANGELOG.md' },
                    { from: 'LICENSE.md', to: 'LICENSE.md' },
                    { from: 'NOTICE.html', to: 'NOTICE.html' },
                    {
                        from: 'README.md',
                        to: 'README.md',
                        transform: isDev
                            ? undefined
                            : (content) => content.toString().replace(excludeFromMarketplace, ''),
                    },
                    { from: 'SECURITY.md', to: 'SECURITY.md' },
                    { from: 'SUPPORT.md', to: 'SUPPORT.md' },
                    { from: '.vscodeignore', to: '.vscodeignore' },
                    { from: 'packages/documentdb-js-shell-api-types/typeDefs', to: 'typeDefs' },
                    ...['azureSubscription.svg', 'azureIcons/MongoClusters.svg', 'azureIcons/AzureCosmosDb.svg'].map(
                        (icon) => ({
                            from: `node_modules/@microsoft/vscode-azext-azureutils/resources/${icon}`,
                            to: `resources/from_node_modules/@microsoft/vscode-azext-azureutils/resources/${icon}`,
                        }),
                    ),
                ]),
                applyToEnvironment: (environment) => environment.name === 'host',
            },
            isProduction && {
                ...bundleReport({ outFile: reportFile }),
                applyToEnvironment: (environment) => environment.name === 'host',
            },
            isProduction && {
                ...bundleReport({ outFile: reportFile, append: true }),
                applyToEnvironment: (environment) => environment.name === 'tsPlugin',
            },
        ],
    };
});
