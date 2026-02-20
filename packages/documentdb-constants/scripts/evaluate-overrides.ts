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
                currentOp.entry.snippet = line.replace('- **Snippet:**', '').trim();
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

/** Find an override for an operator, checking both exact category match and cross-category fallback. */
function findOverride(
    overrides: Map<string, Map<string, OverrideEntry>>,
    operatorValue: string,
    category: string,
): { override: OverrideEntry; overrideCategory: string } | undefined {
    // Exact category match first
    const catOverrides = overrides.get(category);
    if (catOverrides) {
        const entry = catOverrides.get(operatorValue);
        if (entry) return { override: entry, overrideCategory: category };
    }

    // Cross-category fallback
    for (const [overrideCat, opMap] of overrides) {
        if (overrideCat === category) continue;
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
// Main
// ---------------------------------------------------------------------------

function main(): void {
    const dumpPath = path.join(__dirname, '..', 'resources', 'operator-reference-scraped.md');
    const overridePath = path.join(__dirname, '..', 'resources', 'operator-reference-overrides.md');

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

    for (const entry of dumpEntries) {
        const match = findOverride(overrides, entry.value, entry.category);
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
    // Section 4: Summary
    // -----------------------------------------------------------------------
    console.log(`${BOLD}═══ SUMMARY ═══${RESET}`);
    console.log(`  Total scraped operators:    ${dumpEntries.length}`);
    console.log(`  With scraped description:   ${descriptionsOk.length + redundantOverrides.length}`);
    console.log(`  Filled by override:         ${overridden.length}`);
    console.log(`  Potentially redundant:      ${YELLOW}${redundantOverrides.length}${RESET}`);
    console.log(`  ${RED}Gaps remaining:${RESET}             ${gaps.length}`);
    console.log(`  Total overrides in file:    ${totalOverrideCount}`);
    console.log(`  Coverage:                   ${((1 - gaps.length / dumpEntries.length) * 100).toFixed(1)}%`);
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
