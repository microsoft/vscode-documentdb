/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type SortDirection } from '../types';
import { compareSortValues, filterAndSortRows } from './sort';

interface TestRow {
    name: string;
    size?: number;
}

describe('clusterView/sort', () => {
    describe('compareSortValues', () => {
        it('orders numbers arithmetically', () => {
            expect(compareSortValues(1, 2)).toBeLessThan(0);
            expect(compareSortValues(2, 1)).toBeGreaterThan(0);
            expect(compareSortValues(2, 2)).toBe(0);
        });

        it('orders strings case-insensitively and numerically', () => {
            expect(compareSortValues('apple', 'Banana')).toBeLessThan(0);
            // Numeric-aware: db2 sorts before db10.
            expect(compareSortValues('db2', 'db10')).toBeLessThan(0);
        });

        it('always sorts undefined last', () => {
            expect(compareSortValues(undefined, 5)).toBeGreaterThan(0);
            expect(compareSortValues(5, undefined)).toBeLessThan(0);
            expect(compareSortValues(undefined, undefined)).toBe(0);
        });
    });

    describe('filterAndSortRows', () => {
        const rows: TestRow[] = [
            { name: 'alpha', size: 30 },
            { name: 'Beta', size: 10 },
            { name: 'gamma', size: undefined },
            { name: 'delta', size: 20 },
        ];

        const byName = (r: TestRow): string => r.name;
        const bySize = (r: TestRow): number | undefined => r.size;

        const run = (
            search: string,
            getValue: (r: TestRow) => string | number | undefined,
            direction: SortDirection,
        ): string[] => filterAndSortRows(rows, search, byName, getValue, direction).map((r) => r.name);

        it('filters case-insensitively by name substring', () => {
            expect(run('a', byName, 'ascending')).toEqual(['alpha', 'Beta', 'delta', 'gamma']);
            expect(run('ET', byName, 'ascending')).toEqual(['Beta']);
        });

        it('returns all rows when the search term is empty', () => {
            expect(run('', byName, 'ascending')).toHaveLength(rows.length);
        });

        it('sorts ascending and descending by name', () => {
            expect(run('', byName, 'ascending')).toEqual(['alpha', 'Beta', 'delta', 'gamma']);
            expect(run('', byName, 'descending')).toEqual(['gamma', 'delta', 'Beta', 'alpha']);
        });

        it('keeps undefined metric values last in both directions', () => {
            // gamma (undefined size) stays last ascending and descending.
            expect(run('', bySize, 'ascending')).toEqual(['Beta', 'delta', 'alpha', 'gamma']);
            expect(run('', bySize, 'descending')).toEqual(['alpha', 'delta', 'Beta', 'gamma']);
        });

        it('does not mutate the input array', () => {
            const snapshot = rows.map((r) => r.name);
            filterAndSortRows(rows, '', byName, bySize, 'descending');
            expect(rows.map((r) => r.name)).toEqual(snapshot);
        });
    });
});
