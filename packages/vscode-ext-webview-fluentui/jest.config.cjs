/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Must stay `.cjs`: the package is `"type": "module"`, which would make `module.exports`
// a syntax error in a `.js` file. See decision 0006.

/** @type {import('jest').Config} */
module.exports = {
    displayName: 'vscode-ext-webview-fluentui',
    // Limit workers to avoid OOM kills on machines with many cores.
    maxWorkers: '50%',
    // The theming layer reads the active theme off `document.body`, and the stylesheet
    // injection test needs a real `document.head`.
    testEnvironment: 'jsdom',
    testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
    // SWC, not ts-jest: it is already a devDependency, it is the same engine as the
    // views webpack `swc-loader`, and it does not type-check — type safety comes from
    // `tsc -p .` in `npm run build` (decision 0006).
    transform: {
        '^.+\\.tsx?$': [
            '@swc/jest',
            {
                jsc: {
                    parser: { syntax: 'typescript', tsx: true },
                    transform: { react: { runtime: 'automatic' } },
                    target: 'es2022',
                },
                module: { type: 'commonjs' },
            },
        ],
    },
};
