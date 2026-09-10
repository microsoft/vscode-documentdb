/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
    // Limit workers to avoid OOM kills on machines with many cores.
    // Each ts-jest worker loads the TypeScript compiler and consumes ~500MB+.
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
            transform: {
                '^.+\\.tsx?$': ['ts-jest', {}],
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
        '<rootDir>/packages/documentdb-js-shell-runtime',
        '<rootDir>/packages/vscode-ext-webview',
        '<rootDir>/packages/vscode-ext-webview-fluentui',
    ],
};
