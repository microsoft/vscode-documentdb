/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Verifies the generated index reference data (scraped from the compatibility
 * page's "Index types" and "Index properties" tables).
 */

import { INDEX_PROPERTIES, INDEX_TYPES } from './index';

describe('index reference', () => {
    test('exposes the documented index types', () => {
        const names = INDEX_TYPES.map((t) => t.name);
        expect(names).toEqual(
            expect.arrayContaining([
                'Single Field',
                'Compound',
                'Multikey',
                'Text',
                'Wildcard',
                'Geospatial',
                'Hashed',
                'Vector',
            ]),
        );
    });

    test('exposes the documented index properties', () => {
        const names = INDEX_PROPERTIES.map((p) => p.name);
        expect(names).toEqual(
            expect.arrayContaining(['TTL', 'Unique', 'Partial', 'Case Insensitive', 'Sparse', 'Background']),
        );
    });

    test('every entry has a non-empty name and description', () => {
        for (const entry of [...INDEX_TYPES, ...INDEX_PROPERTIES]) {
            expect(entry.name.length).toBeGreaterThan(0);
            expect(entry.description.length).toBeGreaterThan(0);
        }
    });

    test('all listed types and properties are marked supported', () => {
        for (const entry of [...INDEX_TYPES, ...INDEX_PROPERTIES]) {
            expect(entry.supported).toBe(true);
        }
    });
});
