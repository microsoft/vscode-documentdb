/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/**/*.test.ts'],
    setupFilesAfterEnv: ['<rootDir>/src/plugins/service-mongo-atlas/__tests__/jest.setup.atlas.ts'],
    transform: {
        '^.+.tsx?$': ['ts-jest', {}],
    },
};
