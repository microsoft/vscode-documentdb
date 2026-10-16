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

import { shellAnsi, shellStyles } from '../shellStyles';
import { type TokenSpan } from './monarchRunner';

// ─── ANSI escape codes ──────────────────────────────────────────────────────

/** Map from token type prefix to ANSI color code. */
const TOKEN_COLORS: Record<string, string> = {
    keyword: shellStyles.syntax.keyword,
    'keyword.other': shellStyles.syntax.keyword,
    string: shellStyles.syntax.string,
    'string.escape': shellStyles.syntax.escape,
    'string.escape.invalid': shellStyles.syntax.invalid,
    'string.invalid': shellStyles.syntax.invalid,
    number: shellStyles.syntax.number,
    'number.float': shellStyles.syntax.number,
    'number.hex': shellStyles.syntax.number,
    'number.octal': shellStyles.syntax.number,
    'number.binary': shellStyles.syntax.number,
    comment: shellStyles.syntax.comment,
    'comment.doc': shellStyles.syntax.comment,
    regexp: shellStyles.syntax.regexp,
    'regexp.escape': shellStyles.syntax.regexp,
    'regexp.escape.control': shellStyles.syntax.regexp,
    'regexp.invalid': shellStyles.syntax.invalid,
    'bson.constructor': shellStyles.syntax.constructor,
    'documentdb.operator': shellStyles.syntax.operator,
    'shell.command': shellStyles.syntax.command,
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
            result += color + text + shellAnsi.reset;
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
