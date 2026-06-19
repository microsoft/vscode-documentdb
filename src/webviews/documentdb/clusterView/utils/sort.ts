/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type SortDirection } from '../types';

/**
 * Compare two sort values for table ordering. Strings compare
 * case-insensitively and numerically (so `db2` sorts before `db10`); numbers
 * compare arithmetically. `undefined` (an unavailable metric) always sorts
 * last regardless of direction so missing data never floats to the top.
 *
 * @returns A negative / zero / positive number for ascending order.
 */
export function compareSortValues(a: string | number | undefined, b: string | number | undefined): number {
    if (a === undefined && b === undefined) {
        return 0;
    }
    if (a === undefined) {
        return 1;
    }
    if (b === undefined) {
        return -1;
    }
    if (typeof a === 'string' && typeof b === 'string') {
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    }
    return (a as number) - (b as number);
}

/**
 * Filter rows whose name contains the (case-insensitive) search term, then sort
 * by the value returned from `getSortValue` in the requested direction.
 * `undefined` values are pushed to the end in both directions.
 */
export function filterAndSortRows<TRow>(
    rows: ReadonlyArray<TRow>,
    search: string,
    getName: (row: TRow) => string,
    getSortValue: (row: TRow) => string | number | undefined,
    direction: SortDirection,
): TRow[] {
    const term = search.trim().toLowerCase();
    const filtered = term.length === 0 ? [...rows] : rows.filter((row) => getName(row).toLowerCase().includes(term));

    filtered.sort((a, b) => {
        const valueA = getSortValue(a);
        const valueB = getSortValue(b);
        // Keep undefined metrics last irrespective of direction.
        if (valueA === undefined || valueB === undefined) {
            return compareSortValues(valueA, valueB);
        }
        const result = compareSortValues(valueA, valueB);
        return direction === 'ascending' ? result : -result;
    });

    return filtered;
}
