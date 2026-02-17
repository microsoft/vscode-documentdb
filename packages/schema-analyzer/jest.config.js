/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
    testEnvironment: 'node',
    testMatch: ['<rootDir>/test/**/*.test.ts'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {}],
    },
};
