/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Parses the operator-reference-scraped.md dump file into structured data
 * for use in the operatorReference verification test.
 *
 * The dump format uses structured headings:
 *   ## Category Name           — category section
 *   ### $operatorName          — operator heading
 *   - **Description:** text    — operator description
 *   - **Doc Link:** url        — documentation URL
 *
 *   ## Not Listed              — excluded operators section
 *   - **$operator** (Category) — Reason
 */

/**
 * Represents a single operator entry parsed from the reference dump.
 */
export interface ReferenceOperator {
    /** Operator name, e.g. "$eq", "$$NOW" */
    readonly operator: string;
    /** Category from the dump, e.g. "Comparison Query Operators" */
    readonly category: string;
    /** Description from the dump (may be empty) */
    readonly description: string;
    /** Documentation URL from the dump (may be empty) */
    readonly docLink: string;
}

/**
 * Represents an operator excluded from the package scope.
 */
export interface NotListedOperator {
    /** Operator name, e.g. "$where", "$meta" */
    readonly operator: string;
    /** Category from the dump */
    readonly category: string;
    /** Reason for exclusion */
    readonly reason: string;
}

/**
 * Complete parsed result from the reference dump.
 */
export interface ParsedReference {
    /** All listed (in-scope) operators */
    readonly operators: readonly ReferenceOperator[];
    /** All not-listed (excluded) operators */
    readonly notListed: readonly NotListedOperator[];
}

/**
 * Parses the operator-reference-scraped.md content into structured data.
 *
 * @param content - the full Markdown content of the dump file
 * @returns parsed reference data
 */
export function parseOperatorReference(content: string): ParsedReference {
    const lines = content.split('\n');
    const operators: ReferenceOperator[] = [];
    const notListed: NotListedOperator[] = [];

    let currentCategory = '';
    let inNotListed = false;
    let inSummary = false;

    // Temp state for building current operator
    let currentOperator = '';
    let currentDescription = '';
    let currentDocLink = '';

    function flushOperator(): void {
        if (currentOperator && currentCategory && !inNotListed && !inSummary) {
            operators.push({
                operator: currentOperator,
                category: currentCategory,
                description: currentDescription,
                docLink: currentDocLink,
            });
        }
        currentOperator = '';
        currentDescription = '';
        currentDocLink = '';
    }

    for (const line of lines) {
        const trimmed = line.trim();

        // Detect ## headings (category sections)
        const h2Match = trimmed.match(/^## (.+)$/);
        if (h2Match) {
            flushOperator();
            const heading = h2Match[1].trim();
            if (heading === 'Summary') {
                inSummary = true;
                inNotListed = false;
                currentCategory = '';
            } else if (heading === 'Not Listed') {
                inNotListed = true;
                inSummary = false;
                currentCategory = '';
            } else {
                currentCategory = heading;
                inNotListed = false;
                inSummary = false;
            }
            continue;
        }

        // Skip summary section
        if (inSummary) {
            continue;
        }

        // Parse "Not Listed" entries: - **$operator** (Category) — Reason
        if (inNotListed) {
            const notListedMatch = trimmed.match(/^- \*\*(.+?)\*\* \((.+?)\) — (.+)$/);
            if (notListedMatch) {
                notListed.push({
                    operator: notListedMatch[1],
                    category: notListedMatch[2],
                    reason: notListedMatch[3],
                });
            }
            continue;
        }

        // Detect ### headings (operator entries)
        const h3Match = trimmed.match(/^### (.+)$/);
        if (h3Match) {
            flushOperator();
            currentOperator = h3Match[1].trim();
            continue;
        }

        // Parse description: - **Description:** text
        const descMatch = trimmed.match(/^- \*\*Description:\*\* (.+)$/);
        if (descMatch && currentOperator) {
            currentDescription = descMatch[1].trim();
            continue;
        }

        // Parse doc link: - **Doc Link:** url
        const linkMatch = trimmed.match(/^- \*\*Doc Link:\*\* (.+)$/);
        if (linkMatch && currentOperator) {
            currentDocLink = linkMatch[1].trim();
            continue;
        }
    }

    // Flush last operator
    flushOperator();

    return { operators, notListed };
}
