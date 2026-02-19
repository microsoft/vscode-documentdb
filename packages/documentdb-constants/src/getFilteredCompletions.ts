/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Primary consumer API for the documentdb-constants package.
 *
 * Provides filtered access to the operator entries based on meta tags
 * and optional BSON type constraints.
 */

import { type CompletionFilter, type OperatorEntry } from './types';

/**
 * Internal registry of all operator entries. Populated by the
 * individual operator module files (queryOperators, stages, etc.)
 * via {@link registerOperators}.
 */
const allOperators: OperatorEntry[] = [];

/**
 * Registers operator entries into the global registry.
 * Called by each operator module during module initialization.
 *
 * @param entries - array of OperatorEntry objects to register
 */
export function registerOperators(entries: readonly OperatorEntry[]): void {
    allOperators.push(...entries);
}

/**
 * Returns operator entries matching the given filter.
 *
 * Meta tag matching uses **prefix matching**: a filter meta of 'query'
 * matches 'query', 'query:comparison', 'query:logical', etc.
 * A filter meta of 'expr' matches all 'expr:*' entries.
 *
 * BSON type filtering is applied as an intersection: if `filter.bsonTypes`
 * is provided, only operators whose `applicableBsonTypes` includes at least
 * one of the requested types are returned. Operators without
 * `applicableBsonTypes` (universal operators) are always included.
 *
 * @param filter - the filtering criteria
 * @returns matching operator entries (frozen array)
 */
export function getFilteredCompletions(filter: CompletionFilter): readonly OperatorEntry[] {
    return allOperators.filter((entry) => {
        // Meta tag prefix matching
        const metaMatch = filter.meta.some((prefix) => entry.meta === prefix || entry.meta.startsWith(prefix + ':'));
        if (!metaMatch) {
            return false;
        }

        // BSON type filtering (if specified)
        if (filter.bsonTypes && filter.bsonTypes.length > 0) {
            // Universal operators (no applicableBsonTypes) always pass
            if (entry.applicableBsonTypes && entry.applicableBsonTypes.length > 0) {
                const hasMatch = entry.applicableBsonTypes.some((t) => filter.bsonTypes!.includes(t));
                if (!hasMatch) {
                    return false;
                }
            }
        }

        return true;
    });
}

/**
 * Returns all operator entries (unfiltered).
 * Useful for validation, testing, and diagnostics.
 */
export function getAllCompletions(): readonly OperatorEntry[] {
    return allOperators;
}
