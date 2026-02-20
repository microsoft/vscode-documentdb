/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Unit tests for getFilteredCompletions and completion presets.
 */

import {
    EXPRESSION_COMPLETION_META,
    FILTER_COMPLETION_META,
    GROUP_EXPRESSION_COMPLETION_META,
    PROJECTION_COMPLETION_META,
    STAGE_COMPLETION_META,
    UPDATE_COMPLETION_META,
    WINDOW_COMPLETION_META,
    getAllCompletions,
    getFilteredCompletions,
} from './index';

describe('getFilteredCompletions', () => {
    test('returns all operators when filtering by all top-level meta prefixes', () => {
        const all = getAllCompletions();
        expect(all.length).toBeGreaterThan(0);
    });

    test('filtering by "query" returns only query operators', () => {
        const results = getFilteredCompletions({ meta: ['query'] });
        expect(results.length).toBeGreaterThan(0);
        for (const r of results) {
            expect(r.meta).toMatch(/^query/);
        }
    });

    test('filtering by "query:comparison" returns only comparison operators', () => {
        const results = getFilteredCompletions({ meta: ['query:comparison'] });
        expect(results.length).toBe(8); // $eq, $gt, $gte, $in, $lt, $lte, $ne, $nin
        for (const r of results) {
            expect(r.meta).toBe('query:comparison');
        }
    });

    test('filtering by "stage" returns aggregation pipeline stages', () => {
        const results = getFilteredCompletions({ meta: ['stage'] });
        expect(results.length).toBe(35);
        for (const r of results) {
            expect(r.meta).toBe('stage');
        }
    });

    test('filtering by "update" returns all update operators', () => {
        const results = getFilteredCompletions({ meta: ['update'] });
        expect(results.length).toBe(22);
        for (const r of results) {
            expect(r.meta).toMatch(/^update/);
        }
    });

    test('filtering by "accumulator" returns accumulator operators', () => {
        const results = getFilteredCompletions({ meta: ['accumulator'] });
        expect(results.length).toBe(21);
        for (const r of results) {
            expect(r.meta).toBe('accumulator');
        }
    });

    test('filtering by "expr" returns all expression operators', () => {
        const results = getFilteredCompletions({ meta: ['expr'] });
        expect(results.length).toBeGreaterThan(100);
        for (const r of results) {
            expect(r.meta).toMatch(/^expr:/);
        }
    });

    test('filtering by "window" returns window operators', () => {
        const results = getFilteredCompletions({ meta: ['window'] });
        expect(results.length).toBe(27);
        for (const r of results) {
            expect(r.meta).toBe('window');
        }
    });

    test('filtering by "bson" returns BSON constructors', () => {
        const results = getFilteredCompletions({ meta: ['bson'] });
        expect(results.length).toBe(10);
        for (const r of results) {
            expect(r.meta).toBe('bson');
        }
    });

    test('filtering by "variable" returns system variables', () => {
        const results = getFilteredCompletions({ meta: ['variable'] });
        expect(results.length).toBe(7);
        for (const r of results) {
            expect(r.meta).toBe('variable');
        }
    });

    test('filtering by multiple meta tags combines results', () => {
        const queryOnly = getFilteredCompletions({ meta: ['query'] });
        const stageOnly = getFilteredCompletions({ meta: ['stage'] });
        const combined = getFilteredCompletions({ meta: ['query', 'stage'] });
        expect(combined.length).toBe(queryOnly.length + stageOnly.length);
    });

    test('empty meta array returns no results', () => {
        const results = getFilteredCompletions({ meta: [] });
        expect(results.length).toBe(0);
    });

    test('unknown meta tag returns no results', () => {
        const results = getFilteredCompletions({ meta: ['nonexistent'] });
        expect(results.length).toBe(0);
    });

    describe('BSON type filtering', () => {
        test('filtering by bsonTypes narrows type-specific operators', () => {
            const allQuery = getFilteredCompletions({ meta: ['query'] });
            const stringOnly = getFilteredCompletions({
                meta: ['query'],
                bsonTypes: ['string'],
            });
            // String-only should have fewer or equal operators (universal + string-specific)
            expect(stringOnly.length).toBeLessThanOrEqual(allQuery.length);
            expect(stringOnly.length).toBeGreaterThan(0);
        });

        test('universal operators (no applicableBsonTypes) always pass BSON filter', () => {
            const withBsonFilter = getFilteredCompletions({
                meta: ['query:comparison'],
                bsonTypes: ['string'],
            });
            // All comparison operators are universal
            expect(withBsonFilter.length).toBe(8);
        });

        test('type-specific operators are excluded when BSON type does not match', () => {
            const stringOps = getFilteredCompletions({
                meta: ['query'],
                bsonTypes: ['number'],
            });
            // $regex should NOT be included (it's string-only)
            const hasRegex = stringOps.some((op) => op.value === '$regex');
            expect(hasRegex).toBe(false);
        });

        test('type-specific operators are included when BSON type matches', () => {
            const stringOps = getFilteredCompletions({
                meta: ['query'],
                bsonTypes: ['string'],
            });
            // $regex should be included for string type
            const hasRegex = stringOps.some((op) => op.value === '$regex');
            expect(hasRegex).toBe(true);
        });
    });
});

describe('completion context presets', () => {
    test('FILTER_COMPLETION_META returns query + bson + variable', () => {
        const results = getFilteredCompletions({ meta: FILTER_COMPLETION_META });
        const metas = new Set(results.map((r) => r.meta.split(':')[0]));
        expect(metas).toContain('query');
        expect(metas).toContain('bson');
        expect(metas).toContain('variable');
        expect(metas).not.toContain('stage');
        expect(metas).not.toContain('update');
    });

    test('STAGE_COMPLETION_META returns only stages', () => {
        const results = getFilteredCompletions({ meta: STAGE_COMPLETION_META });
        expect(results.length).toBe(35);
        for (const r of results) {
            expect(r.meta).toBe('stage');
        }
    });

    test('UPDATE_COMPLETION_META returns only update operators', () => {
        const results = getFilteredCompletions({ meta: UPDATE_COMPLETION_META });
        expect(results.length).toBe(22);
        for (const r of results) {
            expect(r.meta).toMatch(/^update/);
        }
    });

    test('GROUP_EXPRESSION_COMPLETION_META returns expr + accumulator + bson + variable', () => {
        const results = getFilteredCompletions({ meta: GROUP_EXPRESSION_COMPLETION_META });
        const metaPrefixes = new Set(results.map((r) => r.meta.split(':')[0]));
        expect(metaPrefixes).toContain('expr');
        expect(metaPrefixes).toContain('accumulator');
        expect(metaPrefixes).toContain('bson');
        expect(metaPrefixes).toContain('variable');
        expect(metaPrefixes).not.toContain('query');
        expect(metaPrefixes).not.toContain('stage');
    });

    test('EXPRESSION_COMPLETION_META returns expr + bson + variable (no accumulators)', () => {
        const results = getFilteredCompletions({ meta: EXPRESSION_COMPLETION_META });
        const metaPrefixes = new Set(results.map((r) => r.meta.split(':')[0]));
        expect(metaPrefixes).toContain('expr');
        expect(metaPrefixes).toContain('bson');
        expect(metaPrefixes).toContain('variable');
        expect(metaPrefixes).not.toContain('accumulator');
    });

    test('WINDOW_COMPLETION_META returns window + accumulator + expr + bson + variable', () => {
        const results = getFilteredCompletions({ meta: WINDOW_COMPLETION_META });
        const metaPrefixes = new Set(results.map((r) => r.meta.split(':')[0]));
        expect(metaPrefixes).toContain('window');
        expect(metaPrefixes).toContain('accumulator');
        expect(metaPrefixes).toContain('expr');
        expect(metaPrefixes).toContain('bson');
        expect(metaPrefixes).toContain('variable');
    });

    test('PROJECTION_COMPLETION_META looks for field:identifier (empty since runtime-injected)', () => {
        const results = getFilteredCompletions({ meta: PROJECTION_COMPLETION_META });
        // field:identifier entries are injected at runtime, not statically registered
        expect(results.length).toBe(0);
    });
});
