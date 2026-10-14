/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from 'vitest/config';

// The L2 browser-harness tests, run by `npm run test:verification`; not part of the unit-test run.
// Node by default; `runtime.test.ts` opts into jsdom with a `// @vitest-environment jsdom` docblock.
export default defineConfig({
    test: {
        root: __dirname,
        include: ['*.test.ts'],
        environment: 'node',
        // One file at a time, as Jest's `--runInBand` did.
        fileParallelism: false,
    },
});
