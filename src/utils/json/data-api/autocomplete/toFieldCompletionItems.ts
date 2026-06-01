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
     * For field names containing special characters (dashes, spaces, quotes, etc.)
     * that cannot use the `$field` prefix syntax, this emits the `$getField` form
     * instead, e.g., `{ $getField: "order-items" }`.
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
 * Returns true when every dot-separated segment of `path` is a valid
 * identifier, meaning the `$field`-prefix aggregation syntax is safe.
 *
 * The `$` prefix syntax (e.g. `$address.city`) is valid MQL only when
 * each segment between dots is a valid identifier.  Single-segment
 * fields containing dashes, spaces, or quotes (e.g. `order-items`,
 * `my field`, `say"hi"`) cannot use the `$` prefix.
 */
function isSafeAggregationReference(path: string): boolean {
    return path.split('.').every((segment) => JS_IDENTIFIER_PATTERN.test(segment));
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
            const escaped = entry.path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            insertText = `"${escaped}"`;
        } else {
            insertText = entry.path;
        }

        let referenceText: string;
        if (isSafeAggregationReference(entry.path)) {
            referenceText = `$${entry.path}`;
        } else {
            const escaped = entry.path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            referenceText = needsQuoting
                ? `{ $getField: "${escaped}" }`
                : `{ $getField: "${entry.path}" }`;
        }

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
