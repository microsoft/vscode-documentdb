/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { satisfies } from 'semver';
import { describe, expect, test } from 'vitest';

const manifest = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as {
    peerDependencies: Record<string, string>;
};
const fluentRange = manifest.peerDependencies['@fluentui/react-components'];

describe('Fluent components peer compatibility', () => {
    test('supports the existing and upgraded Fluent releases', () => {
        expect(satisfies('9.74.4', fluentRange)).toBe(true);
        expect(satisfies('9.75.1', fluentRange)).toBe(true);
    });

    test('does not admit unverified Fluent releases', () => {
        expect(satisfies('9.73.0', fluentRange)).toBe(false);
        expect(satisfies('9.75.0', fluentRange)).toBe(false);
        expect(satisfies('9.76.0', fluentRange)).toBe(false);
    });
});
