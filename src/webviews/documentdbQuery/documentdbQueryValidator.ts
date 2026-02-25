/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Validator for `documentdb-query` editor content.
 *
 * Uses `acorn` to parse the expression and `acorn-walk` to traverse the AST.
 * Produces diagnostics for:
 * - Syntax errors (severity: error)
 * - Near-miss BSON constructor typos (severity: warning)
 *
 * This module is pure and testable — it does not depend on Monaco.
 * The mapping from Diagnostic[] to Monaco markers happens in the editor mount handler.
 */

import { getAllCompletions } from '@vscode-documentdb/documentdb-constants';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

/**
 * A diagnostic produced by the validator.
 * Offsets are 0-based character positions in the original (unwrapped) input.
 */
export interface Diagnostic {
    /** 0-based start character offset in the original input */
    startOffset: number;
    /** 0-based end character offset in the original input */
    endOffset: number;
    severity: 'error' | 'warning' | 'info';
    message: string;
}

/**
 * Known identifiers that should NOT be flagged as typos.
 * These are globals available in shell-bson-parser's sandbox.
 */
const KNOWN_GLOBALS = new Set([
    // BSON constructors (populated dynamically below)
    // JS globals available in the sandbox
    'Math',
    'Date',
    'ISODate',
    'RegExp',
    'Infinity',
    'NaN',
    'undefined',
    'true',
    'false',
    'null',
    'Map',
    'Symbol',
    // Common JS builtins that might appear in expressions
    'Number',
    'String',
    'Boolean',
    'Array',
    'Object',
    'parseInt',
    'parseFloat',
    'isNaN',
    'isFinite',
]);

// Add all BSON constructors from documentdb-constants
let bsonConstructorsLoaded = false;

function ensureBsonConstructors(): void {
    if (bsonConstructorsLoaded) return;
    bsonConstructorsLoaded = true;

    const allEntries = getAllCompletions();
    for (const entry of allEntries) {
        if (entry.meta === 'bson') {
            KNOWN_GLOBALS.add(entry.value);
        }
    }
}

/**
 * Computes the Levenshtein edit distance between two strings.
 * Used for near-miss detection of BSON constructor typos.
 */
export function levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;

    if (m === 0) return n;
    if (n === 0) return m;

    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
    }

    return dp[m][n];
}

/**
 * Finds the closest BSON constructor name to a given identifier.
 * Returns the match and distance if within threshold, otherwise undefined.
 */
function findNearMissBsonConstructor(name: string): { match: string; distance: number } | undefined {
    ensureBsonConstructors();

    const allEntries = getAllCompletions();
    let bestMatch: string | undefined;
    let bestDistance = Infinity;

    for (const entry of allEntries) {
        if (entry.meta === 'bson') {
            const dist = levenshteinDistance(name.toLowerCase(), entry.value.toLowerCase());
            if (dist <= 2 && dist < bestDistance) {
                bestDistance = dist;
                bestMatch = entry.value;
            }
        }
    }

    if (bestMatch !== undefined && bestDistance <= 2) {
        return { match: bestMatch, distance: bestDistance };
    }

    return undefined;
}

/**
 * Validates a documentdb-query expression and returns diagnostics.
 *
 * @param code - The expression text from the editor (e.g., `{ age: { $gt: 25 } }`)
 * @returns Array of diagnostics (empty if the expression is valid)
 */
export function validateExpression(code: string): Diagnostic[] {
    ensureBsonConstructors();

    const trimmed = code.trim();
    if (trimmed.length === 0) {
        return [];
    }

    const diagnostics: Diagnostic[] = [];

    // Wrap in parentheses for acorn to parse as expression
    // The offset adjustment accounts for the added '(' character
    const wrapped = `(${code})`;

    let ast: acorn.Node;
    try {
        ast = acorn.parseExpressionAt(wrapped, 0, {
            ecmaVersion: 'latest',
            sourceType: 'module',
        });
    } catch (error) {
        if (error instanceof SyntaxError) {
            const syntaxError = error as SyntaxError & { pos?: number; loc?: { line: number; column: number } };
            // Adjust offset for the wrapping parenthesis
            const pos = syntaxError.pos !== undefined ? syntaxError.pos - 1 : 0;
            const startOffset = Math.max(0, Math.min(pos, code.length));
            const endOffset = Math.min(startOffset + 1, code.length);

            diagnostics.push({
                startOffset,
                endOffset,
                severity: 'error',
                message: syntaxError.message.replace(/\(\d+:\d+\)/, '').trim(),
            });
        }
        return diagnostics;
    }

    // Walk the AST to check identifiers
    try {
        walk.simple(ast, {
            Identifier(node: acorn.Node & { name: string }) {
                const name = node.name;

                // Skip known globals and common identifiers
                if (KNOWN_GLOBALS.has(name)) {
                    return;
                }

                // Don't flag field names — only flag function call identifiers
                // that look like BSON constructor typos
            },
            CallExpression(node: acorn.Node & { callee: acorn.Node & { name?: string; type: string } }) {
                if (node.callee.type === 'Identifier' && node.callee.name) {
                    const name = node.callee.name;

                    // If it's a known global, skip
                    if (KNOWN_GLOBALS.has(name)) {
                        return;
                    }

                    // Check if it's a near-miss of a BSON constructor
                    const nearMiss = findNearMissBsonConstructor(name);
                    if (nearMiss) {
                        // Adjust offset for wrapping parenthesis
                        const startOffset = node.callee.start - 1;
                        const endOffset = node.callee.end - 1;

                        diagnostics.push({
                            startOffset,
                            endOffset,
                            severity: 'warning',
                            message: `Did you mean '${nearMiss.match}'?`,
                        });
                    }
                }
            },
        });
    } catch {
        // If walking fails, just return syntax diagnostics we already have
    }

    return diagnostics;
}
