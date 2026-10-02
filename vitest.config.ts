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
const packageRoot = (name: string): string => path.join(repoRoot, 'packages', name);

export default defineConfig({
    test: {
        // Same worker cap as the Jest root config, so wall times stay comparable.
        maxWorkers: '25%',
        projects: [
            {
                // Replaces the Jest `extension` and `extension-webview` projects. Node is the default;
                // React component tests opt into a DOM with a `// @vitest-environment jsdom` docblock.
                resolve: {
                    alias: [{ find: /^vscode$/, replacement: path.join(repoRoot, 'test/vitest/vscode.ts') }],
                },
                test: {
                    name: 'extension',
                    root: repoRoot,
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
                            inline: ['@microsoft/vscode-ext-webview-fluentui'],
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
                    environment: 'node',
                    include: vitestFiles(packageRoot('documentdb-js-schema-analyzer'), 'test'),
                },
            },
            {
                test: {
                    name: 'documentdb-js-operator-registry',
                    root: packageRoot('documentdb-js-operator-registry'),
                    environment: 'node',
                    include: vitestFiles(packageRoot('documentdb-js-operator-registry'), 'src'),
                },
            },
            {
                // Not part of the Jest root projects (it only ran through the package's own `npm test`).
                test: {
                    name: 'documentdb-js-shell-api-types',
                    root: packageRoot('documentdb-js-shell-api-types'),
                    environment: 'node',
                    include: vitestFiles(packageRoot('documentdb-js-shell-api-types'), 'src'),
                },
            },
            {
                test: {
                    name: 'documentdb-js-shell-runtime',
                    root: packageRoot('documentdb-js-shell-runtime'),
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
                    environment: 'jsdom',
                    include: vitestFiles(packageRoot('vscode-ext-webview-fluentui'), 'src'),
                },
            },
        ],
    },
});
