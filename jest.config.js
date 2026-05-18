/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
    // Limit workers to avoid OOM kills on machines with many cores.
    // Each ts-jest worker loads the TypeScript compiler and consumes ~500MB+.
    maxWorkers: '50%',
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
        '<rootDir>/packages/documentdb-js-schema-analyzer',
        '<rootDir>/packages/documentdb-js-operator-registry',
        '<rootDir>/packages/documentdb-js-shell-runtime',
    ],
};
