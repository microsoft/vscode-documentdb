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
 * - `referenceText` is the aggregation field reference (e.g., `"$age"`), or `undefined`
 *   when no safe single-expression form exists (e.g., a nested path with a special-character
 *   segment whose `$getField` form would require chaining).
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
     * Field reference for aggregation expressions.
     *
     * - Safe paths (every dot-separated segment is a plain identifier): `"$age"`, `"$address.city"`.
     * - Flat fields with special characters: `'{ $getField: "order-items" }'`.
     * - Nested paths with a special-character segment: absent — the correct
     *   `$getField` form requires chaining and is deferred to a follow-up.
     */
    referenceText?: string;
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

        // Build referenceText: check each dot-separated segment individually because
        // $field.path is valid MQL even when the full path contains dots (nested traversal),
        // but breaks when any segment contains characters outside plain identifiers.
        const segments = entry.path.split('.');
        const hasUnsafeSegment = segments.some((seg) => !JS_IDENTIFIER_PATTERN.test(seg));
        let referenceText: string | undefined;
        if (!hasUnsafeSegment) {
            referenceText = `$${entry.path}`;
        } else if (segments.length === 1) {
            // Flat field with special characters — $getField is the correct single-expression form.
            const escapedForGetField = entry.path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            referenceText = `{ $getField: "${escapedForGetField}" }`;
        } else {
            // Nested path with an unsafe segment — $getField chaining is complex; omit for now.
            referenceText = undefined;
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
