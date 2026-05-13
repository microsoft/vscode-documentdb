/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Utility functions for manipulating Monaco snippet text.
 */

/**
 * Strips the outermost `{ ` and ` }` from an operator snippet.
 *
 * Operator snippets in operator-registry are designed for value position
 * (e.g., `{ $gt: ${1:value} }`). At operator position, the user is already
 * inside braces, so the outer wrapping must be removed to avoid double-nesting.
 *
 * Only strips if the snippet starts with `'{ '` and ends with `' }'`.
 * Inner brackets/braces are preserved:
 * - `{ $in: [${1:value}] }` → `$in: [${1:value}]`
 * - `{ $gt: ${1:value} }` → `$gt: ${1:value}`
 */
export function stripOuterBraces(snippet: string): string {
    if (snippet.startsWith('{ ') && snippet.endsWith(' }')) {
        return snippet.slice(2, -2);
    }
    return snippet;
}

/**
 * Escapes literal `$` signs in snippet text that would be misinterpreted
 * as Monaco snippet variables.
 *
 * In Monaco snippet syntax, `$name` is a variable reference (resolves to empty
 * for unknown variables). Operator names like `$gt` in snippets get consumed
 * as variable references, producing empty output instead of the literal `$gt`.
 *
 * This function escapes `$` when followed by a letter (`$gt` → `\$gt`)
 * while preserving tab stop syntax (`${1:value}` and `$1` are unchanged).
 */
export function escapeSnippetDollars(snippet: string): string {
    return snippet.replace(/\$(?=[a-zA-Z])/g, '\\$');
}
