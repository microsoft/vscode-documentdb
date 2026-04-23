/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query playground cursor context detection (Stage 1: JS-level).
 *
 * Determines whether the cursor is at the top level, after `db.`, after
 * `db.<collection>.`, in a cursor chain, inside a method argument, or
 * inside a string literal.
 *
 * This module is a pure function with no VS Code dependencies, making it
 * fully unit-testable. The inner query-object context detection (Stage 2)
 * is delegated to `cursorContext.ts` from the webview completions module.
 */

/**
 * The JS-level context of the cursor in a query playground file.
 */
export type PlaygroundContext =
    | { kind: 'top-level' }
    | { kind: 'db-dot'; prefix: string }
    | { kind: 'collection-method'; collectionName: string; prefix: string }
    | { kind: 'find-cursor-chain'; prefix: string }
    | { kind: 'aggregate-cursor-chain'; prefix: string }
    | {
          kind: 'method-argument';
          methodName: string;
          collectionName: string;
          argumentText: string;
          cursorOffset: number;
      }
    | { kind: 'string-literal'; enclosingCall: string }
    | { kind: 'unknown' };

/** Methods that return a FindCursor */
const FIND_CURSOR_METHODS = new Set(['find']);

/** Methods that return an AggregationCursor */
const AGG_CURSOR_METHODS = new Set(['aggregate']);

/** Known database methods */
const DATABASE_METHODS = new Set([
    'getCollection',
    'getCollectionNames',
    'getCollectionInfos',
    'createCollection',
    'dropDatabase',
    'runCommand',
    'adminCommand',
    'aggregate',
    'getSiblingDB',
    'getName',
    'stats',
    'version',
    'createView',
    'listCommands',
]);

/**
 * Detects the JS-level context of the cursor in a query playground file.
 *
 * @param text The full document text
 * @param offset The cursor offset (0-based)
 * @returns The detected context
 */
export function detectPlaygroundContext(text: string, offset: number): PlaygroundContext {
    // Check if we're inside a string literal
    const stringContext = detectStringContext(text, offset);
    if (stringContext) {
        return stringContext;
    }

    // Scan backward to find the nearest `.` and build a member chain
    const chain = scanMemberChain(text, offset);

    if (!chain) {
        return { kind: 'top-level' };
    }

    // Detect: inside a method call argument — e.g., db.users.find({ | })
    // NOTE: This branch is currently unreachable. scanMemberChain() declares
    // insideArgOf but never assigns it. The working path uses
    // detectMethodArgContext() directly in PlaygroundCompletionItemProvider.
    // Cleanup tracked in docs/plan/future-pre-shell.md item 4.
    if (chain.insideArgOf) {
        const argStart = chain.insideArgOf.argStart;
        const argumentText = text.substring(argStart, offset);
        const cursorOffset = offset - argStart;
        return {
            kind: 'method-argument',
            methodName: chain.insideArgOf.methodName,
            collectionName: chain.insideArgOf.collectionName,
            argumentText,
            cursorOffset,
        };
    }

    const prefix = chain.currentPrefix;

    // Detect: db.|
    if (chain.segments.length === 1 && chain.segments[0] === 'db') {
        return { kind: 'db-dot', prefix };
    }

    // Detect: db.users.| or db.getCollection("name").|
    if (chain.segments.length === 2 && chain.segments[0] === 'db') {
        const second = chain.segments[1];

        // db.users.find({}).| — cursor chain after method call
        if (chain.lastCallReturns === 'find-cursor') {
            return { kind: 'find-cursor-chain', prefix };
        }
        if (chain.lastCallReturns === 'aggregate-cursor') {
            return { kind: 'aggregate-cursor-chain', prefix };
        }

        // db.users.| (collection access)
        if (!DATABASE_METHODS.has(second)) {
            return { kind: 'collection-method', collectionName: second, prefix };
        }
    }

    // Detect: db.users.find({}).limit(10).| — extended cursor chain
    if (chain.segments.length >= 2 && chain.segments[0] === 'db') {
        if (chain.lastCallReturns === 'find-cursor') {
            return { kind: 'find-cursor-chain', prefix };
        }
        if (chain.lastCallReturns === 'aggregate-cursor') {
            return { kind: 'aggregate-cursor-chain', prefix };
        }

        // If chained past 2 segments and starts with db, treat as collection method
        if (chain.segments.length === 2 && !DATABASE_METHODS.has(chain.segments[1])) {
            return { kind: 'collection-method', collectionName: chain.segments[1], prefix };
        }
    }

    return { kind: 'unknown' };
}

// ---------------------------------------------------------------------------
// Internal: Member chain scanner
// ---------------------------------------------------------------------------

interface MethodCallInfo {
    methodName: string;
    collectionName: string;
    argStart: number;
}

interface MemberChain {
    /** Segments like ['db', 'users'] for `db.users.` */
    segments: string[];
    /** Text after the last `.` (partial identifier the user is typing) */
    currentPrefix: string;
    /** If cursor is inside a (...) argument, info about the enclosing call */
    insideArgOf?: MethodCallInfo;
    /** What the last method call returns (for cursor chain detection) */
    lastCallReturns?: 'find-cursor' | 'aggregate-cursor';
}

/**
 * Scans backward from the cursor to detect the member access chain.
 * Handles patterns like: `db.users.find({}).limit(10).|`
 */
function scanMemberChain(text: string, offset: number): MemberChain | null {
    let pos = offset - 1;

    // Skip the text after the last dot (the current prefix being typed)
    let currentPrefix = '';
    while (pos >= 0 && isIdentChar(text[pos])) {
        currentPrefix = text[pos] + currentPrefix;
        pos--;
    }

    // If there's no dot before the prefix, we're at top-level
    if (pos < 0 || text[pos] !== '.') {
        return null;
    }

    // We have a dot — now scan backward to build the chain
    const segments: string[] = [];
    let lastCallReturns: 'find-cursor' | 'aggregate-cursor' | undefined;
    let insideArgOf: MethodCallInfo | undefined;

    // Start by going past the dot
    pos--; // skip '.'

    // Walk backward through the chain
    while (pos >= 0) {
        // Skip whitespace
        while (pos >= 0 && isWhitespace(text[pos])) {
            pos--;
        }

        if (pos < 0) break;

        // If we hit a closing paren `)`, it's a method call — skip the entire argument
        if (text[pos] === ')') {
            const parenResult = skipParenthesized(text, pos);
            if (!parenResult) break;
            pos = parenResult.openPos - 1;

            // Now read the method name before the `(`
            let methodName = '';
            while (pos >= 0 && isIdentChar(text[pos])) {
                methodName = text[pos] + methodName;
                pos--;
            }

            if (methodName) {
                segments.unshift(methodName);

                // Track what the method returns for cursor chain detection
                if (FIND_CURSOR_METHODS.has(methodName)) {
                    lastCallReturns = 'find-cursor';
                } else if (AGG_CURSOR_METHODS.has(methodName)) {
                    lastCallReturns = 'aggregate-cursor';
                } else if (lastCallReturns) {
                    // Chained cursor methods (limit, sort, etc.) preserve the cursor type
                    // Only reset if it's a non-cursor method
                    if (!isCursorMethod(methodName)) {
                        lastCallReturns = undefined;
                    }
                }
            }

            // Look for the next dot
            while (pos >= 0 && isWhitespace(text[pos])) {
                pos--;
            }
            if (pos >= 0 && text[pos] === '.') {
                pos--; // skip '.'
                continue;
            }
            break;
        }

        // Read an identifier (property access without call)
        if (isIdentChar(text[pos])) {
            let ident = '';
            while (pos >= 0 && isIdentChar(text[pos])) {
                ident = text[pos] + ident;
                pos--;
            }
            segments.unshift(ident);

            // Look for the next dot
            while (pos >= 0 && isWhitespace(text[pos])) {
                pos--;
            }
            if (pos >= 0 && text[pos] === '.') {
                pos--; // skip '.'
                continue;
            }
            break;
        }

        // Any other character — stop scanning
        break;
    }

    if (segments.length === 0) {
        return null;
    }

    return { segments, currentPrefix, insideArgOf, lastCallReturns };
}

/**
 * Detects if the cursor is inside a method argument: `db.users.find({ | })`
 * This is a simpler check — looks for an unmatched `(` before the cursor.
 */
export function detectMethodArgContext(text: string, offset: number): MethodCallInfo | null {
    let pos = offset - 1;
    let depth = 0;

    // Scan backward looking for unmatched `(`
    while (pos >= 0) {
        const ch = text[pos];

        // Skip string literals
        if (ch === '"' || ch === "'") {
            pos = skipStringBackward(text, pos);
            continue;
        }

        if (ch === ')') depth++;
        else if (ch === '(') {
            if (depth === 0) {
                // Found the unmatched `(` — now read the method name before it
                let methodPos = pos - 1;
                while (methodPos >= 0 && isWhitespace(text[methodPos])) {
                    methodPos--;
                }
                let methodName = '';
                while (methodPos >= 0 && isIdentChar(text[methodPos])) {
                    methodName = text[methodPos] + methodName;
                    methodPos--;
                }

                if (!methodName) return null;

                // Read collection name: look for `.` before the method name
                let collectionName = '';
                while (methodPos >= 0 && isWhitespace(text[methodPos])) {
                    methodPos--;
                }
                if (methodPos >= 0 && text[methodPos] === '.') {
                    methodPos--;
                    while (methodPos >= 0 && isIdentChar(text[methodPos])) {
                        collectionName = text[methodPos] + collectionName;
                        methodPos--;
                    }
                }

                return {
                    methodName,
                    collectionName,
                    argStart: pos + 1,
                };
            }
            depth--;
        }

        pos--;
    }

    return null;
}

// ---------------------------------------------------------------------------
// Internal: String literal detection
// ---------------------------------------------------------------------------

function detectStringContext(text: string, offset: number): PlaygroundContext | null {
    // Count unescaped quotes before cursor, properly handling escaped backslashes.
    // A quote is escaped only when preceded by an odd number of backslashes.
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;

    for (let i = 0; i < offset; i++) {
        const ch = text[i];

        // Count consecutive backslashes preceding this character
        let backslashes = 0;
        let checkPos = i - 1;
        while (checkPos >= 0 && text[checkPos] === '\\') {
            backslashes++;
            checkPos--;
        }

        // If preceded by an odd number of backslashes, this character is escaped
        if (backslashes % 2 !== 0) continue;

        if (ch === "'" && !inDouble && !inTemplate) inSingle = !inSingle;
        else if (ch === '"' && !inSingle && !inTemplate) inDouble = !inDouble;
        else if (ch === '`' && !inSingle && !inDouble) inTemplate = !inTemplate;
    }

    if (inSingle || inDouble) {
        // Find what function call this string is inside of
        const argContext = detectMethodArgContext(text, offset);
        return {
            kind: 'string-literal',
            enclosingCall: argContext?.methodName ?? '',
        };
    }

    return null;
}

// ---------------------------------------------------------------------------
// Internal: Utilities
// ---------------------------------------------------------------------------

function isIdentChar(ch: string): boolean {
    return /[a-zA-Z0-9_$]/.test(ch);
}

function isWhitespace(ch: string): boolean {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function isCursorMethod(name: string): boolean {
    const cursorMethods = new Set([
        'limit',
        'skip',
        'sort',
        'toArray',
        'forEach',
        'map',
        'count',
        'explain',
        'hasNext',
        'next',
        'batchSize',
        'close',
        'collation',
        'hint',
        'comment',
        'maxTimeMS',
        'readConcern',
        'readPref',
        'returnKey',
        'showRecordId',
    ]);
    return cursorMethods.has(name);
}

/**
 * Skip backward over a parenthesized expression, handling nested parens.
 * @param text The source text
 * @param closePos Position of the closing `)`
 * @returns The position of the matching `(`, or null if not found
 */
function skipParenthesized(text: string, closePos: number): { openPos: number } | null {
    let pos = closePos - 1;
    let depth = 1;

    while (pos >= 0 && depth > 0) {
        const ch = text[pos];

        // Skip string literals
        if (ch === '"' || ch === "'") {
            pos = skipStringBackward(text, pos);
            continue;
        }

        if (ch === ')') depth++;
        else if (ch === '(') depth--;
        pos--;
    }

    if (depth !== 0) return null;
    return { openPos: pos + 1 };
}

/**
 * Skip backward over a string literal (handles escaped quotes).
 */
function skipStringBackward(text: string, quotePos: number): number {
    const quote = text[quotePos];
    let pos = quotePos - 1;

    while (pos >= 0) {
        if (text[pos] === quote) {
            // Check for escaping
            let backslashes = 0;
            let checkPos = pos - 1;
            while (checkPos >= 0 && text[checkPos] === '\\') {
                backslashes++;
                checkPos--;
            }
            if (backslashes % 2 === 0) {
                // Not escaped — this is the opening quote
                return pos - 1;
            }
        }
        pos--;
    }

    return -1;
}
