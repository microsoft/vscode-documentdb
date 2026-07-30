/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * scrape-operator-docs.ts
 *
 * Scrapes the DocumentDB compatibility page and per-operator documentation
 * to generate the resources/scraped/operator-reference.md dump file.
 *
 * Usage:
 *   npx ts-node packages/documentdb-js-operator-registry/scripts/scrape-operator-docs.ts
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
    /** Documentation URL (derived from the directory where the .md file was found) */
    docLink?: string;
    /**
     * Human-readable note added when the scraper resolves a doc page from a
     * different directory than the operator's primary category, or when other
     * notable resolution decisions are made. Written to the dump as
     * `- **Scraper Comment:**` for traceability.
     */
    scraperComment?: string;
}

/**
 * A single row from the compatibility page's "Index types" or
 * "Index properties" tables.
 */
interface IndexEntry {
    /** Cleaned display name, e.g. "Single Field", "Wildcard", "TTL". */
    name: string;
    /** Description from the table's second column. */
    description: string;
    /** Whether DocumentDB supports it (derived from the "Supported" column). */
    supported: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPAT_PAGE_URL =
    'https://raw.githubusercontent.com/MicrosoftDocs/nosql-docs/main/azure/documentdb/compatibility-query-language.md';

const OPERATOR_DOC_BASE = 'https://raw.githubusercontent.com/MicrosoftDocs/nosql-docs/main/documentdb/query/operators';

const DOC_LINK_BASE = 'https://learn.microsoft.com/en-us/documentdb/query/operators';

/**
 * Maps category names (as they appear in column 1 of the compat page table)
 * to the docs directory used for per-operator doc pages.
 *
 * This mapping is derived from the operators TOC.yml in the nosql-docs repo.
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
    'Type Expression Operators': 'aggregation',
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

/** Maximum number of retry attempts for transient HTTP errors */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff (ms). Doubled on each retry. */
const BACKOFF_BASE_MS = 1000;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

interface FetchResult {
    content: string | null;
    /** Non-null when content is null — e.g. "404 Not Found" or "NetworkError: ..." */
    failReason?: string;
}

/**
 * Returns true for HTTP status codes that are transient and worth retrying:
 * - 429 Too Many Requests
 * - 5xx Server errors
 */
function isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
}

/**
 * Fetches a URL as text with exponential backoff for transient errors.
 *
 * Retries on 429 (rate-limited) and 5xx (server errors). Respects
 * Retry-After headers when present. Non-retryable failures (e.g., 404)
 * are returned immediately without retry.
 */
async function fetchText(url: string): Promise<FetchResult> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(url);

            if (response.ok) {
                return { content: await response.text() };
            }

            const reason = `${response.status} ${response.statusText}`;

            if (!isRetryableStatus(response.status)) {
                // Non-retryable (e.g., 404, 403) — fail immediately
                return { content: null, failReason: reason };
            }

            lastError = reason;

            // Calculate backoff: honour Retry-After header if present,
            // otherwise use exponential backoff
            const retryAfter = response.headers.get('Retry-After');
            let delayMs: number;
            if (retryAfter) {
                const seconds = Number(retryAfter);
                delayMs = Number.isNaN(seconds) ? BACKOFF_BASE_MS * 2 ** attempt : seconds * 1000;
            } else {
                delayMs = BACKOFF_BASE_MS * 2 ** attempt;
            }

            if (attempt < MAX_RETRIES) {
                console.log(
                    `\n  ⏳ ${reason} for ${url} — retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
                );
                await sleep(delayMs);
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            lastError = `NetworkError: ${msg}`;

            if (attempt < MAX_RETRIES) {
                const delayMs = BACKOFF_BASE_MS * 2 ** attempt;
                console.log(`\n  ⏳ ${lastError} — retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
                await sleep(delayMs);
            }
        }
    }

    return { content: null, failReason: lastError };
}

interface FetchJsonResult<T> {
    data: T | null;
    failReason?: string;
}

/**
 * Fetches a URL as JSON with exponential backoff for transient errors.
 * Same retry semantics as {@link fetchText}.
 */
async function fetchJson<T>(url: string): Promise<FetchJsonResult<T>> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(url);

            if (response.ok) {
                return { data: (await response.json()) as T };
            }

            const reason = `${response.status} ${response.statusText}`;

            if (!isRetryableStatus(response.status)) {
                return { data: null, failReason: reason };
            }

            lastError = reason;

            const retryAfter = response.headers.get('Retry-After');
            let delayMs: number;
            if (retryAfter) {
                const seconds = Number(retryAfter);
                delayMs = Number.isNaN(seconds) ? BACKOFF_BASE_MS * 2 ** attempt : seconds * 1000;
            } else {
                delayMs = BACKOFF_BASE_MS * 2 ** attempt;
            }

            if (attempt < MAX_RETRIES) {
                console.log(
                    `\n  ⏳ ${reason} for ${url} — retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
                );
                await sleep(delayMs);
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            lastError = `NetworkError: ${msg}`;

            if (attempt < MAX_RETRIES) {
                const delayMs = BACKOFF_BASE_MS * 2 ** attempt;
                console.log(`\n  ⏳ ${lastError} — retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
                await sleep(delayMs);
            }
        }
    }

    return { data: null, failReason: lastError };
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
        .replace(/\\/g, '\\\\')
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
    const compatResult = await fetchText(COMPAT_PAGE_URL);
    if (compatResult.content) {
        const hasTable = /\|.*\|.*\|/.test(compatResult.content);
        const hasOperators = /\$\w+/.test(compatResult.content);
        const passed = hasTable && hasOperators;
        checks.push({
            name: 'Compatibility page accessible & has tables + operators',
            passed,
            detail: passed
                ? `OK — ${(compatResult.content.length / 1024).toFixed(1)} KB, tables found`
                : `FAIL — tables: ${hasTable}, operators: ${hasOperators}`,
        });
    } else {
        checks.push({
            name: 'Compatibility page accessible',
            passed: false,
            detail: `FAIL — could not fetch ${COMPAT_PAGE_URL} (${compatResult.failReason})`,
        });
    }

    // Check 2: A known operator doc page exists ($match — aggregation stage)
    console.log('  [2/4] Fetching known operator page ($match)...');
    const matchUrl = `${OPERATOR_DOC_BASE}/aggregation/$match.md`;
    const matchResult = await fetchText(matchUrl);
    if (matchResult.content) {
        const hasDescription = extractDescription(matchResult.content) !== undefined;
        checks.push({
            name: '$match doc page has YAML frontmatter with description',
            passed: hasDescription,
            detail: hasDescription
                ? `OK — description: "${extractDescription(matchResult.content)}"`
                : 'FAIL — no description in frontmatter',
        });
    } else {
        checks.push({
            name: '$match doc page accessible',
            passed: false,
            detail: `FAIL — could not fetch ${matchUrl} (${matchResult.failReason})`,
        });
    }

    // Check 3: A known query operator doc page exists ($eq — comparison query)
    console.log('  [3/4] Fetching known operator page ($eq)...');
    const eqUrl = `${OPERATOR_DOC_BASE}/comparison-query/$eq.md`;
    const eqResult = await fetchText(eqUrl);
    if (eqResult.content) {
        const desc = extractDescription(eqResult.content);
        const syntax = extractSyntax(eqResult.content);
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
            detail: `FAIL — could not fetch ${eqUrl} (${eqResult.failReason})`,
        });
    }

    // Check 4: A known accumulator doc page exists ($sum)
    console.log('  [4/4] Fetching known operator page ($sum)...');
    const sumUrl = `${OPERATOR_DOC_BASE}/accumulators/$sum.md`;
    const sumResult = await fetchText(sumUrl);
    if (sumResult.content) {
        const desc = extractDescription(sumResult.content);
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
            detail: `FAIL — could not fetch ${sumUrl} (${sumResult.failReason})`,
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
// Phase 1b: Index types & properties extraction
// ---------------------------------------------------------------------------

/**
 * Extracts the Markdown text of a `## <heading>` section, up to the next
 * `## ` heading (or end of document). Returns undefined if not found.
 */
function extractSection(markdown: string, heading: string): string | undefined {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
    if (start === -1) return undefined;

    const body: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
        if (/^##\s/.test(lines[i])) break;
        body.push(lines[i]);
    }
    return body.join('\n');
}

/**
 * Parses a simple 3-column Markdown table (Name | Description | Supported)
 * into rows of trimmed cells. Handles rows that upstream wrapped across two
 * lines (e.g. the Vector index row) by accumulating physical lines until a
 * full 3-column row (4 pipes) has been collected.
 */
function parseThreeColumnTable(sectionText: string): string[][] {
    const rows: string[][] = [];
    let buffer = '';

    for (const raw of sectionText.split('\n')) {
        const line = raw.trim();
        if (!line.startsWith('|')) {
            buffer = '';
            continue;
        }

        // Direct concatenation preserves the cell separator: a wrapped row's
        // continuation line begins with the `|` that terminates the prior cell.
        buffer += line;
        if ((buffer.match(/\|/g)?.length ?? 0) < 4) {
            // Not a complete 3-column row yet — wait for the continuation line.
            continue;
        }

        const cells = buffer
            .split('|')
            .map((c) => c.trim())
            .filter((c) => c.length > 0);
        buffer = '';

        if (cells.length < 3) continue;
        // Skip the header separator row (| --- | --- | --- |).
        if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
        rows.push(cells);
    }

    return rows;
}

/** Strips markdown links, keeping the link text: `[text](url)` -> `text`. */
function stripMarkdownLinks(text: string): string {
    return text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}

/** Cleans an index-type display name: drops the trailing "Index" and any parenthetical. */
function cleanIndexTypeName(raw: string): string {
    return raw
        .replace(/\s*\([^)]*\)/g, '')
        .replace(/\s+Index(es)?$/i, '')
        .trim();
}

/**
 * Cleans an index-property display name. Prefers a parenthetical acronym when
 * present (e.g. "time-to-live (TTL)" -> "TTL"), otherwise returns the trimmed
 * text with any parenthetical removed.
 */
function cleanIndexPropertyName(raw: string): string {
    const acronym = raw.match(/\(([^)]+)\)/);
    if (acronym) return acronym[1].trim();
    return raw.replace(/\s*\([^)]*\)/g, '').trim();
}

/** Returns true when a "Supported" cell indicates support (✅ / "Yes"). */
function isSupportedCell(cell: string): boolean {
    const normalized = cell.toLowerCase();
    return cell.includes('✅') || (normalized.includes('yes') && !normalized.includes('no'));
}

/**
 * Parses the "Index types" and "Index properties" sections of the
 * compatibility page into structured entries.
 */
function parseIndexTables(markdown: string): { types: IndexEntry[]; properties: IndexEntry[] } {
    const parseSection = (heading: string, cleanName: (raw: string) => string): IndexEntry[] => {
        const section = extractSection(markdown, heading);
        if (!section) return [];

        const entries: IndexEntry[] = [];
        for (const cells of parseThreeColumnTable(section)) {
            const name = cleanName(stripMarkdownLinks(cells[0]));
            // Skip the header row (first column literally "Index" / "Index Property").
            if (!name || /^Index( Property)?$/i.test(name)) continue;
            entries.push({
                name,
                description: stripMarkdownLinks(cells[1]).trim(),
                supported: isSupportedCell(cells[2]),
            });
        }
        return entries;
    };

    return {
        types: parseSection('Index types', cleanIndexTypeName),
        properties: parseSection('Index properties', cleanIndexPropertyName),
    };
}

/**
 * Generates the resources/scraped/index-reference.md dump for index types and
 * properties.
 */
function generateIndexDump(index: { types: IndexEntry[]; properties: IndexEntry[] }): string {
    const now = new Date().toISOString().split('T')[0];
    const lines: string[] = [];

    lines.push('# DocumentDB Index Reference');
    lines.push('');
    lines.push('<!-- AUTO-GENERATED by scrape-operator-docs.ts -->');
    lines.push(`<!-- Last scraped: ${now} -->`);
    lines.push('<!-- Source: https://github.com/MicrosoftDocs/nosql-docs -->');
    lines.push('');

    const emitTable = (heading: string, entries: IndexEntry[]): void => {
        lines.push(`## ${heading}`);
        lines.push('');
        lines.push('| Name | Description | Supported |');
        lines.push('| --- | --- | --- |');
        for (const e of entries) {
            lines.push(
                `| ${escapeTableCell(e.name)} | ${escapeTableCell(e.description)} | ${e.supported ? 'Yes' : 'No'} |`,
            );
        }
        lines.push('');
    };

    emitTable('Index Types', index.types);
    emitTable('Index Properties', index.properties);

    return lines.join('\n');
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
    const GITHUB_API_BASE = 'https://api.github.com/repos/MicrosoftDocs/nosql-docs/contents/documentdb/query/operators';

    type GithubEntry = { name: string; type: string };
    const index = new Map<string, string>();

    const rootResult = await fetchJson<GithubEntry[]>(GITHUB_API_BASE);
    if (!rootResult.data) {
        console.log(
            `  ⚠ Could not fetch directory listing from GitHub API — skipping global index (${rootResult.failReason})`,
        );
        return index;
    }

    const dirs = rootResult.data.filter((d) => d.type === 'dir' && d.name !== 'includes');

    for (const dir of dirs) {
        await sleep(300); // Rate limit GitHub API

        const dirResult = await fetchJson<GithubEntry[]>(`${GITHUB_API_BASE}/${dir.name}`);
        if (!dirResult.data) continue;

        const files = dirResult.data.filter((f) => f.name.endsWith('.md'));
        const subdirs = dirResult.data.filter((f) => f.type === 'dir');

        for (const file of files) {
            index.set(file.name.toLowerCase(), dir.name);
        }

        // Also check any subdirectories (defensive — the operators tree is
        // currently flat in nosql-docs, but this keeps the crawl future-proof).
        for (const sub of subdirs) {
            await sleep(300);

            const subResult = await fetchJson<GithubEntry[]>(`${GITHUB_API_BASE}/${dir.name}/${sub.name}`);
            if (!subResult.data) continue;

            for (const file of subResult.data.filter((f) => f.name.endsWith('.md'))) {
                index.set(file.name.toLowerCase(), `${dir.name}/${sub.name}`);
            }
        }
    }

    return index;
}

interface FetchOperatorDocsResult {
    failureDetails: { operator: string; category: string; reason: string }[];
}

async function fetchOperatorDocs(operators: OperatorInfo[]): Promise<FetchOperatorDocsResult> {
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

    const failureDetails: { operator: string; category: string; reason: string }[] = [];

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
            let lastFailReason: string | undefined;

            if (primaryDir) {
                const result = await fetchText(`${OPERATOR_DOC_BASE}/${primaryDir}/${opNameLower}.md`);
                if (result.content) {
                    content = result.content;
                    resolvedDir = primaryDir;
                } else {
                    lastFailReason = result.failReason;
                    if (opNameLower !== opNameOriginal) {
                        const result2 = await fetchText(`${OPERATOR_DOC_BASE}/${primaryDir}/${opNameOriginal}.md`);
                        if (result2.content) {
                            content = result2.content;
                            resolvedDir = primaryDir;
                        } else {
                            lastFailReason = result2.failReason;
                        }
                    }
                }
            }

            // Fallback: check global index for a different directory
            if (!content && globalIndex.has(opFileName)) {
                const fallbackDir = globalIndex.get(opFileName)!;
                if (fallbackDir !== primaryDir) {
                    const result3 = await fetchText(`${OPERATOR_DOC_BASE}/${fallbackDir}/${opFileName}`);
                    if (result3.content) {
                        content = result3.content;
                        resolvedDir = fallbackDir;
                    } else {
                        lastFailReason = result3.failReason;
                    }
                }
            }

            if (content) {
                op.description = extractDescription(content);
                op.syntax = extractSyntax(content);

                if (primaryDir && resolvedDir !== primaryDir) {
                    // Doc page found in a different directory — emit 'none'
                    // so the generator can cross-reference alternative URLs.
                    // Description/syntax were still scraped from the fallback page.
                    op.docLink = 'none';
                    op.scraperComment =
                        `Doc page not found in expected directory '${primaryDir}/'. ` +
                        `Content scraped from '${resolvedDir}/'.`;
                } else {
                    op.docLink = `${DOC_LINK_BASE}/${resolvedDir}/${opNameLower}`;
                }
                succeeded++;
            } else {
                failureDetails.push({
                    operator: op.operator,
                    category: op.category,
                    reason: lastFailReason ?? 'Unknown',
                });
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
        console.log('');

        // Group failures by reason for a clear summary
        const byReason = new Map<string, typeof failureDetails>();
        for (const f of failureDetails) {
            const list = byReason.get(f.reason) ?? [];
            list.push(f);
            byReason.set(f.reason, list);
        }

        for (const [reason, ops] of byReason) {
            console.log(`  [${reason}] (${ops.length} operators):`);
            for (const f of ops) {
                const dir = getCategoryDir(f.category) || '???';
                const fallback = globalIndex.get(f.operator.toLowerCase() + '.md');
                const extra = fallback && fallback !== dir ? ` (also tried ${fallback})` : '';
                console.log(`     - ${f.operator} (${f.category} → ${dir}${extra})`);
            }
            console.log('');
        }
    }

    return { failureDetails };
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
    lines.push('<!-- Source: https://github.com/MicrosoftDocs/nosql-docs -->');
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
            if (op.scraperComment) {
                lines.push(`- **Scraper Comment:** ${op.scraperComment}`);
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
    const compatResult = await fetchText(COMPAT_PAGE_URL);
    if (!compatResult.content) {
        console.error(`ERROR: Could not fetch compatibility page (${compatResult.failReason})`);
        process.exit(1);
    }
    console.log(`  Fetched ${(compatResult.content.length / 1024).toFixed(1)} KB`);

    const operators = parseCompatibilityTables(compatResult.content);
    const listed = operators.filter((op) => op.listed);
    const notListed = operators.filter((op) => !op.listed);
    console.log(`  Parsed ${operators.length} operators (${listed.length} listed, ${notListed.length} not listed)`);
    console.log('');

    // Phase 2: Fetch per-operator docs
    const { failureDetails } = await fetchOperatorDocs(operators);
    console.log('');

    // Fail immediately on network errors (transient connectivity problems that
    // exhaust all retries). 404s are expected for operators without dedicated
    // doc pages and do not abort the run.
    const networkFailures = failureDetails.filter((f) => f.reason.startsWith('NetworkError:'));
    if (networkFailures.length > 0) {
        console.error(`ERROR: ${networkFailures.length} operator(s) failed due to network errors (not 404). Aborting.`);
        for (const f of networkFailures) {
            console.error(`  - ${f.operator} (${f.category}): ${f.reason}`);
        }
        process.exit(1);
    }

    // Phase 3: Generate dump
    console.log('  Phase 3: Generating scraped/operator-reference.md...');
    const dump = generateDump(operators);

    const outputDir = path.join(__dirname, '..', 'resources', 'scraped');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, 'operator-reference.md');
    fs.writeFileSync(outputPath, dump, 'utf-8');

    console.log(`  Written to: ${outputPath}`);
    console.log(`  File size: ${(dump.length / 1024).toFixed(1)} KB`);
    console.log('');

    // Phase 3b: Parse & generate the index types/properties dump from the same
    // compatibility page content (no extra fetch needed).
    console.log('  Phase 3b: Generating scraped/index-reference.md...');
    const index = parseIndexTables(compatResult.content);
    console.log(`  Parsed ${index.types.length} index types, ${index.properties.length} index properties`);
    const indexDump = generateIndexDump(index);
    const indexOutputPath = path.join(outputDir, 'index-reference.md');
    fs.writeFileSync(indexOutputPath, indexDump, 'utf-8');
    console.log(`  Written to: ${indexOutputPath}`);
    console.log('');
    console.log('Done! Review the generated files and commit them to the repo.');
}

main().catch((err) => {
    console.error('Scraper failed:', err);
    process.exit(1);
});
