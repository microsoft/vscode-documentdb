/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Determines whether the given text represents an incomplete expression by
 * tracking bracket depth, string literals, and comment blocks.
 *
 * Used by the interactive shell to decide whether pressing Enter should
 * execute the input or show a continuation prompt for multi-line input.
 *
 * Brackets inside strings and comments are ignored. When the depth goes
 * negative (extra closing brackets), the expression is considered complete
 * and the evaluator will surface the syntax error.
 *
 * @returns `true` if the expression has unclosed brackets, an unterminated
 *          string literal, or an unterminated block comment.
 */
export function isExpressionIncomplete(text: string): boolean {
    let depth = 0;

    // String state
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inTemplateLiteral = false;

    // Template expression nesting: each entry is the bracket depth at which
    // a `${` was entered. When `}` is encountered at that depth, we return
    // to the enclosing template literal instead of decrementing depth.
    const templateExprStack: number[] = [];

    // Comment state
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = i + 1 < text.length ? text[i + 1] : '';

        // ─── Line comment ────────────────────────────────────────────
        if (inLineComment) {
            if (ch === '\n') {
                inLineComment = false;
            }
            continue;
        }

        // ─── Block comment ───────────────────────────────────────────
        if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i++; // skip '/'
            }
            continue;
        }

        // ─── Single-quoted string ────────────────────────────────────
        if (inSingleQuote) {
            if (ch === '\\') {
                i++; // skip escaped character
            } else if (ch === "'") {
                inSingleQuote = false;
            }
            continue;
        }

        // ─── Double-quoted string ────────────────────────────────────
        if (inDoubleQuote) {
            if (ch === '\\') {
                i++; // skip escaped character
            } else if (ch === '"') {
                inDoubleQuote = false;
            }
            continue;
        }

        // ─── Template literal ────────────────────────────────────────
        if (inTemplateLiteral) {
            if (ch === '\\') {
                i++; // skip escaped character
            } else if (ch === '$' && next === '{') {
                // Enter template expression — brackets inside are real code
                templateExprStack.push(depth);
                inTemplateLiteral = false;
                i++; // skip '{'
            } else if (ch === '`') {
                inTemplateLiteral = false;
            }
            continue;
        }

        // ─── Normal code ─────────────────────────────────────────────

        // Detect comment starts
        if (ch === '/' && next === '/') {
            inLineComment = true;
            i++; // skip second '/'
            continue;
        }
        if (ch === '/' && next === '*') {
            inBlockComment = true;
            i++; // skip '*'
            continue;
        }

        // Detect string starts
        if (ch === "'") {
            inSingleQuote = true;
            continue;
        }
        if (ch === '"') {
            inDoubleQuote = true;
            continue;
        }
        if (ch === '`') {
            inTemplateLiteral = true;
            continue;
        }

        // Track bracket depth
        if (ch === '(' || ch === '[' || ch === '{') {
            depth++;
        } else if (ch === ')' || ch === ']' || ch === '}') {
            // Check if this closing brace returns us to a template literal
            if (
                ch === '}' &&
                templateExprStack.length > 0 &&
                depth === templateExprStack[templateExprStack.length - 1]
            ) {
                templateExprStack.pop();
                inTemplateLiteral = true;
            } else {
                depth--;
            }
        }
    }

    return depth > 0 || inSingleQuote || inDoubleQuote || inTemplateLiteral || inBlockComment;
}

/**
 * The closing bracket characters needed to balance the given expression.
 *
 * Uses a stack to track each opening bracket type (`(`, `[`, `{`) so the
 * returned string contains the matching closers in the correct order.
 * Brackets inside strings and comments are ignored, just like
 * {@link isExpressionIncomplete}.
 *
 * @returns The closing characters (e.g. `}})` ), or an empty string when
 *          the expression is already balanced or has no unclosed brackets.
 */
export function getClosingBrackets(text: string): string {
    const stack: string[] = [];

    const CLOSING: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

    // String state
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inTemplateLiteral = false;

    // Template expression nesting: each entry is the stack length at which
    // a `${` was entered. When `}` is encountered at that depth, we return
    // to the enclosing template literal instead of popping the stack.
    const templateExprStack: number[] = [];

    // Comment state
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = i + 1 < text.length ? text[i + 1] : '';

        // ─── Line comment ────────────────────────────────────────────
        if (inLineComment) {
            if (ch === '\n') {
                inLineComment = false;
            }
            continue;
        }

        // ─── Block comment ───────────────────────────────────────────
        if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i++; // skip '/'
            }
            continue;
        }

        // ─── Single-quoted string ────────────────────────────────────
        if (inSingleQuote) {
            if (ch === '\\') {
                i++; // skip escaped character
            } else if (ch === "'") {
                inSingleQuote = false;
            }
            continue;
        }

        // ─── Double-quoted string ────────────────────────────────────
        if (inDoubleQuote) {
            if (ch === '\\') {
                i++; // skip escaped character
            } else if (ch === '"') {
                inDoubleQuote = false;
            }
            continue;
        }

        // ─── Template literal ────────────────────────────────────────
        if (inTemplateLiteral) {
            if (ch === '\\') {
                i++; // skip escaped character
            } else if (ch === '$' && next === '{') {
                // Enter template expression — brackets inside are real code
                templateExprStack.push(stack.length);
                inTemplateLiteral = false;
                i++; // skip '{'
            } else if (ch === '`') {
                inTemplateLiteral = false;
            }
            continue;
        }

        // ─── Normal code ─────────────────────────────────────────────

        // Detect comment starts
        if (ch === '/' && next === '/') {
            inLineComment = true;
            i++; // skip second '/'
            continue;
        }
        if (ch === '/' && next === '*') {
            inBlockComment = true;
            i++; // skip '*'
            continue;
        }

        // Detect string starts
        if (ch === "'") {
            inSingleQuote = true;
            continue;
        }
        if (ch === '"') {
            inDoubleQuote = true;
            continue;
        }
        if (ch === '`') {
            inTemplateLiteral = true;
            continue;
        }

        // Track bracket stack
        if (ch === '(' || ch === '[' || ch === '{') {
            stack.push(ch);
        } else if (ch === ')' || ch === ']' || ch === '}') {
            // Check if this closing brace returns us to a template literal
            if (
                ch === '}' &&
                templateExprStack.length > 0 &&
                stack.length === templateExprStack[templateExprStack.length - 1]
            ) {
                templateExprStack.pop();
                inTemplateLiteral = true;
            } else if (stack.length > 0) {
                stack.pop();
            }
        }
    }

    // Build closing sequence in reverse order (innermost bracket closes first)
    return stack
        .reverse()
        .map((ch) => CLOSING[ch] ?? '')
        .join('');
}
