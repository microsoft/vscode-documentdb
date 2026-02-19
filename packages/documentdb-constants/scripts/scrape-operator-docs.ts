/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * scrape-operator-docs.ts
 *
 * Scrapes the DocumentDB compatibility page and per-operator documentation
 * to generate the resources/operator-reference.md dump file.
 *
 * Usage:
 *   npx ts-node packages/documentdb-constants/scripts/scrape-operator-docs.ts
 *
 * The scraper has three phases:
 *   Phase 1: Fetch and parse the compatibility page (operator list + support status)
 *   Phase 2: Fetch per-operator doc pages (descriptions + syntax)
 *   Phase 3: Generate the Markdown dump file
 *
 * Before doing real work, a verification step checks that the upstream
 * documentation structure is as expected by fetching a few known URLs.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OperatorInfo {
    operator: string;
    category: string;
    listed: boolean;
    /** Human-readable reason if not listed */
    notListedReason?: string;
    /** Description from the per-operator doc page YAML frontmatter */
    description?: string;
    /** Syntax snippet from the per-operator doc page */
    syntax?: string;
    /** Documentation URL */
    docLink?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPAT_PAGE_URL =
    'https://raw.githubusercontent.com/MicrosoftDocs/azure-databases-docs/main/articles/documentdb/compatibility-query-language.md';

const OPERATOR_DOC_BASE =
    'https://raw.githubusercontent.com/MicrosoftDocs/azure-databases-docs/main/articles/documentdb/operators';

const DOC_LINK_BASE = 'https://learn.microsoft.com/en-us/azure/documentdb/operators';

/**
 * Maps category names (as they appear in column 1 of the compat page table)
 * to the docs directory used for per-operator doc pages.
 *
 * This mapping is derived from the operators TOC.yml in the azure-databases-docs repo.
 * Category names are trimmed before lookup, so leading/trailing spaces are OK.
 */
const CATEGORY_TO_DIR: Record<string, string> = {
    // Query operators
    'Comparison Query Operators': 'comparison-query',
    'Logical Query Operators': 'logical-query',
    'Element Query Operators': 'element-query',
    'Evaluation Query Operators': 'evaluation-query',
    'Array Query Operators': 'array-query',
    'Bitwise Query Operators': 'bitwise-query',
    'Geospatial Operators': 'geospatial',
    'Projection Operators': 'projection',
    'Miscellaneous Query Operators': 'miscellaneous-query',
    // Update operators
    'Field Update Operators': 'field-update',
    'Array Update Operators': 'array-update',
    'Bitwise Update Operators': 'bitwise-update',
    // Aggregation
    'Aggregation Pipeline Stages': 'aggregation',
    'Accumulators ($group, $bucket, $bucketAuto, $setWindowFields)': 'accumulators',
    'Accumulators (in Other Stages)': 'accumulators',
    // Expression operators
    'Arithmetic Expression Operators': 'arithmetic-expression',
    'Array Expression Operators': 'array-expression',
    'Bitwise Operators': 'bitwise',
    'Boolean Expression Operators': 'boolean-expression',
    'Comparison Expression Operators': 'comparison-expression',
    'Conditional Expression Operators': 'conditional-expression',
    'Data Size Operators': 'data-size',
    'Date Expression Operators': 'date-expression',
    'Literal Expression Operator': 'literal-expression',
    'Miscellaneous Operators': 'miscellaneous',
    'Object Expression Operators': 'object-expression',
    'Set Expression Operators': 'set-expression',
    'String Expression Operators': 'string-expression',
    'Trigonometry Expression Operators': 'trigonometry-expression',
    'Type Expression Operators': 'aggregation/type-expression',
    'Timestamp Expression Operators': 'timestamp-expression',
    'Variable Expression Operators': 'variable-expression',
    'Text Expression Operator': 'miscellaneous',
    'Custom Aggregation Expression Operators': 'miscellaneous',
    // Window
    'Window Operators': 'window-operators',
    // System variables — no per-operator doc pages
    'Variables in Aggregation Expressions': '',
};

/** Delay between batches of concurrent requests (ms) */
const BATCH_DELAY_MS = 200;

/** Number of concurrent requests per batch */
const BATCH_SIZE = 10;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

async function fetchText(url: string): Promise<string | null> {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return null;
        }
        return await response.text();
    } catch {
        return null;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolves a category name to its docs directory.
 */
function getCategoryDir(category: string): string | undefined {
    return CATEGORY_TO_DIR[category];
}

/**
 * Extracts the YAML frontmatter description from a docs Markdown file.
 * Normalizes CRLF line endings before parsing.
 */
function extractDescription(markdown: string): string | undefined {
    const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const fmMatch = normalized.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fmMatch) return undefined;

    const frontmatter = fmMatch[1];
    // Look for description field — may be indented (e.g. "  description: ...")
    const descMatch = frontmatter.match(/^\s*description:\s*(.+)$/m);
    if (descMatch) {
        return descMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }
    return undefined;
}

/**
 * Extracts the first code block after a ## Syntax heading.
 * Normalizes CRLF line endings to LF.
 */
function extractSyntax(markdown: string): string | undefined {
    // Find ## Syntax (or ### Syntax) section
    const syntaxSectionMatch = markdown.match(/##\s*Syntax\s*\n([\s\S]*?)(?=\n##\s|\n$)/i);
    if (!syntaxSectionMatch) return undefined;

    const section = syntaxSectionMatch[1];
    // Find first code block in this section
    const codeBlockMatch = section.match(/```[\w]*\s*\n([\s\S]*?)```/);
    if (codeBlockMatch) {
        return codeBlockMatch[1].replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    }
    return undefined;
}

/**
 * Escape pipe characters and collapse whitespace in table cell content.
 * Handles both \n and \r\n line endings (GitHub raw content may use CRLF).
 */
function escapeTableCell(text: string): string {
    return text
        .replace(/\r\n|\r|\n/g, ' ')
        .replace(/\|/g, '\\|')
        .replace(/\s+/g, ' ')
        .trim();
}

// ---------------------------------------------------------------------------
// Phase 0: Verification
// ---------------------------------------------------------------------------

interface VerificationResult {
    passed: boolean;
    checks: Array<{ name: string; passed: boolean; detail: string }>;
}

async function runVerification(): Promise<VerificationResult> {
    console.log('');
    console.log('='.repeat(60));
    console.log('  VERIFICATION STEP');
    console.log('  Checking that upstream documentation structure is as expected');
    console.log('='.repeat(60));
    console.log('');

    const checks: VerificationResult['checks'] = [];

    // Check 1: Compatibility page is accessible and has expected structure
    console.log('  [1/4] Fetching compatibility page...');
    const compatContent = await fetchText(COMPAT_PAGE_URL);
    if (compatContent) {
        const hasTable = /\|.*\|.*\|/.test(compatContent);
        const hasOperators = /\$\w+/.test(compatContent);
        const passed = hasTable && hasOperators;
        checks.push({
            name: 'Compatibility page accessible & has tables + operators',
            passed,
            detail: passed
                ? `OK — ${(compatContent.length / 1024).toFixed(1)} KB, tables found`
                : `FAIL — tables: ${hasTable}, operators: ${hasOperators}`,
        });
    } else {
        checks.push({
            name: 'Compatibility page accessible',
            passed: false,
            detail: `FAIL — could not fetch ${COMPAT_PAGE_URL}`,
        });
    }

    // Check 2: A known operator doc page exists ($match — aggregation stage)
    console.log('  [2/4] Fetching known operator page ($match)...');
    const matchUrl = `${OPERATOR_DOC_BASE}/aggregation/$match.md`;
    const matchContent = await fetchText(matchUrl);
    if (matchContent) {
        const hasDescription = extractDescription(matchContent) !== undefined;
        checks.push({
            name: '$match doc page has YAML frontmatter with description',
            passed: hasDescription,
            detail: hasDescription
                ? `OK — description: "${extractDescription(matchContent)}"`
                : 'FAIL — no description in frontmatter',
        });
    } else {
        checks.push({
            name: '$match doc page accessible',
            passed: false,
            detail: `FAIL — could not fetch ${matchUrl}`,
        });
    }

    // Check 3: A known query operator doc page exists ($eq — comparison query)
    console.log('  [3/4] Fetching known operator page ($eq)...');
    const eqUrl = `${OPERATOR_DOC_BASE}/comparison-query/$eq.md`;
    const eqContent = await fetchText(eqUrl);
    if (eqContent) {
        const desc = extractDescription(eqContent);
        const syntax = extractSyntax(eqContent);
        const passed = desc !== undefined;
        checks.push({
            name: '$eq doc page has frontmatter description',
            passed,
            detail: passed
                ? `OK — description: "${desc}", syntax: ${syntax ? 'found' : 'not found'}`
                : 'FAIL — no description in frontmatter',
        });
    } else {
        checks.push({
            name: '$eq doc page accessible',
            passed: false,
            detail: `FAIL — could not fetch ${eqUrl}`,
        });
    }

    // Check 4: A known accumulator doc page exists ($sum)
    console.log('  [4/4] Fetching known operator page ($sum)...');
    const sumUrl = `${OPERATOR_DOC_BASE}/accumulators/$sum.md`;
    const sumContent = await fetchText(sumUrl);
    if (sumContent) {
        const desc = extractDescription(sumContent);
        const passed = desc !== undefined;
        checks.push({
            name: '$sum doc page has frontmatter description',
            passed,
            detail: passed ? `OK — description: "${desc}"` : 'FAIL — no description in frontmatter',
        });
    } else {
        checks.push({
            name: '$sum doc page accessible',
            passed: false,
            detail: `FAIL — could not fetch ${sumUrl}`,
        });
    }

    // Print results
    console.log('');
    console.log('-'.repeat(60));
    console.log('  Verification Results:');
    console.log('-'.repeat(60));
    const allPassed = checks.every((c) => c.passed);
    for (const check of checks) {
        const icon = check.passed ? '✅' : '❌';
        console.log(`  ${icon} ${check.name}`);
        console.log(`     ${check.detail}`);
    }
    console.log('-'.repeat(60));
    if (allPassed) {
        console.log('  ✅ VERIFICATION PASSED — all checks succeeded');
    } else {
        console.log('  ❌ VERIFICATION FAILED — some checks did not pass');
        console.log('     The documentation structure may have changed.');
        console.log('     Review the failures above before proceeding.');
    }
    console.log('='.repeat(60));
    console.log('');

    return { passed: allPassed, checks };
}

// ---------------------------------------------------------------------------
// Phase 1: Compatibility table extraction
// ---------------------------------------------------------------------------

/**
 * Sections we explicitly skip (not operators — commands, indexes, etc.)
 */
const SKIP_SECTIONS = ['Database commands', 'Index types', 'Index properties', 'Related content'];

function parseCompatibilityTables(markdown: string): OperatorInfo[] {
    const operators: OperatorInfo[] = [];
    const lines = markdown.split('\n');

    // The compatibility page has a single "## Operators" section with one big table:
    // | Category | Operator | Supported (v5.0) | Supported (v6.0) | Supported (v7.0) | Supported (v8.0) |
    // | --- | --- | --- | --- | --- | --- |
    // | Comparison Query Operators | `$eq` | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |

    let currentSection = '';
    let inTable = false;
    let separatorSeen = false;

    for (const line of lines) {
        // Detect section headings
        const h2Match = line.match(/^##\s+(.+)/);
        if (h2Match) {
            currentSection = h2Match[1].trim();
            inTable = false;
            separatorSeen = false;
            continue;
        }

        // Skip sections we don't care about
        if (SKIP_SECTIONS.some((s) => currentSection.startsWith(s))) {
            continue;
        }

        // Only process lines that start with |
        if (!line.startsWith('|')) {
            if (inTable) {
                inTable = false;
                separatorSeen = false;
            }
            continue;
        }

        // Parse table rows
        const cells = line
            .split('|')
            .map((c) => c.trim())
            .filter((c) => c.length > 0);

        if (cells.length < 2) continue;

        // Detect separator row (| --- | --- | ... |)
        if (cells.every((c) => /^-+$/.test(c) || /^:?-+:?$/.test(c))) {
            separatorSeen = true;
            inTable = true;
            continue;
        }

        // Skip header row (before separator)
        if (!separatorSeen) {
            continue;
        }

        // Data row: | Category | Operator | v5.0 | v6.0 | v7.0 | v8.0 |
        if (inTable && cells.length >= 2) {
            const rawCategory = cells[0].replace(/`/g, '').replace(/\*\*/g, '').trim();
            let rawOperator = cells[1];

            // Extract from markdown links like [`$eq`](...)
            const linkMatch = rawOperator.match(/\[([^\]]+)\]/);
            if (linkMatch) {
                rawOperator = linkMatch[1];
            }
            rawOperator = rawOperator.replace(/`/g, '').replace(/\*+$/, '').trim();

            // Handle $[identifier] which may be parsed incorrectly
            // The compat page shows `$[identifier]` — square brackets get stripped by link parsing
            if (rawOperator === 'identifier' && rawCategory.includes('Array Update')) {
                rawOperator = '$[identifier]';
            }

            // For Variables in Aggregation Expressions, add $$ prefix
            if (rawCategory === 'Variables in Aggregation Expressions' && !rawOperator.startsWith('$')) {
                rawOperator = '$$' + rawOperator;
            }

            if (!rawOperator || rawOperator === 'Operator' || rawOperator === 'Command') {
                continue;
            }

            // Skip summary table rows where "operator" column contains numbers
            // (e.g., "| **Aggregation Stages** | 60 | 58 | 96.67% |")
            if (/^\d+$/.test(rawOperator)) {
                continue;
            }

            // Skip rows where category contains percentage or "Total"
            if (rawCategory.includes('%') || rawCategory === 'Total') {
                continue;
            }

            // Check support status from version columns (cells 2+)
            const versionCells = cells.slice(2);
            const hasYes = versionCells.some((c) => c.includes('Yes') || c.includes('✅') || c.includes('✓'));
            const hasNo = versionCells.some((c) => c.includes('No') || c.includes('❌') || c.includes('✗'));
            const hasDeprecated = versionCells.some((c) => c.toLowerCase().includes('deprecated'));

            let listed: boolean;
            let notListedReason: string | undefined;

            if (hasDeprecated) {
                listed = false;
                const depCell = versionCells.find((c) => c.toLowerCase().includes('deprecated'));
                notListedReason = depCell?.replace(/[*`]/g, '').trim() || 'Deprecated';
            } else if (hasNo && !hasYes) {
                listed = false;
                notListedReason = 'Not in scope';
            } else {
                listed = true;
            }

            operators.push({
                operator: rawOperator,
                category: rawCategory,
                listed,
                notListedReason,
            });
        }
    }

    return operators;
}

// ---------------------------------------------------------------------------
// Phase 2: Per-operator doc fetching
// ---------------------------------------------------------------------------

/**
 * Builds a global index of all operator doc files in the docs repo
 * by crawling each known directory. Returns a map from lowercase filename
 * (e.g. "$eq.md") to the directory path it lives in.
 *
 * This allows the scraper to find operators that are filed in a different
 * directory than expected (e.g. $cmp is a comparison expression operator
 * but lives in comparison-query/).
 */
async function buildGlobalFileIndex(): Promise<Map<string, string>> {
    const GITHUB_API_BASE =
        'https://api.github.com/repos/MicrosoftDocs/azure-databases-docs/contents/articles/documentdb/operators';

    const index = new Map<string, string>();

    try {
        const response = await fetch(GITHUB_API_BASE);
        if (!response.ok) {
            console.log('  ⚠ Could not fetch directory listing from GitHub API — skipping global index');
            return index;
        }

        const items = (await response.json()) as Array<{ name: string; type: string }>;
        const dirs = items.filter((d) => d.type === 'dir' && d.name !== 'includes');

        for (const dir of dirs) {
            await sleep(300); // Rate limit GitHub API
            try {
                const dirResponse = await fetch(`${GITHUB_API_BASE}/${dir.name}`);
                if (!dirResponse.ok) continue;

                const dirItems = (await dirResponse.json()) as Array<{ name: string; type: string }>;
                const files = dirItems.filter((f) => f.name.endsWith('.md'));
                const subdirs = dirItems.filter((f) => f.type === 'dir');

                for (const file of files) {
                    index.set(file.name.toLowerCase(), dir.name);
                }

                // Also check subdirectories (e.g., aggregation/type-expression/)
                for (const sub of subdirs) {
                    await sleep(300);
                    try {
                        const subResponse = await fetch(`${GITHUB_API_BASE}/${dir.name}/${sub.name}`);
                        if (!subResponse.ok) continue;

                        const subItems = (await subResponse.json()) as Array<{ name: string; type: string }>;
                        for (const file of subItems.filter((f) => f.name.endsWith('.md'))) {
                            index.set(file.name.toLowerCase(), `${dir.name}/${sub.name}`);
                        }
                    } catch {
                        // Ignore subdirectory fetch failures
                    }
                }
            } catch {
                // Ignore individual directory fetch failures
            }
        }
    } catch {
        console.log('  ⚠ GitHub API request failed — skipping global index');
    }

    return index;
}

async function fetchOperatorDocs(operators: OperatorInfo[]): Promise<void> {
    // Build a global index of all doc files to use as fallback
    console.log('  Building global file index from GitHub API...');
    const globalIndex = await buildGlobalFileIndex();
    console.log(`  Global index: ${globalIndex.size} files found across all directories`);
    console.log('');

    // Only fetch for listed operators that have a doc directory or are in global index
    const fetchable = operators.filter((op) => {
        if (!op.listed) return false;
        const dir = getCategoryDir(op.category);
        // Skip operators whose category maps to empty string (e.g. system variables)
        if (dir === '') return false;
        // Include if we have a directory mapping OR if the file exists in the global index
        const opFileName = op.operator.toLowerCase() + '.md';
        return dir !== undefined || globalIndex.has(opFileName);
    });
    const total = fetchable.length;
    let fetched = 0;
    let succeeded = 0;
    let failed = 0;
    const skipped = operators.filter((op) => op.listed).length - total;

    console.log(`  Phase 2: Fetching per-operator doc pages (${total} operators, ${skipped} skipped)...`);
    console.log('');

    // Process in batches
    for (let i = 0; i < fetchable.length; i += BATCH_SIZE) {
        const batch = fetchable.slice(i, i + BATCH_SIZE);

        const promises = batch.map(async (op) => {
            const primaryDir = getCategoryDir(op.category);
            const opNameLower = op.operator.toLowerCase();
            const opNameOriginal = op.operator;
            const opFileName = opNameLower + '.md';

            // Strategy:
            // 1. Try primary directory (lowercase filename)
            // 2. Try primary directory (original casing)
            // 3. Try global index fallback directory (lowercase filename)
            // 4. Try global index fallback directory (original casing)
            let content: string | null = null;
            let resolvedDir: string | undefined;

            if (primaryDir) {
                content = await fetchText(`${OPERATOR_DOC_BASE}/${primaryDir}/${opNameLower}.md`);
                if (content) {
                    resolvedDir = primaryDir;
                } else if (opNameLower !== opNameOriginal) {
                    content = await fetchText(`${OPERATOR_DOC_BASE}/${primaryDir}/${opNameOriginal}.md`);
                    if (content) resolvedDir = primaryDir;
                }
            }

            // Fallback: check global index for a different directory
            if (!content && globalIndex.has(opFileName)) {
                const fallbackDir = globalIndex.get(opFileName)!;
                if (fallbackDir !== primaryDir) {
                    content = await fetchText(`${OPERATOR_DOC_BASE}/${fallbackDir}/${opFileName}`);
                    if (content) {
                        resolvedDir = fallbackDir;
                    }
                }
            }

            if (content) {
                op.description = extractDescription(content);
                op.syntax = extractSyntax(content);
                op.docLink = `${DOC_LINK_BASE}/${resolvedDir}/${opNameLower}`;
                succeeded++;
            } else {
                failed++;
            }
            fetched++;
        });

        await Promise.all(promises);

        // Progress output
        const pct = ((fetched / total) * 100).toFixed(0);
        process.stdout.write(`\r  Progress: ${fetched}/${total} (${pct}%) — ${succeeded} succeeded, ${failed} failed`);

        // Rate limiting between batches
        if (i + BATCH_SIZE < fetchable.length) {
            await sleep(BATCH_DELAY_MS);
        }
    }

    console.log(''); // newline after progress
    console.log(`  Phase 2 complete: ${succeeded}/${total} docs fetched successfully`);
    if (failed > 0) {
        console.log(`  ⚠ ${failed} operators could not be fetched (will have empty descriptions)`);
        // List the failed operators for debugging
        const failedOps = fetchable.filter((op) => !op.description && !op.syntax);
        if (failedOps.length <= 120) {
            for (const op of failedOps) {
                const dir = getCategoryDir(op.category) || '???';
                const fallback = globalIndex.get(op.operator.toLowerCase() + '.md');
                const extra = fallback && fallback !== dir ? ` (also tried ${fallback})` : '';
                console.log(`     - ${op.operator} (${op.category} → ${dir}${extra})`);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Phase 3: Dump generation
// ---------------------------------------------------------------------------

function generateDump(operators: OperatorInfo[]): string {
    const now = new Date().toISOString().split('T')[0];
    const lines: string[] = [];

    lines.push('# DocumentDB Operator Reference');
    lines.push('');
    lines.push('<!-- AUTO-GENERATED by scrape-operator-docs.ts -->');
    lines.push(`<!-- Last scraped: ${now} -->`);
    lines.push('<!-- Source: https://github.com/MicrosoftDocs/azure-databases-docs -->');
    lines.push('');

    // Summary table (compact — stays as a table)
    const categories = new Map<string, { listed: number; notListed: number }>();
    for (const op of operators) {
        if (!categories.has(op.category)) {
            categories.set(op.category, { listed: 0, notListed: 0 });
        }
        const cat = categories.get(op.category)!;
        if (op.listed) {
            cat.listed++;
        } else {
            cat.notListed++;
        }
    }

    lines.push('## Summary');
    lines.push('');
    lines.push('| Category | Listed | Total |');
    lines.push('| --- | --- | --- |');
    let totalListed = 0;
    let totalAll = 0;
    for (const [cat, counts] of categories) {
        const total = counts.listed + counts.notListed;
        totalListed += counts.listed;
        totalAll += total;
        lines.push(`| ${escapeTableCell(cat)} | ${counts.listed} | ${total} |`);
    }
    lines.push(`| **Total** | **${totalListed}** | **${totalAll}** |`);
    lines.push('');

    // Per-category sections with structured operator entries
    const categoriesInOrder = [...categories.keys()];
    for (const cat of categoriesInOrder) {
        const catOps = operators.filter((op) => op.category === cat && op.listed);
        if (catOps.length === 0) continue;

        lines.push(`## ${cat}`);
        lines.push('');

        for (const op of catOps) {
            lines.push(`### ${op.operator}`);
            lines.push('');
            if (op.description) {
                lines.push(`- **Description:** ${op.description}`);
            }
            if (op.syntax) {
                lines.push('- **Syntax:**');
                lines.push('');
                lines.push('```javascript');
                lines.push(op.syntax);
                lines.push('```');
                lines.push('');
            }
            if (op.docLink) {
                lines.push(`- **Doc Link:** ${op.docLink}`);
            }
            lines.push('');
        }
    }

    // Not-listed operators section
    const notListed = operators.filter((op) => !op.listed);
    if (notListed.length > 0) {
        lines.push('## Not Listed');
        lines.push('');
        lines.push('Operators below are present on the compatibility page but are not in scope');
        lines.push('for this package (deprecated or not available in DocumentDB).');
        lines.push('');
        for (const op of notListed) {
            lines.push(`- **${op.operator}** (${op.category}) — ${op.notListedReason || 'Not in scope'}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    console.log('DocumentDB Operator Documentation Scraper');
    console.log('=========================================');
    console.log('');

    // Phase 0: Verification
    const verification = await runVerification();
    if (!verification.passed) {
        console.error('Aborting due to verification failure.');
        console.error('If the documentation structure has changed, update the scraper accordingly.');
        process.exit(1);
    }

    // Phase 1: Fetch and parse compatibility page
    console.log('  Phase 1: Fetching compatibility page...');
    const compatContent = await fetchText(COMPAT_PAGE_URL);
    if (!compatContent) {
        console.error('ERROR: Could not fetch compatibility page');
        process.exit(1);
    }
    console.log(`  Fetched ${(compatContent.length / 1024).toFixed(1)} KB`);

    const operators = parseCompatibilityTables(compatContent);
    const listed = operators.filter((op) => op.listed);
    const notListed = operators.filter((op) => !op.listed);
    console.log(`  Parsed ${operators.length} operators (${listed.length} listed, ${notListed.length} not listed)`);
    console.log('');

    // Phase 2: Fetch per-operator docs
    await fetchOperatorDocs(operators);
    console.log('');

    // Phase 3: Generate dump
    console.log('  Phase 3: Generating operator-reference.md...');
    const dump = generateDump(operators);

    const outputDir = path.join(__dirname, '..', 'resources');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, 'operator-reference.md');
    fs.writeFileSync(outputPath, dump, 'utf-8');

    console.log(`  Written to: ${outputPath}`);
    console.log(`  File size: ${(dump.length / 1024).toFixed(1)} KB`);
    console.log('');
    console.log('Done! Review the generated file and commit it to the repo.');
}

main().catch((err) => {
    console.error('Scraper failed:', err);
    process.exit(1);
});
