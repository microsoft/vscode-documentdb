/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Structural invariant tests for all operator entries.
 *
 * Validates that every entry in getAllCompletions() has the correct shape,
 * consistent meta tags, and reasonable values.
 */

import { ALL_META_TAGS, getAllCompletions, type OperatorEntry } from './index';

const allOperators = getAllCompletions();

describe('structural invariants', () => {
    test('total operator count is in the expected range', () => {
        // 308 total (298 from dump + 10 BSON constructors)
        expect(allOperators.length).toBeGreaterThanOrEqual(290);
        expect(allOperators.length).toBeLessThanOrEqual(320);
    });

    test('every entry has required fields', () => {
        const invalid: string[] = [];
        for (const op of allOperators) {
            if (!op.value) {
                invalid.push('entry missing value');
            }
            if (!op.meta) {
                invalid.push(`${op.value} missing meta`);
            }
            if (!op.description) {
                invalid.push(`${op.value} missing description`);
            }
        }
        expect(invalid).toEqual([]);
    });

    test('operator values start with $ or $$ (except BSON constructors)', () => {
        const invalid: string[] = [];
        for (const op of allOperators) {
            if (op.meta === 'bson') {
                // BSON constructors: ObjectId, ISODate, etc. — no $ prefix
                expect(op.value).toMatch(/^[A-Z]/);
            } else if (op.meta === 'variable') {
                // System variables start with $$
                if (!op.value.startsWith('$$')) {
                    invalid.push(`${op.value} (variable) should start with $$`);
                }
            } else {
                // All other operators start with $
                if (!op.value.startsWith('$')) {
                    invalid.push(`${op.value} (${op.meta}) should start with $`);
                }
            }
        }
        expect(invalid).toEqual([]);
    });

    test('every entry has a valid meta tag', () => {
        const validMetas = new Set<string>(ALL_META_TAGS);
        const invalid: string[] = [];
        for (const op of allOperators) {
            if (!validMetas.has(op.meta)) {
                invalid.push(`${op.value} has unknown meta: ${op.meta}`);
            }
        }
        expect(invalid).toEqual([]);
    });

    test('descriptions are non-empty strings', () => {
        const empty: string[] = [];
        for (const op of allOperators) {
            if (typeof op.description !== 'string' || op.description.trim().length === 0) {
                empty.push(`${op.value} (${op.meta}) has empty description`);
            }
        }
        expect(empty).toEqual([]);
    });

    test('snippets are strings when present', () => {
        const invalid: string[] = [];
        for (const op of allOperators) {
            if (op.snippet !== undefined && typeof op.snippet !== 'string') {
                invalid.push(`${op.value} (${op.meta}) has non-string snippet`);
            }
        }
        expect(invalid).toEqual([]);
    });

    test('links are valid URLs when present', () => {
        const invalid: string[] = [];
        for (const op of allOperators) {
            if (op.link !== undefined) {
                if (typeof op.link !== 'string' || !op.link.startsWith('https://')) {
                    invalid.push(`${op.value} (${op.meta}) has invalid link: ${op.link}`);
                }
            }
        }
        expect(invalid).toEqual([]);
    });

    test('applicableBsonTypes is a string array when present', () => {
        const invalid: string[] = [];
        for (const op of allOperators) {
            if (op.applicableBsonTypes !== undefined) {
                if (!Array.isArray(op.applicableBsonTypes)) {
                    invalid.push(`${op.value} (${op.meta}) applicableBsonTypes is not an array`);
                } else {
                    for (const t of op.applicableBsonTypes) {
                        if (typeof t !== 'string' || t.trim().length === 0) {
                            invalid.push(`${op.value} (${op.meta}) has empty BSON type`);
                        }
                    }
                }
            }
        }
        expect(invalid).toEqual([]);
    });

    test('no duplicate (value, meta) pairs', () => {
        const seen = new Set<string>();
        const duplicates: string[] = [];
        for (const op of allOperators) {
            const key = `${op.value}|${op.meta}`;
            if (seen.has(key)) {
                duplicates.push(key);
            }
            seen.add(key);
        }
        expect(duplicates).toEqual([]);
    });

    test('BSON constructors have expected entries', () => {
        const bsonOps = allOperators.filter((op) => op.meta === 'bson');
        const bsonValues = bsonOps.map((op) => op.value).sort();
        expect(bsonValues).toEqual(
            expect.arrayContaining([
                'BinData',
                'ISODate',
                'MaxKey',
                'MinKey',
                'NumberDecimal',
                'NumberInt',
                'NumberLong',
                'ObjectId',
                'Timestamp',
                'UUID',
            ]),
        );
    });

    test('system variables have expected entries', () => {
        const varOps = allOperators.filter((op) => op.meta === 'variable');
        const varValues = varOps.map((op) => op.value).sort();
        expect(varValues).toEqual(
            expect.arrayContaining(['$$CURRENT', '$$DESCEND', '$$KEEP', '$$NOW', '$$PRUNE', '$$REMOVE', '$$ROOT']),
        );
    });

    test('key operators are present', () => {
        const values = new Set(allOperators.map((op) => op.value));

        // Query operators
        expect(values.has('$eq')).toBe(true);
        expect(values.has('$gt')).toBe(true);
        expect(values.has('$and')).toBe(true);
        expect(values.has('$regex')).toBe(true);
        expect(values.has('$exists')).toBe(true);

        // Stages
        expect(values.has('$match')).toBe(true);
        expect(values.has('$group')).toBe(true);
        expect(values.has('$lookup')).toBe(true);
        expect(values.has('$project')).toBe(true);
        expect(values.has('$sort')).toBe(true);

        // Update operators
        expect(values.has('$set')).toBe(true);
        expect(values.has('$unset')).toBe(true);
        expect(values.has('$inc')).toBe(true);

        // Accumulators
        expect(values.has('$sum')).toBe(true);
        expect(values.has('$avg')).toBe(true);

        // Expressions
        expect(values.has('$add')).toBe(true);
        expect(values.has('$concat')).toBe(true);
        expect(values.has('$cond')).toBe(true);
    });

    test('excluded operators are NOT present with unsupported meta tags', () => {
        // These should not be present (deprecated or not supported)
        const opsByValueMeta = new Map<string, OperatorEntry>();
        for (const op of allOperators) {
            opsByValueMeta.set(`${op.value}|${op.meta}`, op);
        }

        // $where is deprecated and should not be present as evaluation query
        expect(opsByValueMeta.has('$where|query:evaluation')).toBe(false);
    });
});

describe('meta tag coverage', () => {
    test('every meta tag in ALL_META_TAGS has at least one operator (except parent-only and runtime tags)', () => {
        const metasWithOps = new Set(allOperators.map((op) => op.meta));
        // Parent-only tags: operators use subcategories (query:comparison, update:field),
        // not the bare 'query' or 'update' tags. 'field:identifier' is runtime-injected.
        const parentOnlyTags = new Set(['query', 'update', 'field:identifier']);
        const missing: string[] = [];
        for (const tag of ALL_META_TAGS) {
            if (parentOnlyTags.has(tag)) {
                continue;
            }
            if (!metasWithOps.has(tag)) {
                missing.push(tag);
            }
        }
        expect(missing).toEqual([]);
    });

    test('top-level meta categories have expected operator counts', () => {
        const countByPrefix: Record<string, number> = {};
        for (const op of allOperators) {
            const prefix = op.meta.includes(':') ? op.meta.split(':')[0] : op.meta;
            countByPrefix[prefix] = (countByPrefix[prefix] || 0) + 1;
        }

        expect(countByPrefix['query']).toBe(43);
        expect(countByPrefix['update']).toBe(22);
        expect(countByPrefix['stage']).toBe(35);
        expect(countByPrefix['accumulator']).toBe(21);
        expect(countByPrefix['window']).toBe(27);
        expect(countByPrefix['bson']).toBe(10);
        expect(countByPrefix['variable']).toBe(7);
        // Expression operators: ~143-144
        expect(countByPrefix['expr']).toBeGreaterThanOrEqual(140);
        expect(countByPrefix['expr']).toBeLessThanOrEqual(150);
    });
});
