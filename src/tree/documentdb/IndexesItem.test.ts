/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { compareIndexNames } from './IndexesItem';

describe('compareIndexNames', () => {
    it('places _id_ before any other index', () => {
        const names = ['age_1', '_id_', 'name_1'];
        const sorted = [...names].sort(compareIndexNames);
        expect(sorted[0]).toBe('_id_');
    });

    it('keeps _id_ first when it is already first', () => {
        const names = ['_id_', 'age_1', 'name_1'];
        const sorted = [...names].sort(compareIndexNames);
        expect(sorted[0]).toBe('_id_');
    });

    it('places _id_ first when it is last in the list', () => {
        const names = ['age_1', 'name_1', '_id_'];
        const sorted = [...names].sort(compareIndexNames);
        expect(sorted[0]).toBe('_id_');
    });

    it('sorts remaining indexes alphabetically after _id_', () => {
        const names = ['status_1', '_id_', 'age_1', 'name_1'];
        const sorted = [...names].sort(compareIndexNames);
        expect(sorted).toEqual(['_id_', 'age_1', 'name_1', 'status_1']);
    });

    it('places _id_ first even when other indexes start with uppercase letters', () => {
        // Without the fix, 'A' (ASCII 65) sorts before '_' (ASCII 95) in naive
        // locale-aware comparisons, so uppercase-named indexes could appear before _id_.
        const names = ['Zebra_1', '_id_', 'Alpha_1'];
        const sorted = [...names].sort(compareIndexNames);
        expect(sorted[0]).toBe('_id_');
        expect(sorted[1]).toBe('Alpha_1');
        expect(sorted[2]).toBe('Zebra_1');
    });

    it('applies numeric sort to the non-_id_ indexes', () => {
        const names = ['field_10', '_id_', 'field_2', 'field_1'];
        const sorted = [...names].sort(compareIndexNames);
        expect(sorted).toEqual(['_id_', 'field_1', 'field_2', 'field_10']);
    });

    it('handles a single-element list containing only _id_', () => {
        expect(['_id_'].sort(compareIndexNames)).toEqual(['_id_']);
    });

    it('sorts a list without _id_ alphabetically', () => {
        const names = ['z_index', 'a_index', 'm_index'];
        const sorted = [...names].sort(compareIndexNames);
        expect(sorted).toEqual(['a_index', 'm_index', 'z_index']);
    });
});
