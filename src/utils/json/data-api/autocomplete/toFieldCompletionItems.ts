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
     * When every dot-separated segment is a valid identifier the `$field` prefix
     * syntax is used.  When any segment is unsafe (dashes, spaces, quotes, etc.)
     * the expression is built as a chain of `$getField` calls with `input`
     * parameters, producing a valid nested field reference for the full path.
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
 * Escapes backslashes and double-quotes in a field path so it can be
 * safely wrapped in a double-quoted string (for `insertText` quoting
 * and `$getField` expressions).
 */
function escapeFieldName(path: string): string {
    return path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Build a valid MQL aggregation field reference for the given path.
 *
 * - All segments safe → `$path`
 * - First segment unsafe, single-segment → `{ $getField: "name" }`
 * - Nested with safe prefix + unsafe segment(s) → chained `$getField`
 *   with `input` parameter, e.g. `a.order-items.total` produces
 *   `{ $getField: { field: "total", input: { $getField: { field: "order-items", input: "$a" } } } }`
 */
function buildAggregationReference(path: string): string {
    const segments = path.split('.');

    const firstUnsafeIdx = segments.findIndex((s) => !JS_IDENTIFIER_PATTERN.test(s));

    if (firstUnsafeIdx === -1) {
        return `$${path}`;
    }

    // Start from the safe prefix as the innermost input
    const safePrefix = segments.slice(0, firstUnsafeIdx).join('.');
    let expr = safePrefix.length > 0 ? `"$${safePrefix}"` : '';

    // Wrap each remaining segment in a $getField call, building left-to-right
    for (let i = firstUnsafeIdx; i < segments.length; i++) {
        const escaped = escapeFieldName(segments[i]);
        if (expr === '') {
            expr = `{ $getField: "${escaped}" }`;
        } else {
            expr = `{ $getField: { field: "${escaped}", input: ${expr} } }`;
        }
    }

    return expr;
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
