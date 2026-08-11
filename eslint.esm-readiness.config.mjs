/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ESM-readiness guards. **Not** part of `npm run lint` - `npm run esm:check` runs it.
 *
 * These two rules catch the source-level constructs that a bundler-based build
 * cannot carry over, taken from the bundler-migration post-mortem summarized in
 * the modernization research (PR #880):
 *
 *   1. `const enum`   - a file-at-a-time transpiler cannot inline the values.
 *   2. `__dirname` / `__filename` - do not exist in ES modules.
 *
 * They are kept out of `eslint.config.mjs` on purpose. Turning them on repo-wide
 * would apply to every contributor and every open PR, and that is a decision for
 * the modernization review rather than a side effect of this branch. Running them
 * separately still answers the question the review needs answered - *how much
 * would it cost?* - without imposing the answer.
 *
 * If the review adopts them, merge these blocks into `eslint.config.mjs` and
 * delete this file.
 */

import importPlugin from 'eslint-plugin-import';
import jest from 'eslint-plugin-jest';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import mocha from 'eslint-plugin-mocha';
import reactHooks from 'eslint-plugin-react-hooks';
import ts from 'typescript-eslint';

const ESM_GLOBAL_MESSAGE =
    'Not available in ES modules. Use `import.meta.url` with `fileURLToPath`, or add a documented exemption.';

export default ts.config(
    {
        ignores: [
            '.azure-pipelines',
            '.config',
            '.github',
            '.vscode-test',
            'coverage',
            '**/dist',
            '**/out',
            '**/node_modules',
            '**/__mocks__/**/*',
            '**/*.d.ts',
        ],
    },
    // Plugins are registered so that existing `eslint-disable` comments naming their
    // rules still resolve. **No rule from them is enabled** - this config turns on
    // exactly two rules, below.
    {
        plugins: {
            '@typescript-eslint': ts.plugin,
            import: importPlugin,
            jest,
            'jsx-a11y': jsxA11y,
            mocha,
            'react-hooks': reactHooks,
        },
        linterOptions: { reportUnusedDisableDirectives: 'off' },
    },
    // Deliberately does NOT extend any recommended set. This config exists to count
    // two specific things; inheriting a general rule set would bury them in unrelated
    // findings and misrepresent the size of the migration.
    //
    // Rule 1: `const enum` is unsupported by file-at-a-time transpilers, everywhere.
    // Needs the TypeScript parser to see `TSEnumDeclaration`.
    {
        files: ['**/*.{ts,tsx}'],
        languageOptions: { parser: ts.parser, ecmaVersion: 2023, sourceType: 'module' },
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector: 'TSEnumDeclaration[const=true]',
                    message:
                        'Avoid `const enum`: bundlers transpile file-by-file and cannot inline its values. Use a regular `enum` or an `as const` object.',
                },
            ],
        },
    },
    // Rule 2: `__dirname` / `__filename`, scoped to source that the migration converts.
    // Build configs (`webpack.*.js`, `scripts/`) and test files stay CommonJS, so they
    // are deliberately out of scope - counting them would overstate the work.
    {
        files: ['src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'],
        ignores: ['**/*.test.ts', '**/*.test.tsx'],
        languageOptions: { parser: ts.parser, ecmaVersion: 2023, sourceType: 'module' },
        rules: {
            'no-restricted-globals': [
                'error',
                { name: '__dirname', message: ESM_GLOBAL_MESSAGE },
                { name: '__filename', message: ESM_GLOBAL_MESSAGE },
            ],
        },
    },
    // The three known exemptions. All resolve a file shipped beside the build output,
    // and each is loaded by a CommonJS host today:
    //
    //   * WorkerSessionManager.ts   - spawns `playgroundWorker.js` via `new Worker(path)`.
    //   * tsPlugin/index.ts         - a TypeScript language-service plugin; the TS server
    //                                 loads it with `require()`, so it stays CommonJS even
    //                                 after the extension host moves to ESM.
    //   * shell-api-types/index.ts  - reads the shipped `documentdb-shell-api.d.ts`.
    //
    // Listing them turns "grep the repo" into an exact worklist. A clean run means the
    // ESM surface is these three files and nothing else.
    {
        files: [
            'src/documentdb/playground/WorkerSessionManager.ts',
            'src/documentdb/playground/tsPlugin/index.ts',
            'packages/documentdb-js-shell-api-types/src/index.ts',
        ],
        rules: {
            'no-restricted-globals': 'off',
        },
    },
);
