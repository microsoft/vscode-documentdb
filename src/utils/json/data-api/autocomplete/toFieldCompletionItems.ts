/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BSONTypes, type FieldEntry } from '@documentdb-js/schema-analyzer';

/**
 * Completion-ready data for a single field entry.
 *
 * Design intent:
 * - `fieldName` is the human-readable, unescaped field path shown in the completion list.
 *   Users see clean names like "address.city" or "order-items" without quotes or escaping.
 * - `insertText` is the escaped/quoted form that gets inserted when the user selects a
 *   completion item. For simple identifiers it matches `fieldName`; for names containing
 *   special characters (dots, spaces, `$`, etc.) it is wrapped in double quotes.
 * - `referenceText` is the `$`-prefixed aggregation field reference (e.g., "$age").
 */
export interface FieldCompletionData {
    /** The full dot-notated field name, e.g., "address.city" — kept unescaped for display */
    fieldName: string;
    /** Human-readable type display, e.g., "String", "Date", "ObjectId" */
    displayType: string;
    /** Raw BSON type from FieldEntry */
    bsonType: string;
    /** All observed BSON types for polymorphic fields (e.g., ["string", "int32"]) */
    bsonTypes?: string[];
    /** Human-readable display strings for all observed types (e.g., ["String", "Int32"]) */
    displayTypes?: string[];
    /** Whether the field was not present in every inspected document (statistical observation, not a constraint) */
    isSparse: boolean;
    /** Text to insert when the user selects this completion — quoted/escaped if the field name contains special chars */
    insertText: string;
    /**
     * Field reference for aggregation expressions, e.g., "$age", "$address.city".
     *
     * When every dot-separated segment is aggregation-safe the compact `$field`
     * prefix syntax is used. If any segment contains special characters (dashes,
     * spaces, quotes) or a `$`, the `$getField` form is emitted instead:
     * - top-level unsafe field → `{ $getField: "order-items" }`
     * - nested unsafe segment  → `{ $getField: { field: "order-items", input: "$a" } }`
     *
     * Literal-dot field names (e.g. a field actually named `"a.b"`) cannot be
     * distinguished from nested paths here and are treated as nested. See
     * future-work.md item 3.
     */
    referenceText: string;
}

/**
 * Matches valid JavaScript/TypeScript identifiers.
 * A valid identifier starts with a letter, underscore, or dollar sign,
 * followed by zero or more letters, digits, underscores, or dollar signs.
 *
 * Field names that do NOT match this pattern must be quoted and escaped
 * in `insertText` to produce valid query expressions.
 */
const JS_IDENTIFIER_PATTERN = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * Matches a single path segment that is safe to embed directly in the
 * `$field` aggregation-reference syntax.
 *
 * This is intentionally STRICTER than {@link JS_IDENTIFIER_PATTERN}: a
 * leading or embedded `$` is disallowed. In aggregation expressions the
 * `$` prefix introduces a field path and `$$` introduces a variable, so a
 * field literally named `$price` would be misread as the variable
 * `$$price`, and `a$b` references are ambiguous. Such segments are routed
 * through `$getField`, where the name is treated as an opaque literal.
 */
const AGGREGATION_SAFE_SEGMENT_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Escapes backslashes and double-quotes in a field path so it can be
 * safely wrapped in a double-quoted string (for `insertText` quoting
 * and `$getField` expressions).
 */
function escapeFieldName(path: string): string {
    return path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Builds a valid MQL aggregation field reference for a (possibly nested)
 * field path.
 *
 * - When every dot-separated segment is aggregation-safe, the compact
 *   `$a.b.c` prefix form is used (e.g. `$address.city`).
 * - Otherwise the reference is constructed with `$getField`:
 *   - a top-level unsafe field → `{ $getField: "order-items" }`
 *   - a nested unsafe segment  →
 *     `{ $getField: { field: "<leaf>", input: <reference-to-parent> } }`
 *
 *   The leading run of safe segments is collapsed into a single quoted
 *   `"$a.b"` field-path used as the innermost `input`, so only the unsafe
 *   (and any trailing) segments need individual wrapping. Using the
 *   `{ field, input }` form is what keeps nested references correct:
 *   `{ $getField: "a.order-items" }` would instead look up a *top-level*
 *   field literally named `a.order-items`, which is the wrong document.
 *
 * NOTE (known limitation): `FieldEntry.path` is a flattened, dot-joined
 * string, so a field literally named `"a.b"` is indistinguishable from a
 * nested `{ a: { b } }`. Dots are always interpreted as nesting. See
 * future-work.md item 3 for the planned segment-array fix.
 */
function buildAggregationReference(path: string): string {
    const segments = path.split('.');

    // Fast path: a fully safe path keeps the compact `$a.b.c` form.
    if (segments.every((segment) => AGGREGATION_SAFE_SEGMENT_PATTERN.test(segment))) {
        return `$${path}`;
    }

    // Collapse the leading run of safe segments into a single `$a.b` input.
    let prefixLength = 0;
    while (prefixLength < segments.length && AGGREGATION_SAFE_SEGMENT_PATTERN.test(segments[prefixLength])) {
        prefixLength++;
    }

    let reference: string;
    let startIndex: number;
    if (prefixLength > 0) {
        // The safe leading run becomes a quoted `"$a.b"` field-path string,
        // used as the `input` document for the first unsafe segment.
        reference = `"$${segments.slice(0, prefixLength).join('.')}"`;
        startIndex = prefixLength;
    } else {
        // No safe prefix: the first segment is an unsafe top-level field.
        reference = `{ $getField: "${escapeFieldName(segments[0])}" }`;
        startIndex = 1;
    }

    for (let i = startIndex; i < segments.length; i++) {
        reference = `{ $getField: { field: "${escapeFieldName(segments[i])}", input: ${reference} } }`;
    }

    return reference;
}

/**
 * Converts an array of FieldEntry objects into completion-ready FieldCompletionData items.
 *
 * @param fields - Array of FieldEntry objects from getKnownFields
 * @returns Array of FieldCompletionData ready for use in editor completions
 */
export function toFieldCompletionItems(fields: FieldEntry[]): FieldCompletionData[] {
    return fields.map((entry) => {
        const displayType = BSONTypes.toDisplayString(entry.bsonType as BSONTypes);
        const needsQuoting = !JS_IDENTIFIER_PATTERN.test(entry.path);

        let insertText: string;
        if (needsQuoting) {
            insertText = `"${escapeFieldName(entry.path)}"`;
        } else {
            insertText = entry.path;
        }

        const referenceText = buildAggregationReference(entry.path);

        return {
            fieldName: entry.path,
            displayType,
            bsonType: entry.bsonType,
            bsonTypes: entry.bsonTypes,
            displayTypes: entry.bsonTypes?.map((t) => BSONTypes.toDisplayString(t as BSONTypes)),
            isSparse: entry.isSparse ?? false,
            insertText,
            referenceText,
        };
    });
}
