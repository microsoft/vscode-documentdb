/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BSONTypes, type FieldEntry } from '@vscode-documentdb/schema-analyzer';

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
    /** Whether the field was not present in every inspected document (statistical observation, not a constraint) */
    isSparse: boolean;
    /** Text to insert when the user selects this completion — quoted/escaped if the field name contains special chars */
    insertText: string;
    /**
     * Field reference for aggregation expressions, e.g., "$age", "$address.city".
     *
     * TODO: The simple `$field.path` syntax is invalid MQL for field names containing dots,
     * spaces, or `$` characters. For such fields, the correct MQL syntax is
     * `{ $getField: "fieldName" }`. This should be addressed when the aggregation
     * completion provider is wired up — either by using `$getField` for special names
     * or by making `referenceText` optional for fields that cannot use the `$` prefix syntax.
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

        return {
            fieldName: entry.path,
            displayType,
            bsonType: entry.bsonType,
            isSparse: entry.isSparse ?? false,
            insertText,
            referenceText: `$${entry.path}`,
        };
    });
}
