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
import { INFO_INDICATOR, LABEL_PLACEHOLDER } from './completionKnowledge';
import { escapeSnippetDollars } from './snippetUtils';

/** Shorthand for the placeholder glyph used in labels. */
const P = LABEL_PLACEHOLDER;
/** Shorthand for the info indicator. */
const I = INFO_INDICATOR;

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
        { label: 'true', insertText: 'true', isSnippet: false, description: `${I} e.g. { isActive: true }` },
        { label: 'false', insertText: 'false', isSnippet: false, description: `${I} e.g. { isVerified: false }` },
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
            label: `{ $regex: /${P}/ }`,
            insertText: '{ $regex: /${1:pattern}/ }',
            isSnippet: true,
            description: `${I} e.g. ends with '.com'`,
            documentation: 'Match documents where this string field matches a regular expression pattern.',
        },
        {
            label: '""',
            insertText: '"${1:text}"',
            isSnippet: true,
            description: `${I} e.g. "active", "pending"`,
        },
    ],
    date: [
        {
            label: `ISODate("${P}")`,
            insertText: `ISODate("\${1:${twoWeeksAgo()}}")`,
            isSnippet: true,
            description: `${I} e.g. ISODate("${twoWeeksAgo()}")`,
        },
        {
            label: `{ $gt: ISODate("${P}"), $lt: ISODate("${P}") }`,
            insertText: `{ $gt: ISODate("\${1:${twoWeeksAgo()}}"), $lt: ISODate("\${2:${todayISO()}}") }`,
            isSnippet: true,
            description: `${I} e.g. last 2 weeks`,
            documentation: 'Match documents where this date field falls within a range.',
        },
        {
            label: 'new Date(Date.now() - …)',
            insertText: 'new Date(Date.now() - ${1:14} * 24 * 60 * 60 * 1000)',
            isSnippet: true,
            description: `${I} e.g. 14 days ago`,
            documentation: 'Compute a date relative to now. Change the number to adjust the offset in days.',
        },
    ],
    objectid: [
        {
            label: `ObjectId("${P}")`,
            insertText: 'ObjectId("${1:hex}")',
            isSnippet: true,
            description: `${I} e.g. ObjectId("507f1f77...")`,
        },
    ],
    null: [{ label: 'null', insertText: 'null', isSnippet: false, description: `${I} e.g. { field: null }` }],
    array: [
        {
            label: `{ $elemMatch: { ${P} } }`,
            insertText: '{ $elemMatch: { ${1:query} } }',
            isSnippet: true,
            description: `${I} e.g. tags with "urgent"`,
            documentation: 'Match documents where at least one array element matches the query.',
        },
        {
            label: `{ $size: ${P} }`,
            insertText: '{ $size: ${1:length} }',
            isSnippet: true,
            description: `${I} e.g. exactly 3 items`,
            documentation: 'Match documents where the array has the specified number of elements.',
        },
    ],
};

/** Shared number-type suggestions (int, double, long, decimal). */
function numberSuggestions(): readonly TypeSuggestionDef[] {
    return [
        {
            label: `{ $gt: ${P}, $lt: ${P} }`,
            insertText: '{ $gt: ${1:min}, $lt: ${2:max} }',
            isSnippet: true,
            description: `${I} e.g. between 18 and 65`,
            documentation: 'Match documents where this numeric field falls within a range.',
        },
        {
            label: `{ $gte: ${P} }`,
            insertText: '{ $gte: ${1:value} }',
            isSnippet: true,
            description: `${I} e.g. at least 100`,
        },
    ];
}

/**
 * Returns an ISO 8601 timestamp for two weeks ago (UTC, midnight).
 * Used as a sensible default date placeholder — recent enough to be practical.
 */
function twoWeeksAgo(): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 14);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString().replace('.000Z', 'Z');
}

/**
 * Returns an ISO 8601 timestamp for today (UTC, end of day).
 */
function todayISO(): string {
    const d = new Date();
    d.setUTCHours(23, 59, 59, 0);
    return d.toISOString().replace('.000Z', 'Z');
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
