/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
    // Limit workers to avoid OOM kills on machines with many cores.
    // Each ts-jest worker loads the TypeScript compiler and consumes ~500MB+.
    maxWorkers: '50%',
    testEnvironment: 'node',
    testMatch: ['<rootDir>/test/**/*.test.ts'],
    // TEMPORARY (modernization Stage 2): test files that import from 'vitest' run under Vitest only.
    testPathIgnorePatterns: require('../../build/test-migration/runnerRouting.cjs').jestIgnorePatterns(__dirname),
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {}],
    },
};
