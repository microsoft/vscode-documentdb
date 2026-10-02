/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
    maxWorkers: '50%',
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/**/*.test.ts'],
    // TEMPORARY (modernization Stage 2): test files that import from 'vitest' run under Vitest only.
    testPathIgnorePatterns: require('../../build/test-migration/runnerRouting.cjs').jestIgnorePatterns(__dirname),
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {}],
    },
};
