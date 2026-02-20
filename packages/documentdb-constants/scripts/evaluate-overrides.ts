/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * evaluate-overrides.ts
 *
 * Evaluates the relationship between scraped operator data and manual overrides.
 * Produces a report showing:
 *
 *   1. Operators with empty descriptions in the scrape AND no override
 *      (gaps that still need attention)
 *   2. Operators that have overrides — shows both the override value and the
 *      original scraped value so you can detect when an override is no longer
 *      needed (e.g. the upstream docs now have a description)
 *   3. Summary statistics
 *
 * Usage:  npm run evaluate
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types (lightweight — reuses the same Markdown format as the generator)
// ---------------------------------------------------------------------------

interface ParsedEntry {
    value: string;
    description: string;
    category: string;
}

interface OverrideEntry {
    description?: string;
    syntax?: string;
    docLink?: string;
    snippet?: string;
}

// ---------------------------------------------------------------------------
// Parsers (simplified versions of the generator's parsers)
// ---------------------------------------------------------------------------

function parseDump(content: string): ParsedEntry[] {
    const lines = content.split('\n');
    const entries: ParsedEntry[] = [];

    let currentCategory = '';
    let currentOp: Partial<ParsedEntry> | null = null;
    let inCodeBlock = false;

    for (const line of lines) {
        if (line.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            continue;
        }
        if (inCodeBlock) continue;

        const h2 = line.match(/^## (.+)$/);
        if (h2) {
            if (currentOp && currentCategory) {
                entries.push({
                    value: currentOp.value!,
                    description: currentOp.description || '',
                    category: currentCategory,
                });
            }
            currentOp = null;
            const cat = h2[1].trim();
            if (cat === 'Summary' || cat === 'Not Listed') {
                currentCategory = '';
                continue;
            }
            currentCategory = cat;
            continue;
        }

        const h3 = line.match(/^### (.+)$/);
        if (h3 && currentCategory) {
            if (currentOp) {
                entries.push({
                    value: currentOp.value!,
                    description: currentOp.description || '',
                    category: currentCategory,
                });
            }
            currentOp = { value: h3[1].trim(), description: '', category: currentCategory };
            continue;
        }

        if (currentOp && line.startsWith('- **Description:**')) {
            currentOp.description = line.replace('- **Description:**', '').trim();
        }
    }

    if (currentOp && currentCategory) {
        entries.push({ value: currentOp.value!, description: currentOp.description || '', category: currentCategory });
    }

    return entries;
}

function parseOverrides(content: string): Map<string, Map<string, OverrideEntry>> {
    const lines = content.split('\n');
    const result = new Map<string, Map<string, OverrideEntry>>();

    let currentCategory = '';
    let currentOp: { value: string; entry: OverrideEntry } | null = null;
    let inCodeBlock = false;
    let syntaxLines: string[] = [];

    for (const line of lines) {
        if (line.startsWith('```')) {
            if (inCodeBlock) {
                inCodeBlock = false;
                if (currentOp) {
                    currentOp.entry.syntax = syntaxLines.join('\n').trim();
                }
                syntaxLines = [];
                continue;
            } else {
                inCodeBlock = true;
                continue;
            }
        }
        if (inCodeBlock) {
            syntaxLines.push(line);
            continue;
        }

        const h2 = line.match(/^## (.+)$/);
        if (h2) {
            if (currentOp && currentCategory) {
                saveOverride(result, currentCategory, currentOp);
            }
            currentOp = null;
            currentCategory = h2[1].trim();
            continue;
        }

        const h3 = line.match(/^### (.+)$/);
        if (h3 && currentCategory) {
            if (currentOp) {
                saveOverride(result, currentCategory, currentOp);
            }
            currentOp = { value: h3[1].trim(), entry: {} };
            continue;
        }

        if (currentOp) {
            if (line.startsWith('- **Description:**')) {
                currentOp.entry.description = line.replace('- **Description:**', '').trim();
            }
            if (line.startsWith('- **Doc Link:**')) {
                currentOp.entry.docLink = line.replace('- **Doc Link:**', '').trim();
            }
            if (line.startsWith('- **Snippet:**')) {
                let snippet = line.replace('- **Snippet:**', '').trim();
                if (snippet.startsWith('`') && snippet.endsWith('`')) {
                    snippet = snippet.slice(1, -1);
                }
                currentOp.entry.snippet = snippet;
            }
        }
    }

    if (currentOp && currentCategory) {
        saveOverride(result, currentCategory, currentOp);
    }

    return result;
}

function saveOverride(
    map: Map<string, Map<string, OverrideEntry>>,
    category: string,
    op: { value: string; entry: OverrideEntry },
): void {
    if (!map.has(category)) map.set(category, new Map());
    map.get(category)!.set(op.value, op.entry);
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Find an override for a dump entry, mirroring how the generator resolves overrides.
 *
 * The generator's `applyOverrides` iterates override categories:
 *   1. If the override category exists in the dump, it looks for the operator in that exact category.
 *   2. If the override category does NOT exist in the dump, it falls back to cross-category search.
 *
 * So for a dump entry (operatorValue, category), an override matches only if:
 *   (a) The override is in the same category as the dump entry (exact match), OR
 *   (b) The override is in a category that doesn't exist in the dump at all, and no
 *       earlier dump category already claimed this operator via cross-category fallback.
 *
 * We pass `dumpCategories` (all category names in the dump) to distinguish (a) from (b).
 */
function findOverride(
    overrides: Map<string, Map<string, OverrideEntry>>,
    operatorValue: string,
    category: string,
    dumpCategories: Set<string>,
): { override: OverrideEntry; overrideCategory: string } | undefined {
    // Exact category match: override category === dump entry category
    const catOverrides = overrides.get(category);
    if (catOverrides) {
        const entry = catOverrides.get(operatorValue);
        if (entry) return { override: entry, overrideCategory: category };
    }

    // Cross-category fallback: only if override category doesn't exist in the dump.
    // This mirrors the generator, which only enters the cross-category path when
    // `categorizedOps.get(category)` returns undefined.
    for (const [overrideCat, opMap] of overrides) {
        if (overrideCat === category) continue;
        // If this override category exists in the dump, the generator would do an
        // exact-category-only lookup there — it would NOT spill into other categories.
        if (dumpCategories.has(overrideCat)) continue;
        const entry = opMap.get(operatorValue);
        if (entry) return { override: entry, overrideCategory: overrideCat };
    }

    return undefined;
}

// ---------------------------------------------------------------------------
// ANSI colors for terminal output
// ---------------------------------------------------------------------------

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// ---------------------------------------------------------------------------
// Category → meta tag mapping (mirrors generator's CATEGORY_TO_META)
// ---------------------------------------------------------------------------

const CATEGORY_TO_META: Record<string, string> = {
    'Comparison Query Operators': 'META_QUERY_COMPARISON',
    'Logical Query Operators': 'META_QUERY_LOGICAL',
    'Element Query Operators': 'META_QUERY_ELEMENT',
    'Evaluation Query Operators': 'META_QUERY_EVALUATION',
    'Geospatial Operators': 'META_QUERY_GEOSPATIAL',
    'Array Query Operators': 'META_QUERY_ARRAY',
    'Bitwise Query Operators': 'META_QUERY_BITWISE',
    'Projection Operators': 'META_QUERY_PROJECTION',
    'Miscellaneous Query Operators': 'META_QUERY_MISC',
    'Field Update Operators': 'META_UPDATE_FIELD',
    'Array Update Operators': 'META_UPDATE_ARRAY',
    'Bitwise Update Operators': 'META_UPDATE_BITWISE',
    'Arithmetic Expression Operators': 'META_EXPR_ARITH',
    'Array Expression Operators': 'META_EXPR_ARRAY',
    'Bitwise Operators': 'META_EXPR_BITWISE',
    'Boolean Expression Operators': 'META_EXPR_BOOL',
    'Comparison Expression Operators': 'META_EXPR_COMPARISON',
    'Data Size Operators': 'META_EXPR_DATASIZE',
    'Date Expression Operators': 'META_EXPR_DATE',
    'Literal Expression Operator': 'META_EXPR_LITERAL',
    'Miscellaneous Operators': 'META_EXPR_MISC',
    'Object Expression Operators': 'META_EXPR_OBJECT',
    'Set Expression Operators': 'META_EXPR_SET',
    'String Expression Operators': 'META_EXPR_STRING',
    'Timestamp Expression Operators': 'META_EXPR_TIMESTAMP',
    'Trigonometry Expression Operators': 'META_EXPR_TRIG',
    'Type Expression Operators': 'META_EXPR_TYPE',
    'Accumulators ($group, $bucket, $bucketAuto, $setWindowFields)': 'META_ACCUMULATOR',
    'Accumulators (in Other Stages)': 'META_ACCUMULATOR',
    Accumulators: 'META_ACCUMULATOR',
    'Variable Expression Operators': 'META_EXPR_VARIABLE',
    'Window Operators': 'META_WINDOW',
    'Conditional Expression Operators': 'META_EXPR_CONDITIONAL',
    'Aggregation Pipeline Stages': 'META_STAGE',
    'Variables in Aggregation Expressions': 'META_VARIABLE',
};

// ---------------------------------------------------------------------------
// Snippet file parser
// ---------------------------------------------------------------------------

function parseSnippetsFile(content: string): Map<string, Map<string, string>> {
    const lines = content.split('\n');
    const result = new Map<string, Map<string, string>>();

    let currentMeta = '';
    let currentOp = '';
    let inCodeBlock = false;

    for (const line of lines) {
        if (line.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            continue;
        }
        if (inCodeBlock) continue;

        const h2 = line.match(/^## (.+)$/);
        if (h2) {
            const cat = h2[1].trim();
            const meta = CATEGORY_TO_META[cat];
            if (meta) {
                currentMeta = meta;
                if (!result.has(currentMeta)) {
                    result.set(currentMeta, new Map());
                }
            } else {
                currentMeta = '';
            }
            currentOp = '';
            continue;
        }

        const h3 = line.match(/^### (.+)$/);
        if (h3 && currentMeta) {
            currentOp = h3[1].trim();
            continue;
        }

        if (currentMeta && currentOp && line.startsWith('- **Snippet:**')) {
            let snippet = line.replace('- **Snippet:**', '').trim();
            if (snippet.startsWith('`') && snippet.endsWith('`')) {
                snippet = snippet.slice(1, -1);
            }
            if (snippet) {
                result.get(currentMeta)!.set(currentOp, snippet);
            }
            continue;
        }
    }

    return result;
}

function operatorHasSnippet(
    snippets: Map<string, Map<string, string>>,
    meta: string,
    operatorValue: string,
    overrideSnippet: string | undefined,
): boolean {
    if (overrideSnippet) return true;
    const catSnippets = snippets.get(meta);
    if (!catSnippets) return false;
    if (catSnippets.has(operatorValue)) return true;
    if (catSnippets.has('DEFAULT')) return true;
    return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
    const dumpPath = path.join(__dirname, '..', 'resources', 'scraped', 'operator-reference.md');
    const overridePath = path.join(__dirname, '..', 'resources', 'overrides', 'operator-overrides.md');
    const snippetsPath = path.join(__dirname, '..', 'resources', 'overrides', 'operator-snippets.md');

    if (!fs.existsSync(dumpPath)) {
        console.error(`❌ Scraped dump not found: ${dumpPath}`);
        process.exit(1);
    }

    console.log(`${BOLD}📊 Evaluating operator overrides${RESET}\n`);

    // Parse both files
    const dumpContent = fs.readFileSync(dumpPath, 'utf-8');
    const dumpEntries = parseDump(dumpContent);

    let overrides = new Map<string, Map<string, OverrideEntry>>();
    let totalOverrideCount = 0;
    if (fs.existsSync(overridePath)) {
        const overrideContent = fs.readFileSync(overridePath, 'utf-8');
        overrides = parseOverrides(overrideContent);
        for (const [, catMap] of overrides) {
            totalOverrideCount += catMap.size;
        }
    }

    // Categorize every scraped entry
    const gaps: ParsedEntry[] = []; // empty description, no override
    const overridden: { entry: ParsedEntry; override: OverrideEntry; overrideCategory: string }[] = [];
    const redundantOverrides: { entry: ParsedEntry; override: OverrideEntry; overrideCategory: string }[] = [];
    const descriptionsOk: ParsedEntry[] = [];

    // Collect all dump category names so findOverride can distinguish exact vs cross-category
    const dumpCategories = new Set(dumpEntries.map((e) => e.category));

    for (const entry of dumpEntries) {
        const match = findOverride(overrides, entry.value, entry.category, dumpCategories);
        const hasScrapedDescription = entry.description.trim().length > 0;

        if (match) {
            if (hasScrapedDescription && match.override.description) {
                // Has both scraped description AND an override description
                redundantOverrides.push({ entry, override: match.override, overrideCategory: match.overrideCategory });
            } else {
                // Override is filling a gap (or overriding something else)
                overridden.push({ entry, override: match.override, overrideCategory: match.overrideCategory });
            }
        } else if (!hasScrapedDescription) {
            gaps.push(entry);
        } else {
            descriptionsOk.push(entry);
        }
    }

    // -----------------------------------------------------------------------
    // Section 1: Gaps — empty description, no override
    // -----------------------------------------------------------------------
    console.log(`${BOLD}${RED}═══ GAPS: Empty description, no override (${gaps.length}) ═══${RESET}`);
    if (gaps.length === 0) {
        console.log(`  ${GREEN}✅ No gaps — all operators have descriptions or overrides.${RESET}\n`);
    } else {
        const byCategory = groupByCategory(gaps);
        for (const [cat, ops] of byCategory) {
            console.log(`  ${CYAN}${cat}${RESET}`);
            for (const op of ops) {
                console.log(`    ${RED}⚠${RESET}  ${op.value}`);
            }
        }
        console.log('');
    }

    // -----------------------------------------------------------------------
    // Section 2: Potentially redundant overrides
    //   (scraped dump NOW has a description, but override also provides one)
    // -----------------------------------------------------------------------
    console.log(`${BOLD}${YELLOW}═══ POTENTIALLY REDUNDANT OVERRIDES (${redundantOverrides.length}) ═══${RESET}`);
    if (redundantOverrides.length === 0) {
        console.log(`  ${GREEN}✅ No redundant overrides — all overrides are filling gaps.${RESET}\n`);
    } else {
        console.log(
            `  ${DIM}These operators now have scraped descriptions. The override may no longer be needed.${RESET}`,
        );
        console.log(
            `  ${DIM}Compare the values below — if the scraped one is good enough, remove the override.${RESET}\n`,
        );
        for (const { entry, override, overrideCategory } of redundantOverrides) {
            console.log(`  ${CYAN}${entry.value}${RESET} ${DIM}(${entry.category})${RESET}`);
            console.log(`    ${DIM}Override (${overrideCategory}):${RESET} ${override.description}`);
            console.log(`    ${DIM}Scraped:${RESET}                  ${entry.description}`);
            console.log('');
        }
    }

    // -----------------------------------------------------------------------
    // Section 3: Active overrides filling gaps
    // -----------------------------------------------------------------------
    console.log(`${BOLD}${GREEN}═══ ACTIVE OVERRIDES FILLING GAPS (${overridden.length}) ═══${RESET}`);
    if (overridden.length === 0) {
        console.log(`  ${DIM}No active overrides.${RESET}\n`);
    } else {
        const byCategory = new Map<string, typeof overridden>();
        for (const item of overridden) {
            const cat = item.overrideCategory;
            if (!byCategory.has(cat)) byCategory.set(cat, []);
            byCategory.get(cat)!.push(item);
        }
        for (const [cat, items] of byCategory) {
            console.log(`  ${CYAN}${cat}${RESET} (${items.length} overrides)`);
            for (const { entry, override } of items) {
                const overrideDesc = override.description || '(no description override)';
                const scrapedDesc = entry.description || '(empty)';
                console.log(`    ${GREEN}✓${RESET}  ${entry.value}`);
                console.log(`       ${DIM}Override:${RESET} ${overrideDesc}`);
                if (scrapedDesc !== '(empty)') {
                    console.log(`       ${DIM}Scraped:${RESET}  ${scrapedDesc}`);
                }
            }
        }
        console.log('');
    }

    // -----------------------------------------------------------------------
    // Section 4: Snippet coverage
    // -----------------------------------------------------------------------
    let snippets = new Map<string, Map<string, string>>();
    if (fs.existsSync(snippetsPath)) {
        const snippetsContent = fs.readFileSync(snippetsPath, 'utf-8');
        snippets = parseSnippetsFile(snippetsContent);
    }

    const withSnippet: ParsedEntry[] = [];
    const withoutSnippet: ParsedEntry[] = [];

    for (const entry of dumpEntries) {
        const meta = CATEGORY_TO_META[entry.category];
        if (!meta) {
            withoutSnippet.push(entry);
            continue;
        }
        const match = findOverride(overrides, entry.value, entry.category, dumpCategories);
        const overrideSnippet = match?.override.snippet;
        if (operatorHasSnippet(snippets, meta, entry.value, overrideSnippet)) {
            withSnippet.push(entry);
        } else {
            withoutSnippet.push(entry);
        }
    }

    console.log(`${BOLD}${CYAN}═══ SNIPPET COVERAGE (${withSnippet.length}/${dumpEntries.length}) ═══${RESET}`);
    if (withoutSnippet.length === 0) {
        console.log(`  ${GREEN}✅ All operators have snippet templates.${RESET}\n`);
    } else {
        console.log(`  ${DIM}Operators without snippet templates (by category):${RESET}\n`);
        const byCategory = groupByCategory(withoutSnippet);
        for (const [cat, ops] of byCategory) {
            console.log(`  ${CYAN}${cat}${RESET}`);
            for (const op of ops) {
                console.log(`    ${DIM}—${RESET}  ${op.value}`);
            }
        }
        console.log('');
    }

    // -----------------------------------------------------------------------
    // Section 5: Summary
    // -----------------------------------------------------------------------
    console.log(`${BOLD}═══ SUMMARY ═══${RESET}`);
    console.log(`  Total scraped operators:    ${dumpEntries.length}`);
    console.log(`  With scraped description:   ${descriptionsOk.length + redundantOverrides.length}`);
    console.log(`  Filled by override:         ${overridden.length}`);
    console.log(`  Potentially redundant:      ${YELLOW}${redundantOverrides.length}${RESET}`);
    console.log(`  ${RED}Gaps remaining:${RESET}             ${gaps.length}`);
    console.log(`  Total overrides in file:    ${totalOverrideCount}`);
    console.log(`  With snippet template:      ${withSnippet.length}`);
    console.log(`  Without snippet:            ${withoutSnippet.length}`);
    console.log(`  Description coverage:       ${((1 - gaps.length / dumpEntries.length) * 100).toFixed(1)}%`);
    console.log(`  Snippet coverage:           ${((withSnippet.length / dumpEntries.length) * 100).toFixed(1)}%`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByCategory(entries: ParsedEntry[]): Map<string, ParsedEntry[]> {
    const map = new Map<string, ParsedEntry[]>();
    for (const e of entries) {
        if (!map.has(e.category)) map.set(e.category, []);
        map.get(e.category)!.push(e);
    }
    return map;
}

main();
