/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Parsed components of a `db.getCollection('name').find(filter, project).sort(sort)` expression.
 */
export interface ParsedFindExpression {
    readonly collectionName?: string;
    readonly filter?: string;
    readonly project?: string;
    readonly sort?: string;
    readonly skip?: number;
    readonly limit?: number;
}

/**
 * Parse a find() expression string to extract filter, project, and sort arguments.
 *
 * Handles common patterns:
 * - `db.getCollection('name').find({ filter })`
 * - `db.getCollection('name').find({ filter }, { project })`
 * - `db.getCollection('name').find({ filter }).sort({ sort })`
 * - `db.name.find({ filter })`
 *
 * Uses bracket-matching rather than a full JS parser, which covers 95%+ of
 * real user queries. Gracefully returns partial results when parsing fails.
 */
export function parseFindExpression(code: string): ParsedFindExpression {
    const result: ParsedFindExpression = {};

    // Extract collection name
    const getCollectionMatch = /db\.getCollection\(\s*['"]([^'"]+)['"]\s*\)/.exec(code);
    if (getCollectionMatch) {
        (result as { collectionName: string }).collectionName = getCollectionMatch[1];
    } else {
        const directMatch = /db\.([a-zA-Z_$][a-zA-Z0-9_$]*)\./.exec(code);
        if (directMatch && directMatch[1] !== 'getCollection') {
            (result as { collectionName: string }).collectionName = directMatch[1];
        }
    }

    // Find the .find( call and extract arguments
    const findIndex = code.indexOf('.find(');
    if (findIndex === -1) {
        return result;
    }

    const argsStart = findIndex + '.find('.length;
    const args = extractBalancedArgs(code, argsStart);

    if (args.length >= 1 && args[0].trim()) {
        (result as { filter: string }).filter = args[0].trim();
    }
    if (args.length >= 2 && args[1].trim()) {
        (result as { project: string }).project = args[1].trim();
    }

    // Look for .sort( after the find() call
    const findEnd = findClosingParen(code, argsStart - 1);
    if (findEnd !== -1) {
        const afterFind = code.substring(findEnd + 1);
        const sortIndex = afterFind.indexOf('.sort(');
        if (sortIndex !== -1) {
            const sortArgsStart = sortIndex + '.sort('.length;
            const sortArgs = extractBalancedArgs(afterFind, sortArgsStart);
            if (sortArgs.length >= 1 && sortArgs[0].trim()) {
                (result as { sort: string }).sort = sortArgs[0].trim();
            }
        }

        // Look for .skip(N) and .limit(N) — simple numeric arguments
        const skipMatch = /\.skip\(\s*(\d+)\s*\)/.exec(afterFind);
        if (skipMatch) {
            (result as { skip: number }).skip = parseInt(skipMatch[1], 10);
        }

        const limitMatch = /\.limit\(\s*(\d+)\s*\)/.exec(afterFind);
        if (limitMatch) {
            (result as { limit: number }).limit = parseInt(limitMatch[1], 10);
        }
    }

    return result;
}

/**
 * Extract comma-separated arguments from a function call, respecting nested braces.
 */
function extractBalancedArgs(code: string, startIndex: number): string[] {
    const args: string[] = [];
    let depth = 0;
    let currentArg = '';
    let inString: string | null = null;

    for (let i = startIndex; i < code.length; i++) {
        const ch = code[i];

        // Handle string literals
        if (inString) {
            currentArg += ch;
            if (ch === inString && code[i - 1] !== '\\') {
                inString = null;
            }
            continue;
        }

        if (ch === '"' || ch === "'" || ch === '`') {
            inString = ch;
            currentArg += ch;
            continue;
        }

        if (ch === '{' || ch === '[' || ch === '(') {
            depth++;
            currentArg += ch;
        } else if (ch === '}' || ch === ']') {
            depth--;
            currentArg += ch;
        } else if (ch === ')') {
            if (depth === 0) {
                // End of function call
                if (currentArg.trim()) {
                    args.push(currentArg);
                }
                break;
            }
            depth--;
            currentArg += ch;
        } else if (ch === ',' && depth === 0) {
            args.push(currentArg);
            currentArg = '';
        } else {
            currentArg += ch;
        }
    }

    return args;
}

/**
 * Find the index of the closing parenthesis matching the opening paren at `startIndex`.
 */
function findClosingParen(code: string, startIndex: number): number {
    let depth = 0;
    let inString: string | null = null;

    for (let i = startIndex; i < code.length; i++) {
        const ch = code[i];

        if (inString) {
            if (ch === inString && code[i - 1] !== '\\') {
                inString = null;
            }
            continue;
        }

        if (ch === '"' || ch === "'" || ch === '`') {
            inString = ch;
            continue;
        }

        if (ch === '(') {
            depth++;
        } else if (ch === ')') {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }

    return -1;
}
