/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const shared = {
    rootDir: `${__dirname}/../../..`,
    modulePathIgnorePatterns: ['<rootDir>/.vscode-test', '<rootDir>/out', '<rootDir>/dist'],
    transform: {
        '^.+\\.tsx?$': ['@swc/jest', {
            module: { type: 'commonjs' },
            jsc: { target: 'es2022', parser: { syntax: 'typescript', tsx: true } },
        }],
    },
};

module.exports = {
    rootDir: shared.rootDir,
    projects: [
        {
            ...shared,
            displayName: 'browser-host',
            testEnvironment: 'node',
            testMatch: ['<rootDir>/build/verification/browser/{harness,playwright}.test.ts'],
        },
        {
            ...shared,
            displayName: 'browser-runtime',
            testEnvironment: 'jsdom',
            testMatch: ['<rootDir>/build/verification/browser/runtime.test.ts'],
        },
    ],
};
