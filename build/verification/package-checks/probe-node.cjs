/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// CommonJS consumer probe: `require()`s every entry point (exercising Node's `require(esm)`, which
// rejects any top-level await in the graph) and runs its representative calls. Prints JSON.
'use strict';

function firstLine(error) {
    return String(error instanceof Error ? error.message : error).split('\n')[0];
}

(async () => {
    const { checks, entryOf, normalize } = await import('./calls.mjs');
    const results = [];
    for (const name of Object.keys(checks)) {
        const { dom, run } = normalize(checks[name]);
        let loaded = false;
        try {
            require(entryOf(name));
            loaded = true;
            const detail = dom
                ? 'loaded; calls need a DOM (Vitest probe)'
                : await run(async (specifier) => require(specifier));
            results.push({ name, ok: true, loaded, detail });
        } catch (error) {
            results.push({ name, ok: false, loaded, code: error?.code, error: firstLine(error) });
        }
    }
    console.log(JSON.stringify(results));
    // Clients and timers from the calls must not keep the probe alive.
    process.exit(0);
})();
