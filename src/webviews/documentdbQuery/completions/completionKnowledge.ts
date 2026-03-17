/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Completion knowledge — curated domain rules for the completion provider.
 *
 * This file centralises "knowledge" that is **not** part of the generic
 * DocumentDB operator registry (`documentdb-constants`) but is essential for
 * producing high-quality, context-sensitive completions in the query editor.
 *
 * ### Why this file exists
 *
 * The `documentdb-constants` package is auto-generated from the official
 * operator reference and is intentionally kept generic — it describes *what*
 * operators exist, not *where* they are syntactically valid.
 *
 * However the completion provider needs to know additional rules:
 *
 * 1. **Which operators are only valid at key (root) position?**
 *    `$and`, `$or`, `$nor`, etc. accept sub-queries, not field values.
 *    Showing them inside a field's operator list (`{ age: { $and … } }`) is
 *    misleading, so we need an explicit list to filter them out of
 *    operator-position completions and include them in key-position completions.
 *
 * 2. **Placeholder character for labels**
 *    A single Unicode character used in completion-list labels to represent
 *    "user fills this in". Must render well in all editors and at any font size.
 *
 * Adding new knowledge here keeps the completion provider self-documented and
 * avoids magic values scattered across multiple files.
 */

/**
 * Operators that are syntactically valid only at the **key position** (the
 * root level of a query document, or inside a `$and`/`$or`/`$nor` array
 * element).
 *
 * These operators accept sub-expressions or arrays of sub-queries as their
 * values — they do **not** operate on a specific field's BSON value. For
 * example:
 *
 * ```js
 * // ✅ Valid — key position
 * { $and: [{ age: { $gt: 18 } }, { name: "Alice" }] }
 *
 * // ❌ Invalid — operator position on field 'age'
 * { age: { $and: … } }
 * ```
 *
 * The completion provider uses this set to:
 * - **Include** these operators at key position and array-element position
 * - **Exclude** them from operator position (inside `{ field: { … } }`)
 * - **Exclude** them from value position
 *
 * Source: DocumentDB query language specification — logical and meta operators.
 */
export const KEY_POSITION_OPERATORS = new Set([
    '$and',
    '$or',
    '$nor',
    '$not',
    '$comment',
    '$expr',
    '$jsonSchema',
    '$text',
    '$where',
]);

/**
 * Placeholder character used in completion-list **labels** to indicate where
 * the user should type a value.
 *
 * This is purely cosmetic — the actual insertText uses Monaco snippet tab stops
 * (`${1:placeholder}`). The label placeholder is what users see in the
 * completion picker before selecting an item.
 *
 * We use the horizontal ellipsis `…` (U+2026) because:
 * - It is universally understood as "something goes here"
 * - It renders reliably across all monospace and proportional fonts
 * - It is visually lightweight and does not distract from the operator syntax
 *
 * Previously we used `▪` (U+25AA, Black Small Square) but it was too subtle
 * at small font sizes and less semantically clear.
 */
export const LABEL_PLACEHOLDER = '\u2026'; // … (horizontal ellipsis)

/**
 * Info indicator for completion descriptions that contain usage examples.
 *
 * Prepended to description strings that show example values to differentiate
 * them from plain type labels (e.g., `"ℹ e.g. ends with '.com'"` vs `"string literal"`).
 */
export const INFO_INDICATOR = '\u2139'; // ℹ (information source)
