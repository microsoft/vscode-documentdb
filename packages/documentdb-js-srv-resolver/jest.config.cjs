// Must stay `.cjs`: the package is `"type": "module"`, so `module.exports` in a `.js` file
// would be a syntax error.

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    displayName: 'srv-resolver',
    // Limit workers to avoid OOM kills on machines with many cores.
    // Each ts-jest worker loads the TypeScript compiler and consumes ~500MB+.
    maxWorkers: '50%',
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/**/*.test.ts'],
    // Relative imports carry `.js` (ESM); Jest resolves them against the TypeScript sources.
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    // Jest runs CommonJS. ts-jest rather than SWC: TypeScript's namespace imports stay live, so
    // `jest.spyOn(dns, ...)` in a test reaches the `import * as dns` in the source.
    transform: {
        '^.+\\.tsx?$': [
            'ts-jest',
            { tsconfig: { module: 'commonjs', moduleResolution: 'node10', types: ['node', 'jest'] } },
        ],
    },
};
