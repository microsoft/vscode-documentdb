/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Command categories for telemetry classification.
 * Used to understand which operations users perform most frequently
 * in the Interactive Shell and Query Playground.
 */
export type CommandCategory =
    | 'find'
    | 'insert'
    | 'update'
    | 'delete'
    | 'aggregate'
    | 'count'
    | 'index'
    | 'runCommand'
    | 'help'
    | 'show'
    | 'use'
    | 'exit'
    | 'clear'
    | 'cursor'
    | 'other';

/**
 * Classification rules. Each rule uses a global regex to count all occurrences.
 * Shell commands (help, show, use, etc.) are anchored to line starts;
 * collection methods use unanchored patterns that match anywhere.
 */
const CLASSIFICATION_RULES: ReadonlyArray<{ pattern: RegExp; category: CommandCategory }> = [
    { pattern: /^help\b/gim, category: 'help' },
    { pattern: /^show\s+/gim, category: 'show' },
    { pattern: /^use\s+/gim, category: 'use' },
    { pattern: /^(exit|quit)\s*$/gim, category: 'exit' },
    { pattern: /^(cls|clear)\s*$/gim, category: 'clear' },
    { pattern: /^it\s*$/gim, category: 'cursor' },
    { pattern: /\.find\b|\.findOne\b/g, category: 'find' },
    { pattern: /\.insert\b|\.insertOne\b|\.insertMany\b/g, category: 'insert' },
    {
        pattern: /\.update\b|\.updateOne\b|\.updateMany\b|\.replaceOne\b|\.findOneAndUpdate\b|\.findOneAndReplace\b/g,
        category: 'update',
    },
    { pattern: /\.delete\b|\.deleteOne\b|\.deleteMany\b|\.findOneAndDelete\b|\.remove\b/g, category: 'delete' },
    { pattern: /\.aggregate\b/g, category: 'aggregate' },
    { pattern: /\.count\b|\.countDocuments\b|\.estimatedDocumentCount\b/g, category: 'count' },
    {
        pattern: /\.createIndex\b|\.dropIndex\b|\.dropIndexes\b|\.getIndexes\b|\.ensureIndex\b|\.reIndex\b/g,
        category: 'index',
    },
    { pattern: /\.runCommand\b/g, category: 'runCommand' },
    { pattern: /\.help\b/g, category: 'help' },
];

/**
 * Summary of command classifications found in a code block.
 */
export interface CommandClassification {
    /** The primary (most frequent) command category. */
    readonly primaryCategory: CommandCategory;
    /** Total number of classified commands found. */
    readonly totalCommands: number;
    /** Per-category counts (only categories with ≥1 match are included). */
    readonly categoryCounts: Readonly<Partial<Record<CommandCategory, number>>>;
}

/**
 * Classifies a single shell command into a telemetry-safe category.
 *
 * Uses pattern matching on the input text — no parsing required.
 * The classification is intentionally coarse-grained to avoid capturing
 * user data while still providing actionable usage analytics.
 *
 * @param input - The raw command text (trimmed).
 * @returns A category string for telemetry.
 */
export function classifyCommand(input: string): CommandCategory {
    const trimmed = input.trim();
    for (const rule of CLASSIFICATION_RULES) {
        // Reset lastIndex since patterns have the global flag
        rule.pattern.lastIndex = 0;
        if (rule.pattern.test(trimmed)) {
            return rule.category;
        }
    }
    return 'other';
}

/**
 * Classifies all commands in a code block (e.g., a full playground script).
 *
 * Scans the entire input for all matching patterns and returns a summary
 * with per-category counts and the primary (most frequent) category.
 * This is useful for playground `runAll` where a script may contain
 * many different operations.
 *
 * @param input - The full code text (may contain multiple statements).
 * @returns A classification summary with counts per category.
 */
export function classifyCodeBlock(input: string): CommandClassification {
    const counts: Partial<Record<CommandCategory, number>> = {};
    let total = 0;

    for (const rule of CLASSIFICATION_RULES) {
        rule.pattern.lastIndex = 0;
        const matches = input.match(rule.pattern);
        if (matches && matches.length > 0) {
            counts[rule.category] = (counts[rule.category] ?? 0) + matches.length;
            total += matches.length;
        }
    }

    // Find the primary category (highest count)
    let primaryCategory: CommandCategory = 'other';
    let maxCount = 0;
    for (const [category, count] of Object.entries(counts)) {
        if (count > maxCount) {
            maxCount = count;
            primaryCategory = category as CommandCategory;
        }
    }

    if (total === 0) {
        return { primaryCategory: 'other', totalCommands: 0, categoryCounts: {} };
    }

    return { primaryCategory, totalCommands: total, categoryCounts: counts };
}
