/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Converts Monarch token spans to an ANSI-colorized string for terminal display.
 *
 * The color palette matches the conventions established by {@link ShellOutputFormatter}
 * so that input and output highlighting are visually consistent.
 */

import { type TokenSpan } from './monarchRunner';

// ─── ANSI escape codes ──────────────────────────────────────────────────────

const RESET = '\x1b[0m';

/** Map from token type prefix to ANSI color code. */
const TOKEN_COLORS: Record<string, string> = {
    keyword: '\x1b[36m', // Cyan — JS keywords
    'keyword.other': '\x1b[36m', // Cyan — regex flags (i, g, m, etc.)
    string: '\x1b[32m', // Green — matches output formatter
    'string.escape': '\x1b[33m', // Yellow — escape sequences stand out
    'string.escape.invalid': '\x1b[31m', // Red — invalid escapes
    'string.invalid': '\x1b[31m', // Red — unterminated strings
    number: '\x1b[33m', // Yellow — matches output formatter
    'number.float': '\x1b[33m', // Yellow
    'number.hex': '\x1b[33m', // Yellow
    'number.octal': '\x1b[33m', // Yellow
    'number.binary': '\x1b[33m', // Yellow
    comment: '\x1b[90m', // Gray — subdued
    'comment.doc': '\x1b[90m', // Gray — subdued
    regexp: '\x1b[31m', // Red — distinct from strings
    'regexp.escape': '\x1b[31m', // Red
    'regexp.escape.control': '\x1b[31m', // Red
    'regexp.invalid': '\x1b[31m', // Red
    'bson.constructor': '\x1b[36m', // Cyan — built-in constructors
    'documentdb.operator': '\x1b[33m', // Yellow — stand out in query objects
    'shell.command': '\x1b[35m', // Magenta — visually distinct from JS keywords
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Convert token spans and the original input into an ANSI-colorized string.
 *
 * @param input  - The original input string.
 * @param tokens - Token spans from {@link tokenize}.
 * @returns The input string with ANSI color codes inserted.
 */
export function colorizeInput(input: string, tokens: TokenSpan[]): string {
    if (input.length === 0 || tokens.length === 0) {
        return input;
    }

    let result = '';
    let pos = 0;

    for (const token of tokens) {
        // Emit any gap before this token (shouldn't happen, but guard defensively)
        if (token.start > pos) {
            result += input.slice(pos, token.start);
        }

        const text = input.slice(token.start, token.end);
        const color = getTokenColor(token.type);

        if (color) {
            result += color + text + RESET;
        } else {
            result += text;
        }

        pos = token.end;
    }

    // Emit any trailing text after the last token
    if (pos < input.length) {
        result += input.slice(pos);
    }

    return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Look up the ANSI color code for a token type.
 * Returns undefined if the token type should not be colorized.
 */
function getTokenColor(tokenType: string): string | undefined {
    return TOKEN_COLORS[tokenType];
}
