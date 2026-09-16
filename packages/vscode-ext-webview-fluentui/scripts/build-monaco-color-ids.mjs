/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Extracts the VS Code colour ids Monaco can actually read, into `src/monaco/core/colorIds.ts`.
 *
 * Monaco declares every colour it understands through `registerColor('<id>', …)`. Ids outside that
 * set are inert: the standalone theme service stores them and nothing ever looks them up. Reading
 * them off the document is pure cost, and each one is another chance to hand Monaco a value it
 * renders red.
 *
 * Run manually after upgrading `monaco-editor`, not on every build. The output is a claim about a
 * specific Monaco version and deserves a review rather than a silent rewrite; `colorIds.test.ts`
 * fails if the committed list has drifted from the installed one.
 *
 *     node scripts/build-monaco-color-ids.mjs
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(packageRoot, 'src/monaco/core/colorIds.ts');

const require = createRequire(import.meta.url);
const monacoRoot = dirname(require.resolve('monaco-editor/package.json'));
const monacoVersion = JSON.parse(readFileSync(join(monacoRoot, 'package.json'), 'utf8')).version;

/** `registerColor(` with a string-literal first argument; the only other callers are its own overloads. */
const REGISTER_COLOR = /registerColor\(\s*'([^']+)'/g;

function collect(directory, ids) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);

        if (entry.isDirectory()) {
            collect(path, ids);
        } else if (entry.name.endsWith('.js')) {
            for (const match of readFileSync(path, 'utf8').matchAll(REGISTER_COLOR)) {
                ids.add(match[1]);
            }
        }
    }

    return ids;
}

const colorIds = [...collect(join(monacoRoot, 'esm/vs'), new Set())].sort();

if (colorIds.length === 0) {
    throw new Error('No registerColor() calls found. Has monaco-editor changed how it declares colours?');
}

const contents = `/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// GENERATED FILE. Do not edit.
// Produced from monaco-editor ${monacoVersion} by scripts/build-monaco-color-ids.mjs.

/**
 * The ${colorIds.length} VS Code colour ids Monaco registers, and therefore the only ones it can read.
 *
 * Every other workbench colour - \`activityBar.*\`, \`titleBar.*\`, \`welcomePage.*\` and the rest -
 * has no reader inside Monaco, so supplying it costs a lookup and buys nothing.
 */
export const MONACO_COLOR_IDS: readonly string[] = [
${colorIds.map((id) => `    '${id}',`).join('\n')}
];
`;

writeFileSync(target, contents, 'utf8');

console.log(`Wrote ${colorIds.length} colour ids from monaco-editor ${monacoVersion} to ${target}.`);
