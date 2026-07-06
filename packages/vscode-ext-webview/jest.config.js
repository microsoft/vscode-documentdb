/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
    displayName: 'vscode-webview-api',
    // Limit workers to avoid OOM kills on machines with many cores.
    // Each ts-jest worker loads the TypeScript compiler and consumes ~500MB+.
    maxWorkers: '50%',
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/**/*.test.ts'],
    // The host facade (WebviewController / openWebview) imports `vscode` at
    // runtime; map it to a minimal stub. Type-checking still uses @types/vscode.
    // The stub deliberately lives outside any `__mocks__/` directory so it is
    // not picked up as a global jest manual mock (which would collide with the
    // extension's own vscode mock in the root multi-project run).
    moduleNameMapper: {
        '^vscode$': '<rootDir>/src/testing/vscodeStub.ts',
    },
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {}],
    },
};
