/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generates TypeScript operator data files from the scraped reference dump.
 *
 * Reads:
 *   resources/scraped/operator-reference.md    — scraped operator data (primary)
 *   resources/overrides/operator-overrides.md  — hand-written overrides (wins)
 *   resources/overrides/operator-snippets.md   — snippet templates per category
 *
 * Writes:
 *   src/queryOperators.ts, src/updateOperators.ts, src/expressionOperators.ts,
 *   src/accumulators.ts, src/windowOperators.ts, src/stages.ts,
 *   src/systemVariables.ts
 *
 * The override file uses the same Markdown format as the dump. Any field
 * specified in an override entry replaces the corresponding scraped value.
 * Omitted fields keep their scraped values.
 *
 * Snippets are resolved in order:
 *   1. Snippet override from operator-overrides.md  (highest priority)
 *   2. Per-operator snippet from operator-snippets.md
 *   3. DEFAULT snippet from operator-snippets.md  ({{VALUE}} → operator name)
 *   4. No snippet
 *
 * Usage:  npm run generate
 * Note:   This script overwrites the generated src/ files. Do NOT edit
 *         those files by hand — put corrections in the overrides/snippets
 *         files instead.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getDocLink } from '../src/docLinks';
import * as MetaTags from '../src/metaTags';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedOperator {
    value: string;
    description: string;
    syntax: string;
    docLink: string;
    category: string;
    snippetOverride?: string;
}

interface FileSpec {
    fileName: string;
    variableName: string;
    metaImport: string;
    metaValue: string;
    operators: ParsedOperator[];
    extraImports?: string;
}

// ---------------------------------------------------------------------------
// Category → meta tag mapping
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

/**
 * Maps META constant names (like 'META_EXPR_STRING') to their string values
 * (like 'expr:string') so we can call getDocLink() at generation time to
 * compare the computed URL against the dump's verified URL.
 */
const META_CONST_TO_VALUE: Record<string, string> = Object.fromEntries(
    Object.entries(MetaTags)
        .filter(([, v]) => typeof v === 'string')
        .map(([k, v]) => [k, v as string]),
);

// Category → output file mapping
const CATEGORY_TO_FILE: Record<string, string> = {
    'Comparison Query Operators': 'queryOperators',
    'Logical Query Operators': 'queryOperators',
    'Element Query Operators': 'queryOperators',
    'Evaluation Query Operators': 'queryOperators',
    'Geospatial Operators': 'queryOperators',
    'Array Query Operators': 'queryOperators',
    'Bitwise Query Operators': 'queryOperators',
    'Projection Operators': 'queryOperators',
    'Miscellaneous Query Operators': 'queryOperators',
    'Field Update Operators': 'updateOperators',
    'Array Update Operators': 'updateOperators',
    'Bitwise Update Operators': 'updateOperators',
    'Arithmetic Expression Operators': 'expressionOperators',
    'Array Expression Operators': 'expressionOperators',
    'Bitwise Operators': 'expressionOperators',
    'Boolean Expression Operators': 'expressionOperators',
    'Comparison Expression Operators': 'expressionOperators',
    'Data Size Operators': 'expressionOperators',
    'Date Expression Operators': 'expressionOperators',
    'Literal Expression Operator': 'expressionOperators',
    'Miscellaneous Operators': 'expressionOperators',
    'Object Expression Operators': 'expressionOperators',
    'Set Expression Operators': 'expressionOperators',
    'String Expression Operators': 'expressionOperators',
    'Timestamp Expression Operators': 'expressionOperators',
    'Trigonometry Expression Operators': 'expressionOperators',
    'Type Expression Operators': 'expressionOperators',
    'Conditional Expression Operators': 'expressionOperators',
    'Variable Expression Operators': 'expressionOperators',
    'Accumulators ($group, $bucket, $bucketAuto, $setWindowFields)': 'accumulators',
    'Accumulators (in Other Stages)': 'accumulators',
    'Window Operators': 'windowOperators',
    'Aggregation Pipeline Stages': 'stages',
    'Variables in Aggregation Expressions': 'systemVariables',
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parseDump(content: string): Map<string, ParsedOperator[]> {
    const lines = content.split('\n');
    const categorizedOps = new Map<string, ParsedOperator[]>();

    let currentCategory = '';
    let currentOp: Partial<ParsedOperator> | null = null;
    let inCodeBlock = false;
    let syntaxLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Track code blocks
        if (line.startsWith('```')) {
            if (inCodeBlock) {
                // End of code block
                inCodeBlock = false;
                if (currentOp) {
                    currentOp.syntax = syntaxLines.join('\n').trim();
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

        // H2 = category
        const h2Match = line.match(/^## (.+)$/);
        if (h2Match) {
            // Save previous operator
            if (currentOp && currentCategory) {
                saveOperator(categorizedOps, currentCategory, currentOp as ParsedOperator);
            }
            currentOp = null;

            const cat = h2Match[1].trim();
            if (cat === 'Summary' || cat === 'Not Listed') {
                currentCategory = '';
                continue;
            }
            currentCategory = cat;
            if (!categorizedOps.has(currentCategory)) {
                categorizedOps.set(currentCategory, []);
            }
            continue;
        }

        // H3 = operator
        const h3Match = line.match(/^### (.+)$/);
        if (h3Match && currentCategory) {
            // Save previous operator
            if (currentOp) {
                saveOperator(categorizedOps, currentCategory, currentOp as ParsedOperator);
            }
            currentOp = {
                value: h3Match[1].trim(),
                description: '',
                syntax: '',
                docLink: '',
                category: currentCategory,
            };
            continue;
        }

        // Description line
        if (currentOp && line.startsWith('- **Description:**')) {
            currentOp.description = line.replace('- **Description:**', '').trim();
            continue;
        }

        // Doc link line ('none' means the scraper found no page at the expected location)
        if (currentOp && line.startsWith('- **Doc Link:**')) {
            const rawLink = line.replace('- **Doc Link:**', '').trim();
            currentOp.docLink = rawLink === 'none' ? '' : rawLink;
            continue;
        }
    }

    // Save last operator
    if (currentOp && currentCategory) {
        saveOperator(categorizedOps, currentCategory, currentOp as ParsedOperator);
    }

    return categorizedOps;
}

function saveOperator(map: Map<string, ParsedOperator[]>, category: string, op: Partial<ParsedOperator>): void {
    if (!op.value) return;
    const list = map.get(category) || [];
    list.push({
        value: op.value || '',
        description: op.description || '',
        syntax: op.syntax || '',
        docLink: op.docLink || '',
        category: category,
        snippetOverride: op.snippetOverride,
    });
    map.set(category, list);
}

// ---------------------------------------------------------------------------
// Override parsing and merging
// ---------------------------------------------------------------------------

interface OverrideEntry {
    description?: string;
    syntax?: string;
    docLink?: string;
    snippet?: string;
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

        if (currentOp && line.startsWith('- **Description:**')) {
            currentOp.entry.description = line.replace('- **Description:**', '').trim();
        }
        if (currentOp && line.startsWith('- **Doc Link:**')) {
            currentOp.entry.docLink = line.replace('- **Doc Link:**', '').trim();
        }
        if (currentOp && line.startsWith('- **Snippet:**')) {
            let snippet = line.replace('- **Snippet:**', '').trim();
            if (snippet.startsWith('`') && snippet.endsWith('`')) {
                snippet = snippet.slice(1, -1);
            }
            currentOp.entry.snippet = snippet;
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

function applyOverrides(
    categorizedOps: Map<string, ParsedOperator[]>,
    overrides: Map<string, Map<string, OverrideEntry>>,
): void {
    let applied = 0;
    let missed = 0;

    for (const [category, opOverrides] of overrides) {
        const ops = categorizedOps.get(category);
        if (!ops) {
            // Try to find operators across all categories (override category
            // may not match dump category exactly for cross-category operators)
            for (const [opName, override] of opOverrides) {
                let found = false;
                for (const [, catOps] of categorizedOps) {
                    const op = catOps.find((o) => o.value === opName);
                    if (op) {
                        mergeOverride(op, override);
                        applied++;
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    console.warn(`⚠️  Override target not found: ${opName} in "${category}"`);
                    missed++;
                }
            }
            continue;
        }

        for (const [opName, override] of opOverrides) {
            const op = ops.find((o) => o.value === opName);
            if (op) {
                mergeOverride(op, override);
                applied++;
            } else {
                console.warn(`⚠️  Override target not found: ${opName} in "${category}"`);
                missed++;
            }
        }
    }

    console.log(`  Applied ${applied} overrides (${missed} missed)`);
}

function mergeOverride(op: ParsedOperator, override: OverrideEntry): void {
    if (override.description !== undefined && override.description !== '') {
        op.description = override.description;
    }
    if (override.syntax !== undefined && override.syntax !== '') {
        op.syntax = override.syntax;
    }
    if (override.docLink !== undefined && override.docLink !== '') {
        op.docLink = override.docLink;
    }
    if (override.snippet !== undefined && override.snippet !== '') {
        op.snippetOverride = override.snippet;
    }
}

// ---------------------------------------------------------------------------
// Snippet loading (from resources/overrides/operator-snippets.md)
// ---------------------------------------------------------------------------

/**
 * Parses the operator-snippets.md file into a map of meta-tag → (operator|DEFAULT → snippet).
 * Uses the same heading conventions as the dump/overrides parsers.
 */
function parseSnippets(content: string): Map<string, Map<string, string>> {
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

        // H2 = category
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
                console.warn(`⚠️  Unknown snippet category: "${cat}"`);
            }
            currentOp = '';
            continue;
        }

        // H3 = operator name or DEFAULT
        const h3 = line.match(/^### (.+)$/);
        if (h3 && currentMeta) {
            currentOp = h3[1].trim();
            continue;
        }

        // Snippet value (backticks are stripped if present: `...` → ...)
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

/**
 * Looks up a snippet for an operator from the parsed snippets map.
 *
 * Resolution order:
 *   1. Exact operator match in the category
 *   2. DEFAULT entry in the category (with {{VALUE}} replaced by operator name)
 *   3. undefined (no snippet)
 */
function lookupSnippet(
    snippets: Map<string, Map<string, string>>,
    meta: string,
    operatorValue: string,
): string | undefined {
    const catSnippets = snippets.get(meta);
    if (!catSnippets) return undefined;

    // Exact operator match
    const exact = catSnippets.get(operatorValue);
    if (exact !== undefined) return exact;

    // Fall back to category DEFAULT
    const def = catSnippets.get('DEFAULT');
    if (def) return def.replace(/\{\{VALUE\}\}/g, operatorValue);

    return undefined;
}

// ---------------------------------------------------------------------------
// BSON type applicability
// ---------------------------------------------------------------------------

function getApplicableBsonTypes(op: ParsedOperator, meta: string): string[] | undefined {
    const v = op.value;

    // String-specific operators
    if (v === '$regex' || v === '$text') return ['string'];
    if (meta === 'META_EXPR_STRING' || meta === 'META_EXPR_TRIG') return undefined; // expression context, not filter-level

    // Array-specific operators (query context)
    if (meta === 'META_QUERY_ARRAY') return ['array'];

    // Bitwise query operators
    if (meta === 'META_QUERY_BITWISE') return ['int', 'long'];

    return undefined;
}

// ---------------------------------------------------------------------------
// Cross-reference: resolve missing doc links from other categories
// ---------------------------------------------------------------------------

/**
 * Builds a map of operator name → URL from all categories.
 * For operators that appear with a URL in ANY category, we can use that URL
 * when the same operator appears without one in a different category.
 *
 * Returns the number of operators whose links were inferred.
 */
function crossReferenceMissingLinks(categorizedOps: Map<string, ParsedOperator[]>): number {
    // Build global URL lookup: operator name → first known URL
    const urlLookup = new Map<string, string>();
    for (const ops of categorizedOps.values()) {
        for (const op of ops) {
            if (op.docLink && !urlLookup.has(op.value)) {
                urlLookup.set(op.value, op.docLink);
            }
        }
    }

    // Fill in missing links from the cross-reference
    let inferred = 0;
    for (const [category, ops] of categorizedOps.entries()) {
        for (const op of ops) {
            if (!op.docLink) {
                const altUrl = urlLookup.get(op.value);
                if (altUrl) {
                    op.docLink = altUrl;
                    // Mark as inferred so generateSection can annotate it
                    (op as ParsedOperator & { inferredLink?: boolean }).inferredLink = true;
                    inferred++;
                    console.log(`  Inferred link: ${op.value} (${category}) → ${altUrl}`);
                }
            }
        }
    }

    return inferred;
}

// ---------------------------------------------------------------------------
// File generation
// ---------------------------------------------------------------------------

function generateFileContent(specs: FileSpec[], snippets: Map<string, Map<string, string>>): string {
    const copyright = `/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// AUTO-GENERATED — DO NOT EDIT BY HAND
//
// Generated by: npm run generate  (scripts/generate-from-reference.ts)
// Sources:      resources/scraped/operator-reference.md
//               resources/overrides/operator-overrides.md
//               resources/overrides/operator-snippets.md
//
// To change operator data, edit the overrides/snippets files and re-run the generator.
`;

    // Collect all unique meta imports
    const allMetaImports = new Set<string>();
    for (const spec of specs) {
        allMetaImports.add(spec.metaImport);
    }

    const metaImportsList = [...allMetaImports].sort().join(',\n    ');

    // Pre-generate all sections so we can detect whether getDocLink is used
    const sections: string[] = [];
    for (const spec of specs) {
        sections.push(generateSection(spec, snippets));
    }
    const sectionsStr = sections.join('\n');

    // Only import getDocLink if at least one operator uses it in this file
    const needsDocLink = sectionsStr.includes('getDocLink(');
    const docLinkImport = needsDocLink ? `\nimport { getDocLink } from './docLinks';` : '';

    let content = `${copyright}
import { type OperatorEntry } from './types';
import { ${metaImportsList} } from './metaTags';${docLinkImport}
import { registerOperators } from './getFilteredCompletions';

`;

    content += sectionsStr;

    // Registration call
    const allVarNames = specs.map((s) => `...${s.variableName}`).join(',\n    ');
    content += `// ---------------------------------------------------------------------------\n`;
    content += `// Registration\n`;
    content += `// ---------------------------------------------------------------------------\n\n`;
    content += `registerOperators([\n    ${allVarNames},\n]);\n`;

    return content;
}

function generateSection(spec: FileSpec, snippets: Map<string, Map<string, string>>): string {
    let section = `// ---------------------------------------------------------------------------\n`;
    section += `// ${spec.operators[0]?.category || spec.variableName}\n`;
    section += `// ---------------------------------------------------------------------------\n\n`;

    section += `const ${spec.variableName}: readonly OperatorEntry[] = [\n`;

    // Resolve the meta tag's string value for runtime getDocLink comparison
    const metaStringValue = META_CONST_TO_VALUE[spec.metaImport] || '';

    for (const op of spec.operators) {
        const snippet = op.snippetOverride || lookupSnippet(snippets, spec.metaImport, op.value);
        const bsonTypes = getApplicableBsonTypes(op, spec.metaImport);

        // Determine the correct link emission strategy:
        // - If dump has a URL that matches what getDocLink() would produce → use getDocLink() (compact)
        // - If the URL was inferred via cross-reference → emit hardcoded string with comment
        // - If dump has a URL that differs from getDocLink() → emit hardcoded string
        // - If dump has no URL → omit the link property
        const computedLink = getDocLink(op.value, metaStringValue);
        const dumpLink = op.docLink || '';
        const isInferred = (op as ParsedOperator & { inferredLink?: boolean }).inferredLink === true;
        let linkLine: string;
        if (!dumpLink) {
            // No documentation page exists — omit the link
            linkLine = '';
        } else if (isInferred) {
            // Link was inferred from another category via cross-reference
            linkLine = `        link: '${escapeString(dumpLink)}', // inferred from another category\n`;
        } else if (dumpLink === computedLink) {
            // The computed URL matches — use the compact getDocLink() call
            linkLine = `        link: getDocLink('${escapeString(op.value)}', ${spec.metaImport}),\n`;
        } else {
            // The dump has a verified URL that differs from getDocLink() — emit hardcoded
            linkLine = `        link: '${escapeString(dumpLink)}',\n`;
        }

        section += `    {\n`;
        section += `        value: '${escapeString(op.value)}',\n`;
        section += `        meta: ${spec.metaImport},\n`;
        section += `        description: '${escapeString(op.description)}',\n`;
        if (snippet) {
            section += `        snippet: '${escapeString(snippet)}',\n`;
        }
        if (linkLine) {
            section += linkLine;
        }
        if (bsonTypes) {
            section += `        applicableBsonTypes: [${bsonTypes.map((t) => `'${t}'`).join(', ')}],\n`;
        }
        section += `    },\n`;
    }

    section += `];\n\n`;
    return section;
}

function escapeString(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ---------------------------------------------------------------------------
// Group operators by file and generate
// ---------------------------------------------------------------------------

function buildFileSpecs(categorizedOps: Map<string, ParsedOperator[]>): Map<string, FileSpec[]> {
    const fileGroups = new Map<string, FileSpec[]>();

    // Track seen operators per file to deduplicate
    const seenPerFile = new Map<string, Set<string>>();

    for (const [category, ops] of categorizedOps) {
        const fileName = CATEGORY_TO_FILE[category];
        const metaConst = CATEGORY_TO_META[category];

        if (!fileName || !metaConst) {
            console.warn(`⚠️  No mapping for category: "${category}" (${ops.length} operators)`);
            continue;
        }

        if (!seenPerFile.has(fileName)) {
            seenPerFile.set(fileName, new Set());
        }
        const seen = seenPerFile.get(fileName)!;

        // Deduplicate operators (e.g., $elemMatch appears in both query:array and projection)
        const uniqueOps = ops.filter((op) => {
            if (seen.has(op.value + ':' + metaConst)) return false;
            seen.add(op.value + ':' + metaConst);
            return true;
        });

        if (uniqueOps.length === 0) continue;

        // Create a camelCase variable name from the category
        const varName = categoryToVarName(category);

        const spec: FileSpec = {
            fileName,
            variableName: varName,
            metaImport: metaConst,
            metaValue: metaConst,
            operators: uniqueOps,
        };

        if (!fileGroups.has(fileName)) {
            fileGroups.set(fileName, []);
        }
        fileGroups.get(fileName)!.push(spec);
    }

    return fileGroups;
}

function categoryToVarName(category: string): string {
    // "Comparison Query Operators" → "comparisonQueryOperators"
    // "Accumulators ($group, $bucket, $bucketAuto, $setWindowFields)" → "groupAccumulators"

    if (category === 'Accumulators ($group, $bucket, $bucketAuto, $setWindowFields)') {
        return 'groupAccumulators';
    }
    if (category === 'Accumulators (in Other Stages)') {
        return 'otherStageAccumulators';
    }
    if (category === 'Variables in Aggregation Expressions') {
        return 'systemVariables';
    }

    const words = category
        .replace(/[()$,]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 0);
    return words
        .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
        .join('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
    const dumpPath = path.join(__dirname, '..', 'resources', 'scraped', 'operator-reference.md');
    const overridePath = path.join(__dirname, '..', 'resources', 'overrides', 'operator-overrides.md');
    const snippetsPath = path.join(__dirname, '..', 'resources', 'overrides', 'operator-snippets.md');
    const srcDir = path.join(__dirname, '..', 'src');

    console.log('📖 Reading operator reference dump...');
    const content = fs.readFileSync(dumpPath, 'utf-8');

    console.log('🔍 Parsing operators...');
    const categorizedOps = parseDump(content);

    let totalOps = 0;
    for (const [cat, ops] of categorizedOps) {
        console.log(`  ${cat}: ${ops.length} operators`);
        totalOps += ops.length;
    }
    console.log(`  Total: ${totalOps} operators\n`);

    // Apply overrides if the file exists
    if (fs.existsSync(overridePath)) {
        console.log('📝 Reading overrides...');
        const overrideContent = fs.readFileSync(overridePath, 'utf-8');
        const overrides = parseOverrides(overrideContent);
        applyOverrides(categorizedOps, overrides);
        console.log('');
    } else {
        console.log('ℹ️  No overrides file found, skipping.\n');
    }

    // Cross-reference missing doc links from other categories
    console.log('🔗 Cross-referencing missing doc links...');
    const inferred = crossReferenceMissingLinks(categorizedOps);
    console.log(`  Inferred ${inferred} links from other categories\n`);

    // Load snippet templates
    let snippetsMap = new Map<string, Map<string, string>>();
    if (fs.existsSync(snippetsPath)) {
        console.log('📋 Reading snippet templates...');
        const snippetsContent = fs.readFileSync(snippetsPath, 'utf-8');
        snippetsMap = parseSnippets(snippetsContent);
        let snippetCount = 0;
        for (const [, catMap] of snippetsMap) {
            snippetCount += catMap.size;
        }
        console.log(`  Loaded ${snippetCount} snippet entries across ${snippetsMap.size} categories\n`);
    } else {
        console.log('ℹ️  No snippets file found, skipping.\n');
    }

    console.log('📁 Building file specs...');
    const fileGroups = buildFileSpecs(categorizedOps);

    for (const [fileName, specs] of fileGroups) {
        const filePath = path.join(srcDir, `${fileName}.ts`);
        console.log(
            `✍️  Generating ${fileName}.ts (${specs.reduce((n, s) => n + s.operators.length, 0)} operators)...`,
        );
        const fileContent = generateFileContent(specs, snippetsMap);
        fs.writeFileSync(filePath, fileContent, 'utf-8');
    }

    // Format generated files with Prettier
    const generatedFiles = [...fileGroups.keys()].map((f) => path.join(srcDir, `${f}.ts`));
    console.log('\n🎨 Formatting generated files with Prettier...');
    execSync(`npx prettier --write ${generatedFiles.map((f) => `"${f}"`).join(' ')}`, {
        stdio: 'inherit',
    });

    console.log('\n✅ Done! Generated files:');
    for (const [fileName, specs] of fileGroups) {
        const count = specs.reduce((n, s) => n + s.operators.length, 0);
        console.log(`  src/${fileName}.ts — ${count} operators`);
    }
}

main();
