/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Double, EJSON, Long, type Document } from 'bson';

function isBsonLong(value: unknown): value is Long {
    return (
        value instanceof Long ||
        (typeof value === 'object' && value !== null && '_bsontype' in value && value._bsontype === 'Long')
    );
}

function isBsonDouble(value: unknown): value is Double {
    return (
        value instanceof Double ||
        (typeof value === 'object' && value !== null && '_bsontype' in value && value._bsontype === 'Double')
    );
}

function preserveNumericTypesForEjson(value: unknown): unknown {
    if (isBsonLong(value)) {
        return EJSON.serialize(value, { relaxed: false });
    }

    if (isBsonDouble(value)) {
        const numericValue = value.valueOf();
        // Integral doubles (including -0) would serialize as plain integers in relaxed EJSON
        // and be parsed back as Int32 or Long instead of Double.
        if (Number.isInteger(numericValue)) {
            return EJSON.serialize(value, { relaxed: false });
        }
        return value;
    }

    if (Array.isArray(value)) {
        return value.map(preserveNumericTypesForEjson);
    }

    if (
        value !== null &&
        typeof value === 'object' &&
        !('_bsontype' in value) &&
        !(value instanceof Date) &&
        !(value instanceof RegExp)
    ) {
        const result: Record<string, unknown> = {};
        for (const [key, entryValue] of Object.entries(value)) {
            result[key] = preserveNumericTypesForEjson(entryValue);
        }
        return result;
    }

    return value;
}

/**
 * Serializes a BSON document to pretty-printed Extended JSON for the Document View editor.
 * Keeps relaxed formatting for readability while preserving explicit `$numberLong` and
 * integral `$numberDouble` wrappers where relaxed EJSON would lose precision or BSON types.
 */
export function stringifyDocumentForEditor(document: Document | null): string {
    return EJSON.stringify(preserveNumericTypesForEjson(document), undefined, 4);
}

/**
 * Parses Extended JSON from the Document View editor back into a BSON document
 * without relaxing explicit `$numberLong`, `$numberDouble`, or `$numberInt` wrappers.
 */
export function parseDocumentFromEditor(documentContent: string): Document {
    return EJSON.parse(documentContent, { relaxed: false }) as Document;
}
