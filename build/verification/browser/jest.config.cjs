/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

module.exports = {
    rootDir: '../../..',
    testEnvironment: 'node',
    modulePathIgnorePatterns: ['<rootDir>/.vscode-test', '<rootDir>/out', '<rootDir>/dist'],
    testMatch: ['<rootDir>/build/verification/browser/**/*.test.ts'],
    transform: {
        '^.+\\.tsx?$': ['@swc/jest', {
            module: { type: 'commonjs' },
            jsc: { target: 'es2022', parser: { syntax: 'typescript', tsx: true } },
        }],
    },
};
