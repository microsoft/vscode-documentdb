/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ESM-readiness report - `npm run esm:check`.
 *
 * Answers one question for the modernization review (PR #880): **how much source
 * has to change before this repo can be built by a bundler?**
 *
 * It changes nothing. It runs two read-only probes and prints what they find:
 *
 *   1. `tsc --noEmit` with `isolatedModules`, which rejects the constructs that
 *      only `tsc`'s whole-program emit supports (chiefly `const enum`).
 *   2. ESLint with the ESM guards, which finds `const enum` declarations and
 *      `__dirname` / `__filename` in source that the migration would convert.
 *
 * Both probes live in their own config files so that neither `npm run build` nor
 * `npm run lint` changes behaviour for anyone. If the review decides to enforce
 * them, the configs fold into `tsconfig.json` / `eslint.config.mjs` and this
 * script goes away.
 *
 * Exit code is 0 when both probes are clean, 1 otherwise, so it can be wired into
 * CI later without modification.
 */

import { spawnSync } from 'node:child_process';

/** ANSI helpers, skipped when the output is redirected. */
const useColor = process.stdout.isTTY === true;
const bold = (text) => (useColor ? `\u001b[1m${text}\u001b[0m` : text);
const green = (text) => (useColor ? `\u001b[32m${text}\u001b[0m` : text);
const red = (text) => (useColor ? `\u001b[31m${text}\u001b[0m` : text);
const dim = (text) => (useColor ? `\u001b[2m${text}\u001b[0m` : text);

/**
 * Runs one probe and returns its outcome.
 *
 * @param {string} label   Human-readable probe name.
 * @param {string[]} args  Arguments passed to `npx`.
 * @returns {{ label: string, ok: boolean, output: string }}
 */
function probe(label, args) {
    const result = spawnSync('npx', args, {
        encoding: 'utf8',
        shell: process.platform === 'win32',
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    return { label, ok: result.status === 0, output };
}

console.log(bold('\nESM readiness report'));
console.log(dim('Read-only. No build, lint or source file is modified by this command.\n'));

const probes = [
    probe('isolatedModules type-check', ['tsc', '--noEmit', '-p', 'tsconfig.esm-readiness.json']),
    probe('ESM source guards (const enum, __dirname)', [
        'eslint',
        '--no-config-lookup',
        '--config',
        'eslint.esm-readiness.config.mjs',
        '.',
    ]),
];

for (const result of probes) {
    console.log(`${result.ok ? green('  PASS') : red('  FAIL')}  ${result.label}`);
    if (!result.ok && result.output.length > 0) {
        console.log(`\n${result.output}\n`);
    }
}

const allClean = probes.every((result) => result.ok);

console.log('');
if (allClean) {
    console.log(green(bold('  Source is ESM-ready.')));
    console.log(
        dim(
            '  The only remaining `__dirname` sites are the three documented exemptions in\n' +
                '  eslint.esm-readiness.config.mjs, each of which is loaded by a CommonJS host.\n',
        ),
    );
} else {
    console.log(red(bold('  Not ESM-ready yet - see the findings above.\n')));
}

process.exit(allClean ? 0 : 1);
