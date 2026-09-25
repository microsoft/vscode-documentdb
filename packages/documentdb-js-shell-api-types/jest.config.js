/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
    displayName: 'shell-api-types',
    maxWorkers: '50%',
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/**/*.test.ts'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {}],
    },
};
