/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Dump-vs-implementation verification test.
 *
 * Ensures the TypeScript operator implementation always matches the
 * resource dump (scraped/operator-reference.md). This test is the
 * enforcing contract between "what does DocumentDB support?" (the dump)
 * and "what does our code provide?" (the implementation).
 *
 * See §2.3.3 of docs/plan/03-documentdb-constants.md for design rationale.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getAllCompletions } from './index';
import { parseOperatorReference } from './parseOperatorReference';

const dumpPath = path.join(__dirname, '..', 'resources', 'scraped', 'operator-reference.md');
const dumpContent = fs.readFileSync(dumpPath, 'utf-8');
const parsed = parseOperatorReference(dumpContent);
const referenceOperators = parsed.operators;
const notListedOperators = parsed.notListed;
const implementedOperators = getAllCompletions();

/**
 * Category-to-meta mapping. Maps dump category names to the meta tags
 * used in the implementation. Some dump categories map to the same meta
 * tag (e.g., both accumulator categories map to 'accumulator').
 */
const CATEGORY_TO_META: Record<string, string> = {
    'Comparison Query Operators': 'query:comparison',
    'Logical Query Operators': 'query:logical',
    'Element Query Operators': 'query:element',
    'Evaluation Query Operators': 'query:evaluation',
    'Geospatial Operators': 'query:geospatial',
    'Array Query Operators': 'query:array',
    'Bitwise Query Operators': 'query:bitwise',
    'Projection Operators': 'query:projection',
    'Miscellaneous Query Operators': 'query:misc',
    'Field Update Operators': 'update:field',
    'Array Update Operators': 'update:array',
    'Bitwise Update Operators': 'update:bitwise',
    'Arithmetic Expression Operators': 'expr:arith',
    'Array Expression Operators': 'expr:array',
    'Bitwise Operators': 'expr:bitwise',
    'Boolean Expression Operators': 'expr:bool',
    'Comparison Expression Operators': 'expr:comparison',
    'Data Size Operators': 'expr:datasize',
    'Date Expression Operators': 'expr:date',
    'Literal Expression Operator': 'expr:literal',
    'Miscellaneous Operators': 'expr:misc',
    'Object Expression Operators': 'expr:object',
    'Set Expression Operators': 'expr:set',
    'String Expression Operators': 'expr:string',
    'Timestamp Expression Operators': 'expr:timestamp',
    'Trigonometry Expression Operators': 'expr:trig',
    'Type Expression Operators': 'expr:type',
    'Accumulators ($group, $bucket, $bucketAuto, $setWindowFields)': 'accumulator',
    'Accumulators (in Other Stages)': 'accumulator',
    'Variable Expression Operators': 'expr:variable',
    'Window Operators': 'window',
    'Conditional Expression Operators': 'expr:conditional',
    'Aggregation Pipeline Stages': 'stage',
    'Variables in Aggregation Expressions': 'variable',
};

describe('operator reference verification', () => {
    test('dump file exists and is parseable', () => {
        expect(dumpContent.length).toBeGreaterThan(1000);
        expect(referenceOperators.length).toBeGreaterThan(250);
    });

    test('every listed operator in the dump has an implementation entry', () => {
        const implementedValues = new Set(implementedOperators.map((op) => op.value));
        const missing: string[] = [];

        for (const ref of referenceOperators) {
            // Some operators appear in multiple dump categories (e.g., $objectToArray
            // in both "Array Expression" and "Object Expression"). The implementation
            // only needs one entry per (value, meta) pair — check by value.
            if (!implementedValues.has(ref.operator)) {
                missing.push(`${ref.operator} (${ref.category})`);
            }
        }

        expect(missing).toEqual([]);
    });

    test('no extra operators in implementation beyond the dump (excluding BSON/variables)', () => {
        // Build a set of all operator values from the dump
        const dumpValues = new Set(referenceOperators.map((r) => r.operator));

        // Filter implementation entries: exclude BSON constructors and system variables
        // (these are hand-authored, not from the compatibility page dump)
        const extras = implementedOperators.filter(
            (op) => !op.meta.startsWith('bson') && !op.meta.startsWith('variable') && !dumpValues.has(op.value),
        );

        expect(extras.map((e) => `${e.value} (${e.meta})`)).toEqual([]);
    });

    test('not-listed operators are NOT in the implementation', () => {
        const leaked: string[] = [];

        for (const nl of notListedOperators) {
            // Check the exact meta category from the dump
            const expectedMeta = CATEGORY_TO_META[nl.category];
            if (!expectedMeta) {
                continue;
            }

            const found = implementedOperators.find((op) => op.value === nl.operator && op.meta === expectedMeta);

            if (found) {
                leaked.push(`${nl.operator} (${nl.category}) — ${nl.reason}`);
            }
        }

        expect(leaked).toEqual([]);
    });

    test('all dump categories have a known meta mapping', () => {
        const categories = new Set(referenceOperators.map((r) => r.category));
        const unmapped = [...categories].filter((c) => !CATEGORY_TO_META[c]);
        expect(unmapped).toEqual([]);
    });

    test('reference parser found the expected number of not-listed operators', () => {
        // The plan lists 16 not-listed operators (§2.1)
        expect(notListedOperators.length).toBeGreaterThanOrEqual(14);
        expect(notListedOperators.length).toBeLessThanOrEqual(20);
    });
});

// ---------------------------------------------------------------------------
// Override verification
//
// The generator (scripts/generate-from-reference.ts) merges the scraped dump
// with manual overrides. These tests verify overrides are correctly applied —
// catching scenarios where:
//   - Someone adds an override but forgets to run `npm run generate`
//   - The override file is accidentally truncated
//   - An override targets a non-existent operator
// ---------------------------------------------------------------------------

const overridesPath = path.join(__dirname, '..', 'resources', 'overrides', 'operator-overrides.md');
const overridesContent = fs.readFileSync(overridesPath, 'utf-8');
const parsedOverrides = parseOperatorReference(overridesContent);
const overrideOperators = parsedOverrides.operators;

describe('override verification', () => {
    test('overrides file exists and has entries', () => {
        expect(overridesContent.length).toBeGreaterThan(100);
        expect(overrideOperators.length).toBeGreaterThan(0);
    });

    test('override count is within expected range (detect truncation)', () => {
        // Currently 56 overrides. Allow some flex for additions/removals,
        // but catch catastrophic truncation (e.g., file emptied to <10).
        expect(overrideOperators.length).toBeGreaterThanOrEqual(40);
        expect(overrideOperators.length).toBeLessThanOrEqual(80);
    });

    test('every override targets an operator that exists in the dump', () => {
        const dumpKeys = new Set(referenceOperators.map((r) => `${r.operator}|${r.category}`));
        const orphans: string[] = [];

        for (const ov of overrideOperators) {
            if (!dumpKeys.has(`${ov.operator}|${ov.category}`)) {
                orphans.push(`${ov.operator} (${ov.category})`);
            }
        }

        expect(orphans).toEqual([]);
    });

    test('every override with a description was applied (not silently ignored)', () => {
        const unapplied: string[] = [];

        for (const ov of overrideOperators) {
            if (!ov.description) {
                continue;
            }

            const expectedMeta = CATEGORY_TO_META[ov.category];
            if (!expectedMeta) {
                continue;
            }

            const impl = implementedOperators.find((op) => op.value === ov.operator && op.meta === expectedMeta);

            if (!impl) {
                unapplied.push(`${ov.operator} (${ov.category}): no implementation entry found`);
            } else if (impl.description !== ov.description) {
                unapplied.push(
                    `${ov.operator} (${ov.category}): override="${ov.description}", ` + `impl="${impl.description}"`,
                );
            }
        }

        expect(unapplied).toEqual([]);
    });
});
