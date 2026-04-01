/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Platform-neutral JavaScript global definitions for completion providers.
 *
 * The `documentdb-query` language uses `@mongodb-js/shell-bson-parser` to
 * execute queries. That parser runs in a sandboxed scope that exposes a
 * limited set of JavaScript globals beyond the BSON constructors (which are
 * already registered in `documentdb-constants`).
 *
 * This module provides the data definitions for those JS globals.
 * Platform-specific mappers (Monaco/VS Code) convert them to CompletionItems.
 *
 * Source: `node_modules/@mongodb-js/shell-bson-parser/dist/scope.js`
 * (SCOPE_ANY, SCOPE_NEW, SCOPE_CALL, GLOBALS, ALLOWED_CLASS_EXPRESSIONS)
 */

/** A JS global completion definition. */
export interface JsGlobalDef {
    /** Display label (e.g., "Date") */
    label: string;
    /** Optional snippet to insert (otherwise label is used) */
    snippet?: string;
    /** Short description shown right-aligned in the completion list */
    description: string;
    /** Documentation shown in the details panel */
    documentation: string;
}

/**
 * JS globals available in shell-bson-parser's sandbox.
 *
 * These are the class expressions and global values that the parser's
 * sandboxed eval supports. BSON constructors (ObjectId, ISODate, etc.)
 * are already provided by `documentdb-constants` and are NOT duplicated here.
 */
export const JS_GLOBALS: readonly JsGlobalDef[] = [
    // -- Class constructors --
    {
        label: 'Date',
        snippet: 'new Date(${1})',
        description: 'JS global',
        documentation:
            'JavaScript Date constructor.\n\n' +
            'Usages:\n' +
            '- `new Date()` — current time\n' +
            '- `new Date("2025-01-01")` — specific date\n' +
            '- `new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)` — 14 days ago',
    },
    {
        label: 'Date.now()',
        snippet: 'Date.now()',
        description: 'JS global',
        documentation:
            'Returns milliseconds since Unix epoch (Jan 1, 1970).\n\nUseful for relative date queries:\n```\n{ $gt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }\n```',
    },
    {
        label: 'RegExp',
        snippet: 'RegExp("${1:pattern}")',
        description: 'JS global',
        documentation:
            'JavaScript RegExp constructor.\n\nExample: `RegExp("^test")`\n\nPrefer regex literals: `/^test/`',
    },

    // -- Math methods --
    {
        label: 'Math.floor()',
        snippet: 'Math.floor(${1:value})',
        description: 'JS global',
        documentation: 'Round down to the nearest integer.\n\nExample: `Math.floor(3.7)` → `3`',
    },
    {
        label: 'Math.ceil()',
        snippet: 'Math.ceil(${1:value})',
        description: 'JS global',
        documentation: 'Round up to the nearest integer.\n\nExample: `Math.ceil(3.2)` → `4`',
    },
    {
        label: 'Math.round()',
        snippet: 'Math.round(${1:value})',
        description: 'JS global',
        documentation: 'Round to the nearest integer.\n\nExample: `Math.round(3.5)` → `4`',
    },
    {
        label: 'Math.min()',
        snippet: 'Math.min(${1:a}, ${2:b})',
        description: 'JS global',
        documentation: 'Return the smaller of two values.\n\nExample: `Math.min(1.7, 2)` → `1.7`',
    },
    {
        label: 'Math.max()',
        snippet: 'Math.max(${1:a}, ${2:b})',
        description: 'JS global',
        documentation: 'Return the larger of two values.\n\nExample: `Math.max(1.7, 2)` → `2`',
    },

    // -- Primitive globals --
    {
        label: 'Infinity',
        description: 'JS global',
        documentation: 'Numeric value representing infinity.\n\nExample: `{ $lt: Infinity }`',
    },
    {
        label: 'NaN',
        description: 'JS global',
        documentation: 'Numeric value representing Not-a-Number.\n\nExample: `{ $ne: NaN }`',
    },
    {
        label: 'undefined',
        description: 'JS global',
        documentation: 'The undefined value.\n\nExample: `{ field: undefined }` — matches missing fields.',
    },
];
