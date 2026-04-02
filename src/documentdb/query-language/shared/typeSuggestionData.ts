/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Platform-neutral type suggestion definitions.
 *
 * Contains the type suggestion data (TypeSuggestionDef interface and
 * TYPE_SUGGESTIONS map) shared by both Monaco and VS Code completion providers.
 * These definitions describe WHAT to suggest for each BSON type — the
 * platform-specific mappers handle HOW to create CompletionItems.
 */

import { LABEL_PLACEHOLDER } from './completionKnowledge';

/** A type suggestion definition. */
export interface TypeSuggestionDef {
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
 * The suggestions use snippet syntax for tab stops.
 */
const TYPE_SUGGESTIONS: Record<string, readonly TypeSuggestionDef[]> = {
    // BSONTypes.Boolean = 'boolean'
    boolean: [
        {
            label: 'true',
            insertText: 'true',
            isSnippet: false,
            description: 'boolean literal',
            documentation: `Boolean literal \`true\`.\n\nExample: \`{ field: true }\``,
        },
        {
            label: 'false',
            insertText: 'false',
            isSnippet: false,
            description: 'boolean literal',
            documentation: `Boolean literal \`false\`.\n\nExample: \`{ field: false }\``,
        },
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
            label: `{ $regex: /${LABEL_PLACEHOLDER}/ }`,
            insertText: '{ $regex: /${1:pattern}/ }',
            isSnippet: true,
            description: 'pattern match',
            documentation:
                'Match string fields with a regex pattern.\n\n' +
                'Example — ends with `.com`:\n```\n{ $regex: /\\.com$/ }\n```',
        },
        {
            label: '{ $regex: /\\.com$/ }',
            insertText: '{ $regex: /${1:\\.com$}/ }',
            isSnippet: true,
            description: `ends with .com - pattern match`,
            documentation: 'Example pattern match for: ends with `.com`:\n```\n{ $regex: /\\.com$/ }\n```',
        },
        {
            label: '""',
            insertText: '"${1:text}"',
            isSnippet: true,
            description: 'string literal',
            documentation: `Exact string match.\n\nExample: \`"active"\`, \`"pending"\``,
        },
    ],
    date: [
        {
            label: `ISODate("${LABEL_PLACEHOLDER}")`,
            insertText: `ISODate("\${1:${twoWeeksAgo()}}")`,
            isSnippet: true,
            description: 'date value',
            documentation: `Match a specific date.\n\nExample: \`ISODate("${twoWeeksAgo()}")\``,
        },
        {
            label: `{ $gt: ISODate("${LABEL_PLACEHOLDER}"), $lt: ISODate("${LABEL_PLACEHOLDER}") }`,
            insertText: `{ $gt: ISODate("\${1:${twoWeeksAgo()}}"), $lt: ISODate("\${2:${todayISO()}}") }`,
            isSnippet: true,
            description: 'date range',
            documentation: `Match dates within a range.\n\nExample: last 2 weeks — \`{ $gt: ISODate("${twoWeeksAgo()}"), $lt: ISODate("${todayISO()}") }\``,
        },
        {
            label: `{ $gt: new Date(Date.now() - ${LABEL_PLACEHOLDER}) }`,
            insertText: '{ $gt: new Date(Date.now() - ${1:14} * 24 * 60 * 60 * 1000) }',
            isSnippet: true,
            description: 'last N days',
            documentation: `Match dates in the last N days relative to now.\n\nExample: last 14 days — \`{ $gt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) }\``,
        },
    ],
    objectid: [
        {
            label: `ObjectId("${LABEL_PLACEHOLDER}")`,
            insertText: 'ObjectId("${1:hex}")',
            isSnippet: true,
            description: 'ObjectId value',
            documentation: `Match by ObjectId.\n\nExample: \`ObjectId("507f1f77bcf86cd799439011")\``,
        },
    ],
    null: [
        {
            label: 'null',
            insertText: 'null',
            isSnippet: false,
            description: 'null literal',
            documentation: `Match null or missing fields.\n\nExample: \`{ field: null }\``,
        },
    ],
    array: [
        {
            label: `{ $elemMatch: { ${LABEL_PLACEHOLDER} } }`,
            insertText: '{ $elemMatch: { ${1:query} } }',
            isSnippet: true,
            description: 'match element',
            documentation: `Match arrays with at least one element satisfying the query.\n\nExample: \`{ $elemMatch: { status: "urgent" } }\``,
        },
        {
            label: `{ $size: ${LABEL_PLACEHOLDER} }`,
            insertText: '{ $size: ${1:length} }',
            isSnippet: true,
            description: 'array length',
            documentation: `Match arrays with exactly N elements.\n\nExample: \`{ $size: 3 }\``,
        },
    ],
};

/** Shared number-type suggestions (int, double, long, decimal). */
function numberSuggestions(): readonly TypeSuggestionDef[] {
    return [
        {
            label: `{ $gt: ${LABEL_PLACEHOLDER}, $lt: ${LABEL_PLACEHOLDER} }`,
            insertText: '{ $gt: ${1:min}, $lt: ${2:max} }',
            isSnippet: true,
            description: 'range query',
            documentation: `Match numbers within a range.\n\nExample: between 18 and 65 — \`{ $gt: 18, $lt: 65 }\``,
        },
        {
            label: `{ $gte: ${LABEL_PLACEHOLDER} }`,
            insertText: '{ $gte: ${1:value} }',
            isSnippet: true,
            description: 'minimum value',
            documentation: `Match numbers greater than or equal to a value.\n\nExample: at least 100 — \`{ $gte: 100 }\``,
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
 * Returns platform-neutral type suggestion definitions for a BSON type.
 *
 * Used by both the Monaco (webview) and VS Code (scratchpad) completion
 * providers to create type-aware value completions.
 *
 * @param fieldBsonType - BSON type string from the schema
 * @returns Suggestion definitions, or empty array if no suggestions for this type
 */
export function getTypeSuggestionDefs(fieldBsonType: string | undefined): readonly TypeSuggestionDef[] {
    if (!fieldBsonType) return [];
    return TYPE_SUGGESTIONS[fieldBsonType] ?? [];
}
