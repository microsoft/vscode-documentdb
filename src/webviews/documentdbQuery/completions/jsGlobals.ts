/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * JavaScript global completions for the `documentdb-query` language.
 *
 * The `documentdb-query` language uses `@mongodb-js/shell-bson-parser` to
 * execute queries. That parser runs in a sandboxed scope that exposes a
 * limited set of JavaScript globals beyond the BSON constructors (which are
 * already registered in `documentdb-constants`).
 *
 * This module provides completion items for those JS globals so they appear
 * in the value-position completion list. They are NOT added to
 * `documentdb-constants` because they are runtime JS constructs, not
 * DocumentDB API operators.
 *
 * ### Supported JS globals (from shell-bson-parser's sandbox scope)
 *
 * **Class expressions** (object with whitelisted methods):
 * - `Date` — `new Date()`, `Date()`, `Date.now()`, plus instance methods
 * - `Math` — `Math.floor()`, `Math.min()`, `Math.max()`, etc.
 *
 * **Globals** (primitive values):
 * - `Infinity`, `NaN`, `undefined`
 *
 * **Constructor functions** (SCOPE_ANY / SCOPE_NEW / SCOPE_CALL):
 * - `RegExp` — already handled by the JS tokenizer, but listed for completeness
 *
 * Source: `node_modules/@mongodb-js/shell-bson-parser/dist/scope.js`
 * (SCOPE_ANY, SCOPE_NEW, SCOPE_CALL, GLOBALS, ALLOWED_CLASS_EXPRESSIONS)
 */

// eslint-disable-next-line import/no-internal-modules
import type * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import { escapeSnippetDollars } from './snippetUtils';

/** A JS global completion definition. */
interface JsGlobalDef {
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
const JS_GLOBALS: readonly JsGlobalDef[] = [
    {
        label: 'Date',
        snippet: 'new Date(${1})',
        description: 'JS global',
        documentation:
            'JavaScript Date constructor.\n\n' +
            'Usages:\n' +
            '- `new Date()` — current time\n' +
            '- `new Date("2025-01-01")` — specific date\n' +
            '- `Date.now()` — milliseconds since epoch\n' +
            '- `new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)` — 14 days ago',
    },
    {
        label: 'Math',
        description: 'JS global',
        documentation:
            'JavaScript Math object.\n\n' +
            'Common methods:\n' +
            '- `Math.floor(n)` — round down\n' +
            '- `Math.ceil(n)` — round up\n' +
            '- `Math.min(a, b)` — minimum\n' +
            '- `Math.max(a, b)` — maximum\n' +
            '- `Math.round(n)` — nearest integer',
    },
    {
        label: 'RegExp',
        snippet: 'RegExp("${1:pattern}")',
        description: 'JS global',
        documentation: 'JavaScript RegExp constructor.\n\nExample: `RegExp("^test")`\n\nPrefer regex literals: `/^test/`',
    },
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

/**
 * Creates completion items for JavaScript globals supported by the
 * shell-bson-parser sandbox.
 *
 * These are shown at value position with sort prefix `4_` (after BSON
 * constructors at `3_`).
 *
 * @param range - the insertion range
 * @param monaco - the Monaco API
 */
export function createJsGlobalCompletionItems(
    range: monacoEditor.IRange,
    monaco: typeof monacoEditor,
): monacoEditor.languages.CompletionItem[] {
    return JS_GLOBALS.map((def) => {
        const hasSnippet = !!def.snippet;
        let insertText = hasSnippet ? def.snippet! : def.label;
        if (hasSnippet) {
            insertText = escapeSnippetDollars(insertText);
        }

        return {
            label: {
                label: def.label,
                description: def.description,
            },
            kind: hasSnippet
                ? monaco.languages.CompletionItemKind.Constructor
                : monaco.languages.CompletionItemKind.Constant,
            insertText,
            insertTextRules: hasSnippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
            documentation: { value: def.documentation },
            sortText: `4_${def.label}`,
            range,
        };
    });
}
