/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cursor context detection for the `documentdb-query` language.
 *
 * Determines the semantic position of the cursor within a DocumentDB query
 * expression (e.g., key position, value position, operator position) using
 * a heuristic character-scanning approach.
 *
 * This module is a pure function with no Monaco or VS Code dependencies,
 * making it fully unit-testable.
 */

/**
 * The semantic position of the cursor within a query expression.
 *
 * Used by the completion provider to determine which completions to show.
 */
export type CursorContext =
    | { position: 'key'; depth: number }
    | { position: 'value'; fieldName: string; fieldBsonType?: string }
    | { position: 'operator'; fieldName: string; fieldBsonType?: string }
    | { position: 'array-element'; parentOperator: string }
    | { position: 'unknown' };

/**
 * A callback that resolves a field name to its BSON type string.
 * Used to enrich cursor context with type information from the completion store.
 */
export type FieldTypeLookup = (fieldName: string) => string | undefined;

/**
 * Detects the semantic cursor context within a DocumentDB query expression.
 *
 * Uses a heuristic backward-scanning approach from the cursor position to
 * determine whether the cursor is at a key, value, operator, or array-element
 * position. Falls back to `{ position: 'unknown' }` when context cannot be
 * determined.
 *
 * @param text - the full text of the editor
 * @param cursorOffset - the 0-based character offset of the cursor
 * @param fieldLookup - optional callback to resolve field names to BSON types
 * @returns the detected cursor context
 */
export function detectCursorContext(
    text: string,
    cursorOffset: number,
    fieldLookup?: FieldTypeLookup,
): CursorContext {
    if (!text || cursorOffset <= 0) {
        return { position: 'unknown' };
    }

    // Clamp cursor to text length
    const offset = Math.min(cursorOffset, text.length);

    // Find the nearest structural character before the cursor
    const scanResult = scanBackward(text, offset);

    if (!scanResult) {
        return { position: 'unknown' };
    }

    switch (scanResult.char) {
        case ':':
            return resolveValueContext(text, scanResult.index, fieldLookup);

        case '{':
            return resolveOpenBraceContext(text, scanResult.index, fieldLookup);

        case ',':
            return resolveCommaContext(text, scanResult.index, fieldLookup);

        case '[':
            return resolveOpenBracketContext(text, scanResult.index);

        default:
            return { position: 'unknown' };
    }
}

// ---------- Internal helpers ----------

/** Structural characters that define context boundaries. */
const STRUCTURAL_CHARS = new Set([':', '{', ',', '[']);

interface ScanResult {
    char: string;
    index: number;
}

/**
 * Scans backward from the cursor, skipping whitespace and identifier characters
 * (letters, digits, `_`, `$`, `.`, quotes), to find the nearest structural character.
 *
 * Identifier characters are skipped because the cursor may be mid-word
 * (e.g., `{ ag|` — cursor is after 'g', but context is 'key' from the `{`).
 */
function scanBackward(text: string, offset: number): ScanResult | undefined {
    let i = offset - 1;
    while (i >= 0) {
        const ch = text[i];
        if (STRUCTURAL_CHARS.has(ch)) {
            return { char: ch, index: i };
        }
        // Skip whitespace and identifier-like characters
        if (isSkippable(ch)) {
            i--;
            continue;
        }
        // Hit something unexpected (e.g., '}', ']', ')') — stop scanning
        // '}' and ']' indicate we've exited the current expression
        return undefined;
    }
    return undefined;
}

/**
 * Characters to skip during backward scanning.
 * These are characters that can appear between a structural char and the cursor:
 * - whitespace
 * - identifier chars (a-z, A-Z, 0-9, _, $, .)
 * - quote marks (the user may be inside a quoted key)
 * - minus sign (for negative numbers)
 */
function isSkippable(ch: string): boolean {
    return /[\s\w.$"'`\-/]/.test(ch);
}

/**
 * Resolves context when ':' is found — cursor is in a value position.
 *
 * Examples:
 * - `{ _id: | }` → value with fieldName '_id'
 * - `{ age: | }` → value with fieldName 'age'
 */
function resolveValueContext(
    text: string,
    colonIndex: number,
    fieldLookup?: FieldTypeLookup,
): CursorContext {
    const fieldName = extractKeyBeforeColon(text, colonIndex);
    if (!fieldName) {
        return { position: 'unknown' };
    }
    const fieldBsonType = fieldLookup?.(fieldName);
    return {
        position: 'value',
        fieldName,
        ...(fieldBsonType !== undefined && { fieldBsonType }),
    };
}

/**
 * Resolves context when '{' is found.
 *
 * Two sub-cases:
 * 1. Root or top-level: `{ | }` → key position
 * 2. After a colon: `{ age: { | } }` → operator position for field 'age'
 */
function resolveOpenBraceContext(
    text: string,
    braceIndex: number,
    fieldLookup?: FieldTypeLookup,
): CursorContext {
    // Look backward from the '{' to find what precedes it
    const beforeBrace = scanBackwardFrom(text, braceIndex);

    if (beforeBrace && beforeBrace.char === ':') {
        // Pattern: `fieldName: { | }` → operator position
        const fieldName = extractKeyBeforeColon(text, beforeBrace.index);
        if (fieldName) {
            // If the field name starts with '$', this is a nested query object
            // inside a logical operator like $and: [ { | } ], but the immediate
            // '{' is after a ':' which makes it an operator context
            const fieldBsonType = fieldLookup?.(fieldName);
            return {
                position: 'operator',
                fieldName,
                ...(fieldBsonType !== undefined && { fieldBsonType }),
            };
        }
    }

    if (beforeBrace && beforeBrace.char === '[') {
        // Pattern: `$and: [ { | } ]` → key at depth 1
        return resolveKeyInsideArray(text, beforeBrace.index);
    }

    if (beforeBrace && beforeBrace.char === ',') {
        // Pattern: `$and: [ {...}, { | } ]` — inside an array after another element
        return resolveCommaInsideArrayForBrace(text, beforeBrace.index);
    }

    // Root object or can't determine parent
    // +1 because the brace at braceIndex is the one we're inside
    const depth = computeDepth(text, braceIndex) + 1;
    return { position: 'key', depth };
}

/**
 * Resolves context when ',' is found.
 *
 * Sub-cases:
 * 1. Inside an object: `{ name: "x", | }` → key position
 * 2. Inside an operator object: `{ age: { $gt: 5, | } }` → operator position
 * 3. Inside an array: `{ $and: [ {...}, | ] }` → array-element position
 */
function resolveCommaContext(
    text: string,
    commaIndex: number,
    fieldLookup?: FieldTypeLookup,
): CursorContext {
    // Determine if comma is inside an array or an object by finding the
    // nearest unmatched '[' or '{'
    const enclosing = findEnclosingBracket(text, commaIndex);

    if (!enclosing) {
        return { position: 'unknown' };
    }

    if (enclosing.char === '[') {
        // Inside an array — determine parent operator
        return resolveOpenBracketContext(text, enclosing.index);
    }

    if (enclosing.char === '{') {
        // Inside an object — is this a root-level object or a nested operator object?
        return resolveOpenBraceContext(text, enclosing.index, fieldLookup);
    }

    return { position: 'unknown' };
}

/**
 * Resolves context when '[' is found.
 *
 * Example: `{ $and: [ | ] }` → array-element with parentOperator '$and'
 */
function resolveOpenBracketContext(
    text: string,
    bracketIndex: number,
): CursorContext {
    // Look backward from '[' to find the parent key via ':'
    const beforeBracket = scanBackwardFrom(text, bracketIndex);

    if (beforeBracket && beforeBracket.char === ':') {
        const parentKey = extractKeyBeforeColon(text, beforeBracket.index);
        if (parentKey && parentKey.startsWith('$')) {
            return { position: 'array-element', parentOperator: parentKey };
        }
    }

    return { position: 'unknown' };
}

/**
 * Resolves key context when '{' is found immediately after '['.
 * Pattern: `$and: [ { | } ]` → key at depth 1
 */
function resolveKeyInsideArray(
    text: string,
    bracketIndex: number,
): CursorContext {
    // Check if this array belongs to a logical operator
    const beforeBracket = scanBackwardFrom(text, bracketIndex);
    if (beforeBracket && beforeBracket.char === ':') {
        const parentKey = extractKeyBeforeColon(text, beforeBracket.index);
        if (parentKey && parentKey.startsWith('$')) {
            // Inside a logical operator array element — treat as key context
            const depth = computeDepth(text, bracketIndex);
            return { position: 'key', depth: depth + 1 };
        }
    }
    const depth = computeDepth(text, bracketIndex);
    return { position: 'key', depth: depth + 1 };
}

/**
 * Resolves context when '{' is preceded by ',' inside an array.
 * Pattern: `$and: [ {...}, { | } ]`
 */
function resolveCommaInsideArrayForBrace(
    text: string,
    commaIndex: number,
): CursorContext {
    const enclosing = findEnclosingBracket(text, commaIndex);
    if (enclosing && enclosing.char === '[') {
        return resolveKeyInsideArray(text, enclosing.index);
    }
    return { position: 'key', depth: 0 };
}

// ---------- Character scanning utilities ----------

/**
 * Scans backward from a given index (exclusive), skipping whitespace
 * and identifier characters, to find the nearest structural character.
 */
function scanBackwardFrom(text: string, index: number): ScanResult | undefined {
    let i = index - 1;
    while (i >= 0) {
        const ch = text[i];
        if (STRUCTURAL_CHARS.has(ch) || ch === ']' || ch === '}') {
            if (ch === ']' || ch === '}') {
                return undefined; // Hit a closing bracket — stop
            }
            return { char: ch, index: i };
        }
        if (isSkippable(ch)) {
            i--;
            continue;
        }
        return undefined;
    }
    return undefined;
}

/**
 * Finds the nearest unmatched opening bracket (`{` or `[`) before the given index.
 * Properly handles nested brackets by maintaining a balance counter.
 */
function findEnclosingBracket(text: string, index: number): ScanResult | undefined {
    let braceDepth = 0;
    let bracketDepth = 0;

    for (let i = index - 1; i >= 0; i--) {
        const ch = text[i];
        switch (ch) {
            case '}':
                braceDepth++;
                break;
            case '{':
                if (braceDepth > 0) {
                    braceDepth--;
                } else {
                    return { char: '{', index: i };
                }
                break;
            case ']':
                bracketDepth++;
                break;
            case '[':
                if (bracketDepth > 0) {
                    bracketDepth--;
                } else {
                    return { char: '[', index: i };
                }
                break;
        }
    }
    return undefined;
}

/**
 * Extracts the key name immediately before a colon.
 *
 * Handles:
 * - Unquoted keys: `age:` → 'age'
 * - Single-quoted keys: `'my.field':` → 'my.field'
 * - Double-quoted keys: `"my.field":` → 'my.field'
 * - Dollar-prefixed: `$and:` → '$and'
 */
function extractKeyBeforeColon(text: string, colonIndex: number): string | undefined {
    let i = colonIndex - 1;

    // Skip whitespace before the colon
    while (i >= 0 && /\s/.test(text[i])) {
        i--;
    }

    if (i < 0) return undefined;

    // Check if the key is quoted
    const quoteChar = text[i];
    if (quoteChar === '"' || quoteChar === "'") {
        // Find the matching opening quote
        const closeQuoteIndex = i;
        i--;
        while (i >= 0 && text[i] !== quoteChar) {
            i--;
        }
        if (i < 0) return undefined; // Unmatched quote
        return text.substring(i + 1, closeQuoteIndex);
    }

    // Unquoted key — collect identifier characters (including $ and .)
    const end = i + 1;
    while (i >= 0 && /[\w$.]/.test(text[i])) {
        i--;
    }
    const key = text.substring(i + 1, end);
    return key.length > 0 ? key : undefined;
}

/**
 * Computes the brace nesting depth at a given position.
 * Counts unmatched `{` before the index.
 */
function computeDepth(text: string, index: number): number {
    let depth = 0;
    for (let i = 0; i < index; i++) {
        if (text[i] === '{') depth++;
        if (text[i] === '}') depth--;
    }
    return Math.max(0, depth);
}
