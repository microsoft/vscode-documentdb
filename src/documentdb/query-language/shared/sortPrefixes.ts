/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Platform-neutral sort prefix logic for completion items.
 *
 * These functions compute `sortText` prefixes used to order completion items
 * by relevance. They are shared by both the Monaco (webview) and VS Code
 * (query playground) completion providers.
 */

import { type OperatorEntry } from '@vscode-documentdb/documentdb-constants';

/**
 * The subset of OperatorEntry properties needed for sort prefix computation.
 */
type SortableEntry = Pick<OperatorEntry, 'meta' | 'applicableBsonTypes'>;

/**
 * Computes a sortText prefix for an operator based on its type relevance
 * to the given field BSON types.
 *
 * Sorting tiers (ascending = higher priority):
 * - `"0_"` — Type-relevant: operator's `applicableBsonTypes` intersects with `fieldBsonTypes`
 * - `"1a_"` — Comparison operators (universal): `$eq`, `$ne`, `$gt`, `$in`, etc.
 *   These are the most commonly used operators for any field type.
 * - `"1b_"` — Other universal operators: element, evaluation, geospatial, etc.
 * - `"2_"` — Non-matching: operator's `applicableBsonTypes` is set but doesn't match
 *
 * Returns `undefined` when no field type info is available (no sorting override).
 */
export function getOperatorSortPrefix(
    entry: SortableEntry,
    fieldBsonTypes: readonly string[] | undefined,
): string | undefined {
    if (!fieldBsonTypes || fieldBsonTypes.length === 0) {
        return undefined;
    }

    if (!entry.applicableBsonTypes || entry.applicableBsonTypes.length === 0) {
        // Promote comparison operators above other universal operators
        return entry.meta === 'query:comparison' ? '1a_' : '1b_';
    }

    const hasMatch = entry.applicableBsonTypes.some((t) => fieldBsonTypes.includes(t));
    return hasMatch ? '0_' : '2_';
}

/**
 * Extracts a human-readable category label from a meta tag.
 * `'query:comparison'` → `'comparison'`, `'bson'` → `'bson'`
 */
export function getCategoryLabel(meta: string): string {
    const colonIndex = meta.indexOf(':');
    return colonIndex >= 0 ? meta.substring(colonIndex + 1) : meta;
}
