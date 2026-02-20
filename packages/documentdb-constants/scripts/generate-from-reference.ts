/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generates TypeScript operator data files from the scraped reference dump.
 *
 * Reads:
 *   resources/operator-reference-scraped.md   — scraped operator data (primary)
 *   resources/operator-reference-overrides.md — hand-written overrides (wins)
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
 * Usage:  npm run generate
 * Note:   This script overwrites the generated src/ files. Do NOT edit
 *         those files by hand — put corrections in the overrides file instead.
 */

import * as fs from 'fs';
import * as path from 'path';

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
    'Variable Expression Operators': 'META_EXPR_VARIABLE',
    'Window Operators': 'META_WINDOW',
    'Conditional Expression Operators': 'META_EXPR_CONDITIONAL',
    'Aggregation Pipeline Stages': 'META_STAGE',
    'Variables in Aggregation Expressions': 'META_VARIABLE',
};

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

        // Doc link line
        if (currentOp && line.startsWith('- **Doc Link:**')) {
            currentOp.docLink = line.replace('- **Doc Link:**', '').trim();
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
            currentOp.entry.snippet = line.replace('- **Snippet:**', '').trim();
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
// Snippet generation
// ---------------------------------------------------------------------------

function generateSnippet(op: ParsedOperator, meta: string): string | undefined {
    const v = op.value;

    // System variables don't need snippets
    if (meta === 'META_VARIABLE') return undefined;

    // Stages: wrap in { $stage: { ... } }
    if (meta === 'META_STAGE') {
        return getStageSinppet(v);
    }

    // Query comparison operators: { $op: value }
    if (meta === 'META_QUERY_COMPARISON') {
        if (v === '$in' || v === '$nin') {
            return `{ ${v}: [\${1:value}] }`;
        }
        return `{ ${v}: \${1:value} }`;
    }

    // Logical query operators
    if (meta === 'META_QUERY_LOGICAL') {
        if (v === '$not') {
            return `{ ${v}: { \${1:expression} } }`;
        }
        return `{ ${v}: [{ \${1:expression} }] }`;
    }

    // Element query operators
    if (meta === 'META_QUERY_ELEMENT') {
        if (v === '$exists') return `{ ${v}: \${1:true} }`;
        if (v === '$type') return `{ ${v}: "\${1:type}" }`;
        return undefined;
    }

    // Evaluation query operators
    if (meta === 'META_QUERY_EVALUATION') {
        if (v === '$expr') return `{ ${v}: { \${1:expression} } }`;
        if (v === '$regex') return `{ ${v}: /\${1:pattern}/ }`;
        if (v === '$mod') return `{ ${v}: [\${1:divisor}, \${2:remainder}] }`;
        if (v === '$text') return `{ ${v}: { \\$search: "\${1:text}" } }`;
        if (v === '$jsonSchema') return `{ ${v}: { bsonType: "\${1:object}" } }`;
        return undefined;
    }

    // Array query operators
    if (meta === 'META_QUERY_ARRAY') {
        if (v === '$all') return `{ ${v}: [\${1:value}] }`;
        if (v === '$elemMatch') return `{ ${v}: { \${1:query} } }`;
        if (v === '$size') return `{ ${v}: \${1:number} }`;
        return undefined;
    }

    // Bitwise query operators
    if (meta === 'META_QUERY_BITWISE') {
        return `{ ${v}: \${1:bitmask} }`;
    }

    // Geospatial operators
    if (meta === 'META_QUERY_GEOSPATIAL') {
        if (v === '$near' || v === '$nearSphere') {
            return `{ ${v}: { \\$geometry: { type: "Point", coordinates: [\${1:lng}, \${2:lat}] }, \\$maxDistance: \${3:distance} } }`;
        }
        if (v === '$geoIntersects' || v === '$geoWithin') {
            return `{ ${v}: { \\$geometry: { type: "\${1:GeoJSON type}", coordinates: \${2:coordinates} } } }`;
        }
        if (v === '$box') return `[[\${1:bottomLeftX}, \${2:bottomLeftY}], [\${3:upperRightX}, \${4:upperRightY}]]`;
        if (v === '$center') return `[[\${1:x}, \${2:y}], \${3:radius}]`;
        if (v === '$centerSphere') return `[[\${1:x}, \${2:y}], \${3:radiusInRadians}]`;
        if (v === '$geometry') return `{ type: "\${1:Point}", coordinates: [\${2:coordinates}] }`;
        if (v === '$maxDistance' || v === '$minDistance') return `\${1:distance}`;
        if (v === '$polygon') return `[[\${1:x1}, \${2:y1}], [\${3:x2}, \${4:y2}], [\${5:x3}, \${6:y3}]]`;
        return undefined;
    }

    // Projection operators
    if (meta === 'META_QUERY_PROJECTION') {
        if (v === '$') return undefined; // Positional, no snippet
        if (v === '$elemMatch') return `{ ${v}: { \${1:query} } }`;
        if (v === '$slice') return `{ ${v}: \${1:number} }`;
        return undefined;
    }

    // Misc query operators
    if (meta === 'META_QUERY_MISC') {
        if (v === '$comment') return `{ ${v}: "\${1:comment}" }`;
        if (v === '$rand') return `{ ${v}: {} }`;
        if (v === '$natural') return `{ ${v}: \${1:1} }`;
        return undefined;
    }

    // Update field operators
    if (meta === 'META_UPDATE_FIELD') {
        if (v === '$rename') return `{ ${v}: { "\${1:oldField}": "\${2:newField}" } }`;
        if (v === '$currentDate') return `{ ${v}: { "\${1:field}": true } }`;
        return `{ ${v}: { "\${1:field}": \${2:value} } }`;
    }

    // Update array operators
    if (meta === 'META_UPDATE_ARRAY') {
        if (v === '$' || v === '$[]' || v === '$[identifier]') return undefined; // Positional, no snippet
        if (v === '$addToSet') return `{ ${v}: { "\${1:field}": \${2:value} } }`;
        if (v === '$pop') return `{ ${v}: { "\${1:field}": \${2:1} } }`;
        if (v === '$pull') return `{ ${v}: { "\${1:field}": \${2:condition} } }`;
        if (v === '$push') return `{ ${v}: { "\${1:field}": \${2:value} } }`;
        if (v === '$pullAll') return `{ ${v}: { "\${1:field}": [\${2:values}] } }`;
        if (v === '$each') return `{ ${v}: [\${1:values}] }`;
        if (v === '$position') return `{ ${v}: \${1:index} }`;
        if (v === '$slice') return `{ ${v}: \${1:number} }`;
        if (v === '$sort') return `{ ${v}: { "\${1:field}": \${2:1} } }`;
        return undefined;
    }

    // Bitwise update operator
    if (meta === 'META_UPDATE_BITWISE') {
        return `{ ${v}: { "\${1:field}": { "\${2:and|or|xor}": \${3:value} } } }`;
    }

    // Accumulators
    if (meta === 'META_ACCUMULATOR') {
        if (v === '$push' || v === '$addToSet') return `{ ${v}: "\${1:\\$field}" }`;
        if (v === '$mergeObjects') return `{ ${v}: "\${1:\\$field}" }`;
        if (v === '$count') return `{ ${v}: {} }`;
        if (v === '$bottom' || v === '$top')
            return `{ ${v}: { sortBy: { \${1:field}: \${2:1} }, output: "\${3:\\$field}" } }`;
        if (v === '$bottomN' || v === '$topN')
            return `{ ${v}: { n: \${1:number}, sortBy: { \${2:field}: \${3:1} }, output: "\${4:\\$field}" } }`;
        if (v === '$firstN' || v === '$lastN' || v === '$maxN' || v === '$minN')
            return `{ ${v}: { input: "\${1:\\$field}", n: \${2:number} } }`;
        if (v === '$percentile') return `{ ${v}: { input: "\${1:\\$field}", p: [\${2:0.5}], method: "approximate" } }`;
        if (v === '$median') return `{ ${v}: { input: "\${1:\\$field}", method: "approximate" } }`;
        if (v === '$stdDevPop' || v === '$stdDevSamp') return `{ ${v}: "\${1:\\$field}" }`;
        return `{ ${v}: "\${1:\\$field}" }`;
    }

    // Window operators
    if (meta === 'META_WINDOW') {
        if (v === '$shift') return `{ ${v}: { output: "\${1:\\$field}", by: \${2:1}, default: \${3:null} } }`;
        if (v === '$rank' || v === '$denseRank' || v === '$documentNumber') return `{ ${v}: {} }`;
        if (v === '$linearFill' || v === '$locf') return `{ ${v}: "\${1:\\$field}" }`;
        if (v === '$expMovingAvg') return `{ ${v}: { input: "\${1:\\$field}", N: \${2:number} } }`;
        if (v === '$derivative' || v === '$integral')
            return `{ ${v}: { input: "\${1:\\$field}", unit: "\${2:hour}" } }`;
        // Window accumulators use accumulator-style snippets
        return `{ ${v}: "\${1:\\$field}" }`;
    }

    // Expression operators — general patterns
    if (meta.startsWith('META_EXPR_')) {
        return getExpressionSnippet(v, meta);
    }

    return undefined;
}

function getExpressionSnippet(v: string, meta: string): string | undefined {
    // Arithmetic
    if (meta === 'META_EXPR_ARITH') {
        if (
            v === '$abs' ||
            v === '$ceil' ||
            v === '$floor' ||
            v === '$exp' ||
            v === '$ln' ||
            v === '$log10' ||
            v === '$sqrt' ||
            v === '$trunc'
        ) {
            return `{ ${v}: "\${1:\\$field}" }`;
        }
        if (v === '$add' || v === '$subtract' || v === '$multiply' || v === '$divide' || v === '$mod' || v === '$pow') {
            return `{ ${v}: ["\${1:\\$field1}", "\${2:\\$field2}"] }`;
        }
        if (v === '$log') return `{ ${v}: ["\${1:\\$number}", \${2:base}] }`;
        if (v === '$round') return `{ ${v}: ["\${1:\\$field}", \${2:place}] }`;
        return `{ ${v}: "\${1:\\$field}" }`;
    }

    // Array expressions
    if (meta === 'META_EXPR_ARRAY') {
        if (v === '$arrayElemAt') return `{ ${v}: ["\${1:\\$array}", \${2:index}] }`;
        if (v === '$arrayToObject') return `{ ${v}: "\${1:\\$array}" }`;
        if (v === '$concatArrays') return `{ ${v}: ["\${1:\\$array1}", "\${2:\\$array2}"] }`;
        if (v === '$filter')
            return `{ ${v}: { input: "\${1:\\$array}", as: "\${2:item}", cond: { \${3:expression} } } }`;
        if (v === '$first' || v === '$last') return `{ ${v}: "\${1:\\$array}" }`;
        if (v === '$in') return `{ ${v}: ["\${1:\\$field}", "\${2:\\$array}"] }`;
        if (v === '$indexOfArray') return `{ ${v}: ["\${1:\\$array}", "\${2:value}"] }`;
        if (v === '$isArray') return `{ ${v}: "\${1:\\$field}" }`;
        if (v === '$map') return `{ ${v}: { input: "\${1:\\$array}", as: "\${2:item}", in: { \${3:expression} } } }`;
        if (v === '$objectToArray') return `{ ${v}: "\${1:\\$object}" }`;
        if (v === '$range') return `{ ${v}: [\${1:start}, \${2:end}, \${3:step}] }`;
        if (v === '$reduce')
            return `{ ${v}: { input: "\${1:\\$array}", initialValue: \${2:0}, in: { \${3:expression} } } }`;
        if (v === '$reverseArray') return `{ ${v}: "\${1:\\$array}" }`;
        if (v === '$size') return `{ ${v}: "\${1:\\$array}" }`;
        if (v === '$slice') return `{ ${v}: ["\${1:\\$array}", \${2:n}] }`;
        if (v === '$sortArray') return `{ ${v}: { input: "\${1:\\$array}", sortBy: { \${2:field}: \${3:1} } } }`;
        if (v === '$zip') return `{ ${v}: { inputs: ["\${1:\\$array1}", "\${2:\\$array2}"] } }`;
        if (v === '$maxN' || v === '$minN' || v === '$firstN' || v === '$lastN')
            return `{ ${v}: { input: "\${1:\\$array}", n: \${2:number} } }`;
        return `{ ${v}: "\${1:\\$array}" }`;
    }

    // Boolean expressions
    if (meta === 'META_EXPR_BOOL') {
        if (v === '$not') return `{ ${v}: ["\${1:expression}"] }`;
        return `{ ${v}: ["\${1:expression1}", "\${2:expression2}"] }`;
    }

    // Comparison expressions
    if (meta === 'META_EXPR_COMPARISON') {
        return `{ ${v}: ["\${1:\\$field1}", "\${2:\\$field2}"] }`;
    }

    // Conditional expressions
    if (meta === 'META_EXPR_CONDITIONAL') {
        if (v === '$cond')
            return `{ ${v}: { if: { \${1:expression} }, then: \${2:trueValue}, else: \${3:falseValue} } }`;
        if (v === '$ifNull') return `{ ${v}: ["\${1:\\$field}", \${2:replacement}] }`;
        if (v === '$switch')
            return `{ ${v}: { branches: [{ case: { \${1:expression} }, then: \${2:value} }], default: \${3:defaultValue} } }`;
        return undefined;
    }

    // Date expressions
    if (meta === 'META_EXPR_DATE') {
        if (v === '$dateAdd' || v === '$dateSubtract')
            return `{ ${v}: { startDate: "\${1:\\$dateField}", unit: "\${2:day}", amount: \${3:1} } }`;
        if (v === '$dateDiff')
            return `{ ${v}: { startDate: "\${1:\\$startDate}", endDate: "\${2:\\$endDate}", unit: "\${3:day}" } }`;
        if (v === '$dateFromParts') return `{ ${v}: { year: \${1:2024}, month: \${2:1}, day: \${3:1} } }`;
        if (v === '$dateToParts') return `{ ${v}: { date: "\${1:\\$dateField}" } }`;
        if (v === '$dateFromString') return `{ ${v}: { dateString: "\${1:dateString}" } }`;
        if (v === '$dateToString') return `{ ${v}: { format: "\${1:%Y-%m-%d}", date: "\${2:\\$dateField}" } }`;
        if (v === '$dateTrunc') return `{ ${v}: { date: "\${1:\\$dateField}", unit: "\${2:day}" } }`;
        if (v === '$toDate') return `{ ${v}: "\${1:\\$field}" }`;
        // Date part extractors: $year, $month, $dayOfMonth, etc.
        return `{ ${v}: "\${1:\\$dateField}" }`;
    }

    // Object expressions
    if (meta === 'META_EXPR_OBJECT') {
        if (v === '$mergeObjects') return `{ ${v}: ["\${1:\\$object1}", "\${2:\\$object2}"] }`;
        if (v === '$objectToArray') return `{ ${v}: "\${1:\\$object}" }`;
        if (v === '$setField')
            return `{ ${v}: { field: "\${1:fieldName}", input: "\${2:\\$object}", value: \${3:value} } }`;
        return `{ ${v}: "\${1:\\$object}" }`;
    }

    // Set expressions
    if (meta === 'META_EXPR_SET') {
        if (v === '$setIsSubset') return `{ ${v}: ["\${1:\\$set1}", "\${2:\\$set2}"] }`;
        if (v === '$anyElementTrue' || v === '$allElementsTrue') return `{ ${v}: ["\${1:\\$array}"] }`;
        return `{ ${v}: ["\${1:\\$set1}", "\${2:\\$set2}"] }`;
    }

    // String expressions
    if (meta === 'META_EXPR_STRING') {
        if (v === '$concat') return `{ ${v}: ["\${1:\\$string1}", "\${2:\\$string2}"] }`;
        if (v === '$indexOfBytes' || v === '$indexOfCP') return `{ ${v}: ["\${1:\\$string}", "\${2:substring}"] }`;
        if (v === '$regexFind' || v === '$regexFindAll' || v === '$regexMatch')
            return `{ ${v}: { input: "\${1:\\$string}", regex: "\${2:pattern}" } }`;
        if (v === '$replaceOne' || v === '$replaceAll')
            return `{ ${v}: { input: "\${1:\\$string}", find: "\${2:find}", replacement: "\${3:replacement}" } }`;
        if (v === '$split') return `{ ${v}: ["\${1:\\$string}", "\${2:delimiter}"] }`;
        if (v === '$substr' || v === '$substrBytes' || v === '$substrCP')
            return `{ ${v}: ["\${1:\\$string}", \${2:start}, \${3:length}] }`;
        if (v === '$strcasecmp') return `{ ${v}: ["\${1:\\$string1}", "\${2:\\$string2}"] }`;
        if (v === '$trim' || v === '$ltrim' || v === '$rtrim') return `{ ${v}: { input: "\${1:\\$string}" } }`;
        return `{ ${v}: "\${1:\\$string}" }`;
    }

    // Trig expressions
    if (meta === 'META_EXPR_TRIG') {
        if (v === '$degreesToRadians' || v === '$radiansToDegrees') return `{ ${v}: "\${1:\\$angle}" }`;
        return `{ ${v}: "\${1:\\$value}" }`;
    }

    // Type expressions
    if (meta === 'META_EXPR_TYPE') {
        if (v === '$convert') return `{ ${v}: { input: "\${1:\\$field}", to: "\${2:type}" } }`;
        if (v === '$type') return `{ ${v}: "\${1:\\$field}" }`;
        return `{ ${v}: "\${1:\\$field}" }`;
    }

    // Data size
    if (meta === 'META_EXPR_DATASIZE') {
        return `{ ${v}: "\${1:\\$field}" }`;
    }

    // Timestamp
    if (meta === 'META_EXPR_TIMESTAMP') {
        return `{ ${v}: "\${1:\\$timestampField}" }`;
    }

    // Bitwise expressions
    if (meta === 'META_EXPR_BITWISE') {
        if (v === '$bitNot') return `{ ${v}: "\${1:\\$field}" }`;
        return `{ ${v}: [\${1:value1}, \${2:value2}] }`;
    }

    // Literal
    if (meta === 'META_EXPR_LITERAL') {
        return `{ ${v}: \${1:value} }`;
    }

    // Misc expressions
    if (meta === 'META_EXPR_MISC') {
        if (v === '$getField') return `{ ${v}: { field: "\${1:fieldName}", input: "\${2:\\$object}" } }`;
        if (v === '$rand') return `{ ${v}: {} }`;
        if (v === '$sampleRate') return `{ ${v}: \${1:0.5} }`;
        return `{ ${v}: \${1:value} }`;
    }

    // Variable expression
    if (meta === 'META_EXPR_VARIABLE') {
        if (v === '$let') return `{ ${v}: { vars: { \${1:var}: \${2:expression} }, in: \${3:expression} } }`;
        return undefined;
    }

    return undefined;
}

function getStageSinppet(v: string): string | undefined {
    switch (v) {
        case '$match':
            return `{ ${v}: { \${1:query} } }`;
        case '$group':
            return `{ ${v}: { _id: "\${1:\\$field}", \${2:accumulator}: { \${3:\\$sum}: 1 } } }`;
        case '$project':
            return `{ ${v}: { \${1:field}: 1 } }`;
        case '$sort':
            return `{ ${v}: { \${1:field}: \${2:1} } }`;
        case '$limit':
            return `{ ${v}: \${1:number} }`;
        case '$skip':
            return `{ ${v}: \${1:number} }`;
        case '$unwind':
            return `{ ${v}: "\${1:\\$arrayField}" }`;
        case '$lookup':
            return `{ ${v}: { from: "\${1:collection}", localField: "\${2:field}", foreignField: "\${3:field}", as: "\${4:result}" } }`;
        case '$addFields':
            return `{ ${v}: { \${1:newField}: \${2:expression} } }`;
        case '$set':
            return `{ ${v}: { \${1:field}: \${2:expression} } }`;
        case '$unset':
            return `{ ${v}: "\${1:field}" }`;
        case '$replaceRoot':
            return `{ ${v}: { newRoot: "\${1:\\$field}" } }`;
        case '$replaceWith':
            return `{ ${v}: "\${1:\\$field}" }`;
        case '$count':
            return `{ ${v}: "\${1:countField}" }`;
        case '$out':
            return `{ ${v}: "\${1:collection}" }`;
        case '$merge':
            return `{ ${v}: { into: "\${1:collection}" } }`;
        case '$bucket':
            return `{ ${v}: { groupBy: "\${1:\\$field}", boundaries: [\${2:values}], default: "\${3:Other}" } }`;
        case '$bucketAuto':
            return `{ ${v}: { groupBy: "\${1:\\$field}", buckets: \${2:number} } }`;
        case '$facet':
            return `{ ${v}: { \${1:outputField}: [{ \${2:stage} }] } }`;
        case '$graphLookup':
            return `{ ${v}: { from: "\${1:collection}", startWith: "\${2:\\$field}", connectFromField: "\${3:field}", connectToField: "\${4:field}", as: "\${5:result}" } }`;
        case '$sample':
            return `{ ${v}: { size: \${1:number} } }`;
        case '$sortByCount':
            return `{ ${v}: "\${1:\\$field}" }`;
        case '$redact':
            return `{ ${v}: { \\$cond: { if: { \${1:expression} }, then: "\${2:\\$\\$DESCEND}", else: "\${3:\\$\\$PRUNE}" } } }`;
        case '$unionWith':
            return `{ ${v}: { coll: "\${1:collection}", pipeline: [\${2}] } }`;
        case '$setWindowFields':
            return `{ ${v}: { partitionBy: "\${1:\\$field}", sortBy: { \${2:field}: \${3:1} }, output: { \${4:newField}: { \${5:windowFunc} } } } }`;
        case '$densify':
            return `{ ${v}: { field: "\${1:field}", range: { step: \${2:1}, bounds: "full" } } }`;
        case '$fill':
            return `{ ${v}: { output: { \${1:field}: { method: "\${2:linear}" } } } }`;
        case '$documents':
            return `{ ${v}: [\${1:documents}] }`;
        case '$changeStream':
            return `{ ${v}: {} }`;
        case '$collStats':
            return `{ ${v}: { storageStats: {} } }`;
        case '$currentOp':
            return `{ ${v}: { allUsers: true } }`;
        case '$indexStats':
            return `{ ${v}: {} }`;
        case '$listLocalSessions':
            return `{ ${v}: { allUsers: true } }`;
        case '$geoNear':
            return `{ ${v}: { near: { type: "Point", coordinates: [\${1:lng}, \${2:lat}] }, distanceField: "\${3:distance}" } }`;
        default:
            return `{ ${v}: { \${1} } }`;
    }
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
// File generation
// ---------------------------------------------------------------------------

function generateFileContent(specs: FileSpec[]): string {
    const copyright = `/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// AUTO-GENERATED — DO NOT EDIT BY HAND
//
// Generated by: npm run generate  (scripts/generate-from-reference.ts)
// Sources:      resources/operator-reference-scraped.md
//               resources/operator-reference-overrides.md
//
// To change operator data, edit the overrides file and re-run the generator.
`;

    // Collect all unique meta imports
    const allMetaImports = new Set<string>();
    for (const spec of specs) {
        allMetaImports.add(spec.metaImport);
    }

    const metaImportsList = [...allMetaImports].sort().join(',\n    ');

    let content = `${copyright}
import { type OperatorEntry } from './types';
import { ${metaImportsList} } from './metaTags';
import { getDocLink } from './docLinks';
import { registerOperators } from './getFilteredCompletions';

`;

    for (const spec of specs) {
        content += generateSection(spec);
        content += '\n';
    }

    // Registration call
    const allVarNames = specs.map((s) => `...${s.variableName}`).join(',\n    ');
    content += `// ---------------------------------------------------------------------------\n`;
    content += `// Registration\n`;
    content += `// ---------------------------------------------------------------------------\n\n`;
    content += `registerOperators([\n    ${allVarNames},\n]);\n`;

    return content;
}

function generateSection(spec: FileSpec): string {
    let section = `// ---------------------------------------------------------------------------\n`;
    section += `// ${spec.operators[0]?.category || spec.variableName}\n`;
    section += `// ---------------------------------------------------------------------------\n\n`;

    section += `const ${spec.variableName}: readonly OperatorEntry[] = [\n`;

    for (const op of spec.operators) {
        const snippet = op.snippetOverride || generateSnippet(op, spec.metaImport);
        const bsonTypes = getApplicableBsonTypes(op, spec.metaImport);

        section += `    {\n`;
        section += `        value: '${escapeString(op.value)}',\n`;
        section += `        meta: ${spec.metaImport},\n`;
        section += `        description: '${escapeString(op.description)}',\n`;
        if (snippet) {
            section += `        snippet: '${escapeString(snippet)}',\n`;
        }
        section += `        link: getDocLink('${escapeString(op.value)}', ${spec.metaImport}),\n`;
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
    const dumpPath = path.join(__dirname, '..', 'resources', 'operator-reference-scraped.md');
    const overridePath = path.join(__dirname, '..', 'resources', 'operator-reference-overrides.md');
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

    console.log('📁 Building file specs...');
    const fileGroups = buildFileSpecs(categorizedOps);

    for (const [fileName, specs] of fileGroups) {
        const filePath = path.join(srcDir, `${fileName}.ts`);
        console.log(
            `✍️  Generating ${fileName}.ts (${specs.reduce((n, s) => n + s.operators.length, 0)} operators)...`,
        );
        const fileContent = generateFileContent(specs);
        fs.writeFileSync(filePath, fileContent, 'utf-8');
    }

    console.log('\n✅ Done! Generated files:');
    for (const [fileName, specs] of fileGroups) {
        const count = specs.reduce((n, s) => n + s.operators.length, 0);
        console.log(`  src/${fileName}.ts — ${count} operators`);
    }
}

main();
