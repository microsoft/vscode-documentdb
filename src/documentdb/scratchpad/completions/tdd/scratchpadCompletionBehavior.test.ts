/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TDD Behavior Tests — Scratchpad Completion Categories
 *
 * These tests define the expected behavior CONTRACT for which completions
 * appear at each scratchpad cursor position. They verify WHAT completions
 * appear, not HOW they are produced internally.
 *
 * ⚠️ LLM/Agent Instruction:
 * If these tests fail after a code change, do NOT automatically fix the tests.
 * Alert the user that a TDD behavior contract has been violated. The failure
 * means the implementation broke expected behavior. The user must decide
 * whether to update the spec or fix the implementation.
 *
 * See: docs/plan/07-scratchpad-completion-provider.md Phase 2.2 for the full spec.
 */

import {
    AGGREGATION_CURSOR_METHODS,
    COLLECTION_METHODS,
    DATABASE_METHODS,
    FIND_CURSOR_METHODS,
    SHELL_GLOBALS,
} from '../completionRegistry';

// =====================================================================
// Tests: Completion Registry Coverage
// =====================================================================

describe('TDD: Scratchpad Completion Registry', () => {
    beforeAll(() => {
        console.warn(
            '\n⚠️  TDD CONTRACT TESTS — If any test below fails, do NOT auto-fix the test.\n' +
                '    Alert the user that a TDD behavior contract has been violated.\n' +
                '    The user must decide whether to update the spec or fix the implementation.\n',
        );
    });

    // -----------------------------------------------------------------
    // S1: Shell globals
    // -----------------------------------------------------------------
    describe('S1: Shell globals include required entries', () => {
        const labels = SHELL_GLOBALS.map((e) => e.label);

        test('includes db', () => expect(labels).toContain('db'));
        test('includes use', () => expect(labels).toContain('use'));
        test('includes help', () => expect(labels).toContain('help'));
        test('includes print', () => expect(labels).toContain('print'));
        test('includes printjson', () => expect(labels).toContain('printjson'));
        test('includes sleep', () => expect(labels).toContain('sleep'));
        test('includes version', () => expect(labels).toContain('version'));

        // BSON constructors
        test('includes ObjectId', () => expect(labels).toContain('ObjectId'));
        test('includes UUID', () => expect(labels).toContain('UUID'));
        test('includes ISODate', () => expect(labels).toContain('ISODate'));
        test('includes NumberInt', () => expect(labels).toContain('NumberInt'));
        test('includes NumberLong', () => expect(labels).toContain('NumberLong'));
        test('includes NumberDecimal', () => expect(labels).toContain('NumberDecimal'));

        test('does NOT include collection methods', () => {
            expect(labels).not.toContain('find');
            expect(labels).not.toContain('insertOne');
        });

        test('does NOT include query operators', () => {
            expect(labels).not.toContain('$eq');
            expect(labels).not.toContain('$gt');
        });
    });

    // -----------------------------------------------------------------
    // S2: Database methods
    // -----------------------------------------------------------------
    describe('S2: Database methods include required entries', () => {
        const labels = DATABASE_METHODS.map((e) => e.label);

        test('includes getCollection', () => expect(labels).toContain('getCollection'));
        test('includes getCollectionNames', () => expect(labels).toContain('getCollectionNames'));
        test('includes createCollection', () => expect(labels).toContain('createCollection'));
        test('includes dropDatabase', () => expect(labels).toContain('dropDatabase'));
        test('includes runCommand', () => expect(labels).toContain('runCommand'));
        test('includes adminCommand', () => expect(labels).toContain('adminCommand'));
        test('includes aggregate', () => expect(labels).toContain('aggregate'));
        test('includes getName', () => expect(labels).toContain('getName'));
        test('includes stats', () => expect(labels).toContain('stats'));

        test('does NOT include collection methods', () => {
            expect(labels).not.toContain('find');
            expect(labels).not.toContain('insertOne');
        });
    });

    // -----------------------------------------------------------------
    // S3: Collection methods
    // -----------------------------------------------------------------
    describe('S3: Collection methods include required entries', () => {
        const labels = COLLECTION_METHODS.map((e) => e.label);

        // High-frequency
        test('includes find', () => expect(labels).toContain('find'));
        test('includes findOne', () => expect(labels).toContain('findOne'));
        test('includes insertOne', () => expect(labels).toContain('insertOne'));
        test('includes insertMany', () => expect(labels).toContain('insertMany'));
        test('includes updateOne', () => expect(labels).toContain('updateOne'));
        test('includes updateMany', () => expect(labels).toContain('updateMany'));
        test('includes deleteOne', () => expect(labels).toContain('deleteOne'));
        test('includes deleteMany', () => expect(labels).toContain('deleteMany'));
        test('includes aggregate', () => expect(labels).toContain('aggregate'));

        // Medium-frequency
        test('includes countDocuments', () => expect(labels).toContain('countDocuments'));
        test('includes distinct', () => expect(labels).toContain('distinct'));
        test('includes createIndex', () => expect(labels).toContain('createIndex'));
        test('includes getIndexes', () => expect(labels).toContain('getIndexes'));

        // Low-frequency
        test('includes drop', () => expect(labels).toContain('drop'));
        test('includes stats', () => expect(labels).toContain('stats'));
        test('includes isCapped', () => expect(labels).toContain('isCapped'));

        test('does NOT include database methods', () => {
            expect(labels).not.toContain('dropDatabase');
            expect(labels).not.toContain('getCollectionNames');
        });

        // Sort ordering: high-frequency before low-frequency
        test('find sorts before stats (0_ < 2_)', () => {
            const findEntry = COLLECTION_METHODS.find((e) => e.label === 'find');
            const statsEntry = COLLECTION_METHODS.find((e) => e.label === 'stats');
            expect(findEntry?.sortPrefix).toBe('0_');
            expect(statsEntry?.sortPrefix).toBe('2_');
        });
    });

    // -----------------------------------------------------------------
    // S4: Find cursor methods
    // -----------------------------------------------------------------
    describe('S4: Find cursor methods include required entries', () => {
        const labels = FIND_CURSOR_METHODS.map((e) => e.label);

        test('includes limit', () => expect(labels).toContain('limit'));
        test('includes skip', () => expect(labels).toContain('skip'));
        test('includes sort', () => expect(labels).toContain('sort'));
        test('includes toArray', () => expect(labels).toContain('toArray'));
        test('includes forEach', () => expect(labels).toContain('forEach'));
        test('includes count', () => expect(labels).toContain('count'));
        test('includes explain', () => expect(labels).toContain('explain'));
        test('includes hasNext', () => expect(labels).toContain('hasNext'));
        test('includes batchSize', () => expect(labels).toContain('batchSize'));
        test('includes maxTimeMS', () => expect(labels).toContain('maxTimeMS'));

        test('does NOT include collection methods', () => {
            expect(labels).not.toContain('find');
            expect(labels).not.toContain('insertOne');
        });
    });

    // -----------------------------------------------------------------
    // S5: Aggregation cursor methods (subset of find cursor)
    // -----------------------------------------------------------------
    describe('S5: Aggregation cursor methods', () => {
        const labels = AGGREGATION_CURSOR_METHODS.map((e) => e.label);

        test('includes toArray', () => expect(labels).toContain('toArray'));
        test('includes explain', () => expect(labels).toContain('explain'));
        test('includes maxTimeMS', () => expect(labels).toContain('maxTimeMS'));

        // Should NOT include find-cursor-only methods
        test('does NOT include limit', () => expect(labels).not.toContain('limit'));
        test('does NOT include skip', () => expect(labels).not.toContain('skip'));
        test('does NOT include sort', () => expect(labels).not.toContain('sort'));
    });

    // -----------------------------------------------------------------
    // Snippet quality
    // -----------------------------------------------------------------
    describe('Snippet quality', () => {
        test('all entries with snippets contain tab stops', () => {
            const allEntries = [
                ...SHELL_GLOBALS,
                ...DATABASE_METHODS,
                ...COLLECTION_METHODS,
                ...FIND_CURSOR_METHODS,
                ...AGGREGATION_CURSOR_METHODS,
            ];
            for (const entry of allEntries) {
                if (entry.snippet) {
                    // Snippets with parameters should have tab stops
                    // Snippets like 'getIndexes()' with no parameters don't need tab stops
                    const hasParams = entry.snippet.includes('${');
                    const isParameterless = entry.snippet.endsWith('()');
                    if (!isParameterless) {
                        expect(hasParams).toBe(true);
                    }
                }
            }
        });

        test('all entries have descriptions', () => {
            const allEntries = [
                ...SHELL_GLOBALS,
                ...DATABASE_METHODS,
                ...COLLECTION_METHODS,
                ...FIND_CURSOR_METHODS,
                ...AGGREGATION_CURSOR_METHODS,
            ];
            for (const entry of allEntries) {
                expect(entry.description.length).toBeGreaterThan(0);
            }
        });
    });
});
