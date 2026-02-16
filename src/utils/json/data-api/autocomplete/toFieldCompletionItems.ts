/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BSONTypes } from '../BSONTypes';
import { type FieldEntry } from './getKnownFields';

/**
 * Completion-ready data for a single field entry.
 */
export interface FieldCompletionData {
    /** The full dot-notated field name, e.g., "address.city" */
    fieldName: string;
    /** Human-readable type display, e.g., "String", "Date", "ObjectId" */
    displayType: string;
    /** Raw BSON type from FieldEntry */
    bsonType: string;
    /** Whether the field was not present in every inspected document (statistical observation, not a constraint) */
    isSparse: boolean;
    /** Text to insert — escaped if field name contains dots or special chars */
    insertText: string;
    /** Field reference for aggregation expressions, e.g., "$age", "$address.city" */
    referenceText: string;
}

/**
 * Characters that require quoting in a field name for insert text.
 */
const SPECIAL_CHARS_PATTERN = /[.$\s]/;

/**
 * Converts an array of FieldEntry objects into completion-ready FieldCompletionData items.
 *
 * @param fields - Array of FieldEntry objects from getKnownFields
 * @returns Array of FieldCompletionData ready for use in editor completions
 */
export function toFieldCompletionItems(fields: FieldEntry[]): FieldCompletionData[] {
    return fields.map((entry) => {
        const displayType = BSONTypes.toDisplayString(entry.bsonType as BSONTypes);
        const needsQuoting = SPECIAL_CHARS_PATTERN.test(entry.path);

        return {
            fieldName: entry.path,
            displayType,
            bsonType: entry.bsonType,
            isSparse: entry.isSparse ?? false,
            insertText: needsQuoting ? `"${entry.path}"` : entry.path,
            referenceText: `$${entry.path}`,
        };
    });
}
