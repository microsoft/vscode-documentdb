/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Vitest config for the package probe's throwaway consumer project (copied there by
// check-packages.mjs). PROBE_INLINE lists the packages Vitest transforms instead of handing to Node.
import * as path from 'node:path';

const inline = (process.env.PROBE_INLINE ?? '').split(',').filter(Boolean);

export default {
    resolve: {
        alias: [{ find: /^vscode$/, replacement: path.join(import.meta.dirname, 'vscode-stub.cjs') }],
    },
    test: {
        include: ['probe.*.test.mjs'],
        testTimeout: 30_000,
        server: { deps: { inline } },
    },
};
