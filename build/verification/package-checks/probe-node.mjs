/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ESM consumer probe: `import()`s every entry point and runs its representative calls. Prints JSON.
import { checks, entryOf, normalize } from './calls.mjs';

function firstLine(error) {
    return String(error instanceof Error ? error.message : error).split('\n')[0];
}

const results = [];
for (const name of Object.keys(checks)) {
    const { dom, run } = normalize(checks[name]);
    let loaded = false;
    try {
        await import(entryOf(name));
        loaded = true;
        const detail = dom ? 'loaded; calls need a DOM (Vitest probe)' : await run((specifier) => import(specifier));
        results.push({ name, ok: true, loaded, detail });
    } catch (error) {
        results.push({ name, ok: false, loaded, code: error?.code, error: firstLine(error) });
    }
}
console.log(JSON.stringify(results));
process.exit(0);
