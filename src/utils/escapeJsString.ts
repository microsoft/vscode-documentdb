/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Escape a string for safe interpolation inside a single-quoted JavaScript string literal.
 *
 * Handles backslashes and single quotes so that names like `it's a test`
 * or `path\to\coll` produce valid JS when embedded in `'…'`.
 */
export function escapeJsString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
