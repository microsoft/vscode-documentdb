/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { defineConfig } from 'vitest/config';
// TEMPORARY (modernization Stage 2): while Jest and Vitest coexist, each project only includes the
// test files that already import from 'vitest'. When Jest is removed, replace every
// `vitestFiles(root, dir)` call with the matching `${dir}/**/*.test.{ts,tsx}` glob.
import { vitestFiles } from './build/test-migration/runnerRouting.cjs';

const repoRoot = __dirname;

// Some dependencies (the ESM build of @microsoft/vscode-azext-utils) reference source maps they do
// not ship, and Vite warns once per inlined file. Vitest replaces `customLogger`, so this plugin
// wraps the resolved logger instead. It drops only that warning, and only for node_modules files.
// Typed structurally: under the repo's node10 resolution TypeScript cannot load `vite`'s own types.
interface WarningLogger {
    warn(message: string, options?: object): void;
}
const quietMissingDependencySourceMaps = {
    name: 'documentdb:quiet-missing-dependency-source-maps',
    configResolved(config: { logger: WarningLogger }): void {
        const warn = config.logger.warn.bind(config.logger) as WarningLogger['warn'];
        config.logger.warn = (message: string, options?: object): void => {
            if (message.startsWith('Failed to load source map for') && message.includes('/node_modules/')) {
                return;
            }
            warn(message, options);
        };
    },
};

// Jest's 5 s default never applied to synchronous tests, and Vite's first transform of a large
// import (the fluentui component tree) costs seconds that Jest did not. 15 s, as in Cosmos DB.
// Inline projects do not inherit root `test` options, so every project sets it.
const testTimeout = 15_000;

const packageRoot = (name: string): string => path.join(repoRoot, 'packages', name);

export default defineConfig({
    test: {
        // Same worker cap as the Jest root config, so wall times stay comparable.
        maxWorkers: '25%',
        projects: [
            {
                plugins: [quietMissingDependencySourceMaps],
                // Replaces the Jest `extension` and `extension-webview` projects. Node is the default;
                // React component tests opt into a DOM with a `// @vitest-environment jsdom` docblock.
                resolve: {
                    alias: [
                        { find: /^vscode$/, replacement: path.join(repoRoot, 'test/vitest/vscode.ts') },
                        // `bson` ships separate ESM and CommonJS builds. CommonJS dependencies (the
                        // driver, shell-bson-parser, our packages' dist) `require` the CommonJS one, so
                        // ESM importers are pointed at it too: one copy, and `instanceof` holds, as
                        // under Jest. Node shares the module between `import` and `require`.
                        { find: /^bson$/, replacement: require.resolve('bson') },
                    ],
                },
                test: {
                    name: 'extension',
                    root: repoRoot,
                    testTimeout,
                    environment: 'node',
                    include: vitestFiles(repoRoot, 'src'),
                    // Lets CommonJS dependencies `require('vscode')` and get the aliased mock above.
                    setupFiles: [path.join(repoRoot, 'test/vitest/setup.ts')],
                    server: {
                        deps: {
                            // TEMPORARY (Stage 3 revisits): `@microsoft/vscode-ext-webview-fluentui` is ESM
                            // but imports named exports from Fluent, which is CommonJS under Node. Left
                            // external, the import throws "Named export ... not found"; inlining lets Vite
                            // apply its CommonJS interop. Keep until a consumer test passes without it.
                            //
                            // `@azure/identity` and `@azure/msal-node` are inlined so `vi.resetModules()`
                            // reloads them, as `jest.resetModules()` did: the managed-identity endpoint
                            // harness re-imports them per test to pick up new IDENTITY_* variables, and
                            // modules Node loads directly survive a reset.
                            inline: ['@microsoft/vscode-ext-webview-fluentui', '@azure/identity', '@azure/msal-node'],
                        },
                    },
                    deps: {
                        optimizer: {
                            ssr: {
                                // TEMPORARY (Stage 3 makes this unnecessary): `@microsoft/vscode-ext-webview`
                                // ships CommonJS and its host entry `require`s `vscode`, which bypasses the
                                // alias above. Pre-bundling rewrites those `require` calls so they resolve
                                // to the test mock.
                                enabled: true,
                                include: [
                                    '@microsoft/vscode-ext-webview',
                                    '@microsoft/vscode-ext-webview/host',
                                    '@microsoft/vscode-ext-webview/react',
                                    '@microsoft/vscode-ext-webview/webview',
                                ],
                            },
                        },
                    },
                },
            },
            {
                test: {
                    name: 'documentdb-js-schema-analyzer',
                    root: packageRoot('documentdb-js-schema-analyzer'),
                    testTimeout,
                    environment: 'node',
                    include: vitestFiles(packageRoot('documentdb-js-schema-analyzer'), 'test'),
                },
            },
            {
                test: {
                    name: 'documentdb-js-operator-registry',
                    root: packageRoot('documentdb-js-operator-registry'),
                    testTimeout,
                    environment: 'node',
                    include: vitestFiles(packageRoot('documentdb-js-operator-registry'), 'src'),
                },
            },
            {
                // Not part of the Jest root projects (it only ran through the package's own `npm test`).
                test: {
                    name: 'documentdb-js-shell-api-types',
                    root: packageRoot('documentdb-js-shell-api-types'),
                    testTimeout,
                    environment: 'node',
                    include: vitestFiles(packageRoot('documentdb-js-shell-api-types'), 'src'),
                },
            },
            {
                test: {
                    name: 'documentdb-js-shell-runtime',
                    root: packageRoot('documentdb-js-shell-runtime'),
                    testTimeout,
                    environment: 'node',
                    include: vitestFiles(packageRoot('documentdb-js-shell-runtime'), 'src'),
                },
            },
            {
                // The host facade imports `vscode` at runtime; the package keeps its own minimal stub.
                resolve: {
                    alias: [
                        {
                            find: /^vscode$/,
                            replacement: path.join(packageRoot('vscode-ext-webview'), 'src/testing/vscodeStub.ts'),
                        },
                    ],
                },
                test: {
                    name: 'vscode-ext-webview',
                    root: packageRoot('vscode-ext-webview'),
                    testTimeout,
                    environment: 'node',
                    include: vitestFiles(packageRoot('vscode-ext-webview'), 'src'),
                },
            },
            {
                // Every test in this package needs a DOM (theming reads `document.body`), so the whole
                // project runs under jsdom, as its Jest project did.
                test: {
                    name: 'vscode-ext-webview-fluentui',
                    root: packageRoot('vscode-ext-webview-fluentui'),
                    testTimeout,
                    environment: 'jsdom',
                    include: vitestFiles(packageRoot('vscode-ext-webview-fluentui'), 'src'),
                },
            },
        ],
    },
});
