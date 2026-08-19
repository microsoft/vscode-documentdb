/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Compiles `src/styles/fluentOverrides.scss` into `src/styles/generated.ts`.
 *
 * The stylesheet ships as a TypeScript string rather than a `.css` file so the package can
 * inject it itself and a consumer has no import to forget (decision 0010). Keeping the source
 * as real SCSS preserves formatting, highlighting and lint, and lets `fluentOverrides.test.ts`
 * keep reading it off disk. The output is committed (decision 0015).
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(packageRoot, 'src/styles/fluentOverrides.scss');
const target = join(packageRoot, 'src/styles/generated.ts');

const { css } = sass.compile(source, { style: 'compressed' });

const contents = `/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// GENERATED FILE. Do not edit.
// Produced from src/styles/fluentOverrides.scss by scripts/build-styles.mjs.

export const fluentOverridesCss = ${JSON.stringify(css)};
`;

writeFileSync(target, contents, 'utf8');
