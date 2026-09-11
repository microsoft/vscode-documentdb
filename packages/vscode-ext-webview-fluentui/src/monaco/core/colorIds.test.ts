/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { MONACO_COLOR_IDS } from './colorIds';

/**
 * The committed list is a claim about a specific `monaco-editor` version. This is the tripwire for
 * an upgrade that added or removed a colour: re-run `npm run build:monaco-color-ids` and review the
 * diff. Skipped where `monaco-editor` is not installed, since it is only a devDependency.
 */
function extractInstalledColorIds(): readonly string[] | undefined {
    let monacoRoot: string;

    try {
        monacoRoot = dirname(createRequire(__filename).resolve('monaco-editor/package.json'));
    } catch {
        return undefined;
    }

    const ids = new Set<string>();

    const collect = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);

            if (entry.isDirectory()) {
                collect(path);
            } else if (entry.name.endsWith('.js')) {
                for (const match of readFileSync(path, 'utf8').matchAll(/registerColor\(\s*'([^']+)'/g)) {
                    ids.add(match[1]);
                }
            }
        }
    };

    collect(join(monacoRoot, 'esm/vs'));

    return [...ids].sort();
}

describe('MONACO_COLOR_IDS', () => {
    it('is sorted and free of duplicates', () => {
        expect([...MONACO_COLOR_IDS]).toEqual([...new Set(MONACO_COLOR_IDS)].sort());
    });

    it('matches the colours the installed monaco-editor registers', () => {
        const installed = extractInstalledColorIds();

        if (installed === undefined) {
            return;
        }

        expect(installed.length).toBeGreaterThan(0);
        expect([...MONACO_COLOR_IDS]).toEqual(installed);
    });
});
