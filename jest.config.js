/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/test/AtlasService/**/*.test.ts'],
    transform: {
        '^.+.tsx?$': ['ts-jest', {}],
    },
};
