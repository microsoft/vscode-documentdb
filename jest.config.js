/** @type {import('jest').Config} **/
module.exports = {
    // Limit workers to avoid OOM kills on machines with many cores.
    maxWorkers: '25%',
    // Exclude VS Code test binaries downloaded by @vscode/test-electron.
    // They contain package.json files whose "name" fields collide with real
    // workspace packages, triggering jest-haste-map "naming collision" warnings.
    modulePathIgnorePatterns: ['<rootDir>/.vscode-test'],
    projects: [
        {
            displayName: 'extension',
            testEnvironment: 'node',
            testMatch: ['<rootDir>/src/**/*.test.ts'],
            // Real-server tests run in CI's db-integration job via jest.integration.config.js.
            testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.test\\.ts$'],
            // @swc/jest transpiles without type-checking, avoiding ts-jest's
            // per-worker TypeScript compiler (~500MB+) which was causing OOM in CI.
            // Options are inlined (not read from .swcrc) because @swc/jest's strict
            // JSON parser rejects the trailing commas in .swcrc that swc-loader tolerates.
            transform: {
                '^.+\\.tsx?$': [
                    '@swc/jest',
                    {
                        sourceMaps: 'inline',
                        module: { type: 'commonjs' },
                        jsc: {
                            target: 'es2021',
                            baseUrl: __dirname,
                            parser: {
                                syntax: 'typescript',
                                tsx: true,
                                functionBind: false,
                                decorators: true,
                                dynamicImport: true,
                            },
                            transform: {
                                react: {
                                    runtime: 'automatic',
                                },
                            },
                        },
                    },
                ],
            },
        },
        // React components in the webviews need a DOM. Kept as its own project rather than
        // switching the extension project to jsdom, which would change the environment under
        // every existing host-side test.
        {
            displayName: 'extension-webview',
            testEnvironment: 'jsdom',
            testMatch: ['<rootDir>/src/webviews/**/*.test.tsx'],
            transform: {
                '^.+\\.tsx?$': ['ts-jest', {}],
            },
        },
        '<rootDir>/packages/documentdb-js-schema-analyzer',
        '<rootDir>/packages/documentdb-js-operator-registry',
        '<rootDir>/packages/documentdb-js-shell-api-types',
        '<rootDir>/packages/documentdb-js-shell-runtime',
        '<rootDir>/packages/vscode-ext-webview',
        '<rootDir>/packages/vscode-ext-webview-fluentui',
    ],
};
