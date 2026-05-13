/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Extracts a quoted key string if the cursor is inside one.
 *
 * For `{ "address.street": 1 }`, when the cursor is anywhere between the
 * opening and closing quotes, returns the unquoted key `"address.street"`
 * along with the 0-based start/end positions of the full quoted string
 * (including the quotes themselves, for hover range highlighting).
 *
 * Returns null if the cursor is not inside a quoted string.
 *
 * @param line - the full line content
 * @param col0 - 0-based column position of the cursor
 */
export function extractQuotedKey(line: string, col0: number): { key: string; start: number; end: number } | null {
    if (col0 < 0 || col0 >= line.length) return null;

    // If cursor is on a quote, it could be the closing quote.
    // Try treating the current position as the closing quote first.
    const chAtCursor = line[col0];
    if (chAtCursor === '"' || chAtCursor === "'") {
        // Not escaped?
        if (col0 === 0 || line[col0 - 1] !== '\\') {
            // Try to find a matching opening quote before this one
            const result = tryMatchAsClosingQuote(line, col0, chAtCursor);
            if (result) return result;
        }
    }

    // Scan backward to find the opening quote
    let openQuoteIdx = -1;
    let quoteChar: string | undefined;

    for (let i = col0; i >= 0; i--) {
        const ch = line[i];
        if (ch === '"' || ch === "'") {
            if (i > 0 && line[i - 1] === '\\') continue;
            openQuoteIdx = i;
            quoteChar = ch;
            break;
        }
        if (ch === '{' || ch === '}' || ch === ':' || ch === ',') {
            return null;
        }
    }

    if (openQuoteIdx < 0 || !quoteChar) return null;

    // Scan forward to find the closing quote
    let closeQuoteIdx = -1;
    for (let i = openQuoteIdx + 1; i < line.length; i++) {
        if (line[i] === '\\') {
            i++;
            continue;
        }
        if (line[i] === quoteChar) {
            closeQuoteIdx = i;
            break;
        }
    }

    if (closeQuoteIdx < 0) return null;
    if (col0 < openQuoteIdx || col0 > closeQuoteIdx) return null;

    const key = line.substring(openQuoteIdx + 1, closeQuoteIdx);
    return { key, start: openQuoteIdx, end: closeQuoteIdx + 1 };
}

function tryMatchAsClosingQuote(
    line: string,
    closeIdx: number,
    quoteChar: string,
): { key: string; start: number; end: number } | null {
    // Scan backward from before the closing quote to find the opening quote
    for (let i = closeIdx - 1; i >= 0; i--) {
        if (line[i] === '\\') continue;
        if (line[i] === quoteChar) {
            if (i > 0 && line[i - 1] === '\\') continue;
            const key = line.substring(i + 1, closeIdx);
            return { key, start: i, end: closeIdx + 1 };
        }
        // Stop at structural chars
        if (line[i] === '{' || line[i] === '}' || line[i] === ':' || line[i] === ',') {
            return null;
        }
    }
    return null;
}
