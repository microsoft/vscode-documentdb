/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Type-aware value suggestions for the completion provider.
 *
 * When the cursor is at a value position and the field's BSON type is known,
 * this module provides contextual suggestions that match the field type:
 * - Boolean fields → `true`, `false`
 * - Number fields → range query snippet `{ $gt: ▪, $lt: ▪ }`
 * - String fields → regex snippet, empty string literal
 * - Date fields → ISODate constructor, date range snippet
 * - ObjectId fields → ObjectId constructor
 * - Null fields → `null`
 * - Array fields → `$elemMatch` snippet
 *
 * These suggestions appear at the top of the completion list (sort prefix `00_`)
 * to surface the most common patterns for each type.
 */

// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { escapeSnippetDollars } from './snippetUtils';

/** A type suggestion definition. */
interface TypeSuggestionDef {
    /** Display label */
    label: string;
    /** Text or snippet to insert */
    insertText: string;
    /** Whether insertText is a snippet (has tab stops) */
    isSnippet: boolean;
    /** Description shown in the label area */
    description: string;
    /** Documentation shown in the details panel */
    documentation?: string;
}

/**
 * Maps BSON type strings to curated value suggestions.
 *
 * Each type maps to an array of suggestions ordered by likelihood.
 * The suggestions use Monaco snippet syntax for tab stops.
 */
const TYPE_SUGGESTIONS: Record<string, readonly TypeSuggestionDef[]> = {
    // BSONTypes.Boolean = 'boolean'
    boolean: [
        { label: 'true', insertText: 'true', isSnippet: false, description: 'boolean literal' },
        { label: 'false', insertText: 'false', isSnippet: false, description: 'boolean literal' },
    ],
    // BSONTypes.Int32 = 'int32'
    int32: numberSuggestions(),
    // BSONTypes.Double = 'double'
    double: numberSuggestions(),
    // BSONTypes.Long = 'long'
    long: numberSuggestions(),
    // BSONTypes.Decimal128 = 'decimal128'
    decimal128: numberSuggestions(),
    // BSONTypes.Number = 'number' (generic number without specific subtype)
    number: numberSuggestions(),
    string: [
        {
            label: '{ $regex: /▪/ }',
            insertText: '{ $regex: /${1:pattern}/ }',
            isSnippet: true,
            description: 'pattern match',
            documentation: 'Match documents where this string field matches a regular expression pattern.',
        },
        {
            label: '""',
            insertText: '"${1:text}"',
            isSnippet: true,
            description: 'string literal',
        },
    ],
    date: [
        {
            label: 'ISODate("▪")',
            insertText: 'ISODate("${1:2025-01-01T00:00:00Z}")',
            isSnippet: true,
            description: 'date value',
        },
        {
            label: '{ $gt: ISODate("▪"), $lt: ISODate("▪") }',
            insertText: '{ $gt: ISODate("${1:2025-01-01T00:00:00Z}"), $lt: ISODate("${2:2025-12-31T23:59:59Z}") }',
            isSnippet: true,
            description: 'date range',
            documentation: 'Match documents where this date field falls within a range.',
        },
    ],
    objectid: [
        {
            label: 'ObjectId("▪")',
            insertText: 'ObjectId("${1:hex}")',
            isSnippet: true,
            description: 'objectid value',
        },
    ],
    null: [{ label: 'null', insertText: 'null', isSnippet: false, description: 'null literal' }],
    array: [
        {
            label: '{ $elemMatch: { ▪ } }',
            insertText: '{ $elemMatch: { ${1:query} } }',
            isSnippet: true,
            description: 'match array element',
            documentation: 'Match documents where at least one array element matches the query.',
        },
        {
            label: '{ $size: ▪ }',
            insertText: '{ $size: ${1:length} }',
            isSnippet: true,
            description: 'array length',
            documentation: 'Match documents where the array has the specified number of elements.',
        },
    ],
};

/** Shared number-type suggestions (int, double, long, decimal). */
function numberSuggestions(): readonly TypeSuggestionDef[] {
    return [
        {
            label: '{ $gt: ▪, $lt: ▪ }',
            insertText: '{ $gt: ${1:min}, $lt: ${2:max} }',
            isSnippet: true,
            description: 'range query',
            documentation: 'Match documents where this numeric field falls within a range.',
        },
        {
            label: '{ $gte: ▪ }',
            insertText: '{ $gte: ${1:value} }',
            isSnippet: true,
            description: 'minimum value',
        },
    ];
}

/**
 * Creates type-aware value suggestions based on the field's BSON type.
 *
 * Returns an array of high-priority completion items (sort prefix `00_`)
 * that appear at the top of the value-position completion list.
 *
 * Returns an empty array when the BSON type is unknown or has no specific suggestions.
 *
 * @param fieldBsonType - BSON type string from the schema (e.g., 'int', 'string', 'bool')
 * @param range - the insertion range
 * @param monaco - the Monaco API
 */
export function createTypeSuggestions(
    fieldBsonType: string | undefined,
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
): monacoEditor.languages.CompletionItem[] {
    if (!fieldBsonType) {
        return [];
    }

    const suggestions = TYPE_SUGGESTIONS[fieldBsonType];
    if (!suggestions) {
        return [];
    }

    return suggestions.map((def, index) => {
        let insertText = def.insertText;
        if (def.isSnippet) {
            insertText = escapeSnippetDollars(insertText);
        }

        return {
            label: {
                label: def.label,
                description: def.description,
            },
            kind: def.isSnippet
                ? monaco.languages.CompletionItemKind.Snippet
                : monaco.languages.CompletionItemKind.Value,
            insertText,
            insertTextRules: def.isSnippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
            documentation: def.documentation ? { value: def.documentation } : undefined,
            sortText: `00_${String(index).padStart(2, '0')}`,
            preselect: index === 0,
            range,
        };
    });
}
