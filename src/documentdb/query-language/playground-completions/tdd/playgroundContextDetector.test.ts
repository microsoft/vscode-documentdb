/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TDD Behavior Tests — Query Playground Cursor Context Detection (Stage 1)
 *
 * These tests define the expected behavior CONTRACT for the JS-level
 * cursor context detection. They were written alongside the implementation
 * and verify WHAT context is detected at each cursor position.
 *
 * ⚠️ LLM/Agent Instruction:
 * If these tests fail after a code change, do NOT automatically fix the tests.
 * Alert the user that a TDD behavior contract has been violated. The failure
 * means the implementation broke expected behavior. The user must decide
 * whether to update the spec or fix the implementation.
 */

import { detectMethodArgContext, detectPlaygroundContext } from '../playgroundContextDetector';

// =====================================================================
// Tests: detectPlaygroundContext
// =====================================================================

describe('TDD: Query Playground Context Detection', () => {
    beforeAll(() => {
        console.warn(
            '\n⚠️  TDD CONTRACT TESTS — If any test below fails, do NOT auto-fix the test.\n' +
                '    Alert the user that a TDD behavior contract has been violated.\n' +
                '    The user must decide whether to update the spec or fix the implementation.\n',
        );
    });

    // -----------------------------------------------------------------
    // S1: Top-level (empty file or cursor not after a member chain)
    // -----------------------------------------------------------------
    describe('S1: Top-level context', () => {
        test('empty file → top-level', () => {
            const ctx = detectPlaygroundContext('', 0);
            expect(ctx.kind).toBe('top-level');
        });

        test('cursor at start of new line → top-level', () => {
            const ctx = detectPlaygroundContext('// comment\n', 11);
            expect(ctx.kind).toBe('top-level');
        });

        test('standalone identifier without dot → top-level', () => {
            const ctx = detectPlaygroundContext('const x = ', 10);
            expect(ctx.kind).toBe('top-level');
        });
    });

    // -----------------------------------------------------------------
    // S2: After db.
    // -----------------------------------------------------------------
    describe('S2: db. context', () => {
        test('db. → db-dot', () => {
            const ctx = detectPlaygroundContext('db.', 3);
            expect(ctx.kind).toBe('db-dot');
        });

        test('db.get → db-dot with prefix "get"', () => {
            const ctx = detectPlaygroundContext('db.get', 6);
            expect(ctx.kind).toBe('db-dot');
            if (ctx.kind === 'db-dot') {
                expect(ctx.prefix).toBe('get');
            }
        });

        test('db. with leading whitespace → db-dot', () => {
            const ctx = detectPlaygroundContext('  db.', 5);
            expect(ctx.kind).toBe('db-dot');
        });
    });

    // -----------------------------------------------------------------
    // S3: After db.<collection>.
    // -----------------------------------------------------------------
    describe('S3: Collection method context', () => {
        test('db.users. → collection-method', () => {
            const ctx = detectPlaygroundContext('db.users.', 9);
            expect(ctx.kind).toBe('collection-method');
            if (ctx.kind === 'collection-method') {
                expect(ctx.collectionName).toBe('users');
            }
        });

        test('db.orders.find → collection-method with prefix "find"', () => {
            const ctx = detectPlaygroundContext('db.orders.find', 14);
            expect(ctx.kind).toBe('collection-method');
            if (ctx.kind === 'collection-method') {
                expect(ctx.collectionName).toBe('orders');
                expect(ctx.prefix).toBe('find');
            }
        });
    });

    // -----------------------------------------------------------------
    // S4: Find cursor chain
    // -----------------------------------------------------------------
    describe('S4: Find cursor chain', () => {
        test('db.users.find({}).  → find-cursor-chain', () => {
            const text = 'db.users.find({}).';
            const ctx = detectPlaygroundContext(text, text.length);
            expect(ctx.kind).toBe('find-cursor-chain');
        });

        test('db.users.find({}).limit(10). → find-cursor-chain (chained)', () => {
            const text = 'db.users.find({}).limit(10).';
            const ctx = detectPlaygroundContext(text, text.length);
            expect(ctx.kind).toBe('find-cursor-chain');
        });
    });

    // -----------------------------------------------------------------
    // S5: Aggregation cursor chain
    // -----------------------------------------------------------------
    describe('S5: Aggregation cursor chain', () => {
        test('db.users.aggregate([]).  → aggregate-cursor-chain', () => {
            const text = 'db.users.aggregate([]).';
            const ctx = detectPlaygroundContext(text, text.length);
            expect(ctx.kind).toBe('aggregate-cursor-chain');
        });
    });

    // -----------------------------------------------------------------
    // S6: String literal context
    // -----------------------------------------------------------------
    describe('S6: String literal context', () => {
        test('inside double-quoted string → string-literal', () => {
            const text = 'db.getCollection("us';
            const ctx = detectPlaygroundContext(text, text.length);
            expect(ctx.kind).toBe('string-literal');
        });

        test('inside single-quoted string → string-literal', () => {
            const text = "db.getCollection('us";
            const ctx = detectPlaygroundContext(text, text.length);
            expect(ctx.kind).toBe('string-literal');
        });
    });
});

// =====================================================================
// Tests: detectMethodArgContext
// =====================================================================

describe('TDD: Method Argument Context Detection', () => {
    test('inside find({}) → method=find, collection=users', () => {
        const text = 'db.users.find({ }';
        const result = detectMethodArgContext(text, 16); // cursor at space inside { }
        expect(result).not.toBeNull();
        expect(result?.methodName).toBe('find');
        expect(result?.collectionName).toBe('users');
    });

    test('inside updateOne({}, {}) → method=updateOne', () => {
        const text = 'db.orders.updateOne({ }, { }';
        const result = detectMethodArgContext(text, 22); // cursor inside first { }
        expect(result).not.toBeNull();
        expect(result?.methodName).toBe('updateOne');
        expect(result?.collectionName).toBe('orders');
    });

    test('inside aggregate([{}]) → method=aggregate', () => {
        const text = 'db.users.aggregate([{ }';
        const result = detectMethodArgContext(text, 22); // cursor inside { }
        expect(result).not.toBeNull();
        expect(result?.methodName).toBe('aggregate');
        expect(result?.collectionName).toBe('users');
    });

    test('outside method call → null', () => {
        const text = 'db.users.';
        const result = detectMethodArgContext(text, 9);
        expect(result).toBeNull();
    });

    test('at top level → null', () => {
        const text = 'const x = 5;';
        const result = detectMethodArgContext(text, 12);
        expect(result).toBeNull();
    });
});
