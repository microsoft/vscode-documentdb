/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
    // Limit workers to avoid OOM kills on machines with many cores.
    // Each ts-jest worker loads the TypeScript compiler and consumes ~500MB+.
    maxWorkers: '50%',
    projects: [
        {
            displayName: 'extension',
            testEnvironment: 'node',
            testMatch: ['<rootDir>/src/**/*.test.ts'],
            transform: {
                '^.+\\.tsx?$': ['ts-jest', {}],
            },
        },
        '<rootDir>/packages/schema-analyzer',
        '<rootDir>/packages/documentdb-constants',
    ],
};
