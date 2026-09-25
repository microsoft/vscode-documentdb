/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Tests against a real server, run by CI's db-integration job (`npm run test:integration`).
const base = require('./jest.config');
const extension = base.projects.find((project) => project.displayName === 'extension');

/** @type {import('jest').Config} **/
module.exports = {
    modulePathIgnorePatterns: base.modulePathIgnorePatterns,
    // Each test round-trips to a real server; Jest's 5s default leaves no room for a slow runner.
    // Global, because jest-circus ignores a project-level testTimeout.
    testTimeout: 30_000,
    projects: [
        {
            ...extension,
            displayName: 'integration',
            testMatch: ['<rootDir>/src/**/*.integration.test.ts'],
            testPathIgnorePatterns: ['/node_modules/'],
            // The shell runtime's @mongosh stack reaches ESM-only packages; compile those to CommonJS.
            // `swcrc: false` because .swcrc only accepts TypeScript files.
            transform: {
                ...extension.transform,
                '^.+\\.js$': [
                    '@swc/jest',
                    { swcrc: false, module: { type: 'commonjs' }, jsc: { parser: { syntax: 'ecmascript' } } },
                ],
            },
            transformIgnorePatterns: ['/node_modules/(?!(openid-client|oauth4webapi|jose)/)'],
        },
    ],
};
