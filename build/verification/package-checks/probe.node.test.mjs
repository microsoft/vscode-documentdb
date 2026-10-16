/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment node
// Vitest consumer probe for the entry points that need no DOM.
import { expect, it } from 'vitest';
import { checks, normalize } from './calls.mjs';

for (const [name, check] of Object.entries(checks)) {
    const { dom, run } = normalize(check);
    if (dom) continue;
    it(name, async () => {
        const detail = await run((specifier) => import(/* @vite-ignore */ specifier));
        expect(typeof detail).toBe('string');
        console.log(`PROBE ${name}: ${detail}`);
    });
}
