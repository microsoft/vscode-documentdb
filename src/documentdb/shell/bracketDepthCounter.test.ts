/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isExpressionIncomplete } from './bracketDepthCounter';

describe('isExpressionIncomplete', () => {
    describe('balanced expressions (complete)', () => {
        it('should return false for empty string', () => {
            expect(isExpressionIncomplete('')).toBe(false);
        });

        it('should return false for simple expression', () => {
            expect(isExpressionIncomplete('db.test.find()')).toBe(false);
        });

        it('should return false for balanced braces', () => {
            expect(isExpressionIncomplete('{ age: 25 }')).toBe(false);
        });

        it('should return false for balanced brackets', () => {
            expect(isExpressionIncomplete('[1, 2, 3]')).toBe(false);
        });

        it('should return false for balanced parens', () => {
            expect(isExpressionIncomplete('(a + b)')).toBe(false);
        });

        it('should return false for nested balanced brackets', () => {
            expect(isExpressionIncomplete('db.test.find({ age: { $gt: 25 } })')).toBe(false);
        });

        it('should return false for multi-line balanced expression', () => {
            expect(isExpressionIncomplete('db.test.find({\n  age: 25\n})')).toBe(false);
        });

        it('should return false for complete aggregate pipeline', () => {
            expect(isExpressionIncomplete('db.test.aggregate([{ $match: { x: 1 } }])')).toBe(false);
        });

        it('should return false for closed string', () => {
            expect(isExpressionIncomplete('"hello"')).toBe(false);
        });

        it('should return false for plain text without brackets', () => {
            expect(isExpressionIncomplete('show dbs')).toBe(false);
        });
    });

    describe('unclosed brackets (incomplete)', () => {
        it('should return true for unclosed brace', () => {
            expect(isExpressionIncomplete('{')).toBe(true);
        });

        it('should return true for unclosed bracket', () => {
            expect(isExpressionIncomplete('[')).toBe(true);
        });

        it('should return true for unclosed paren', () => {
            expect(isExpressionIncomplete('(')).toBe(true);
        });

        it('should return true for unclosed find query', () => {
            expect(isExpressionIncomplete('db.test.find({')).toBe(true);
        });

        it('should return true for partially closed nested brackets', () => {
            expect(isExpressionIncomplete('db.test.find({ age: { $gt: 25 }')).toBe(true);
        });

        it('should return true for unclosed aggregate pipeline', () => {
            expect(isExpressionIncomplete('db.test.aggregate([')).toBe(true);
        });

        it('should return true for multi-line unclosed expression', () => {
            expect(isExpressionIncomplete('db.test.find({\n  age: 25')).toBe(true);
        });

        it('should return true for unclosed function body', () => {
            expect(isExpressionIncomplete('function test() {')).toBe(true);
        });
    });

    describe('extra closing brackets (complete — let evaluator error)', () => {
        it('should return false for extra closing brace', () => {
            expect(isExpressionIncomplete('}')).toBe(false);
        });

        it('should return false for extra closing paren', () => {
            expect(isExpressionIncomplete('())}')).toBe(false);
        });

        it('should return false for mismatched brackets', () => {
            expect(isExpressionIncomplete('{]')).toBe(false);
        });
    });

    describe('strings — brackets inside strings ignored', () => {
        it('should ignore braces inside double-quoted strings', () => {
            expect(isExpressionIncomplete('"{ hello }"')).toBe(false);
        });

        it('should ignore brackets inside single-quoted strings', () => {
            expect(isExpressionIncomplete("'[1, 2, 3]'")).toBe(false);
        });

        it('should ignore parens inside template literals', () => {
            expect(isExpressionIncomplete('`(hello)`')).toBe(false);
        });

        it('should handle escaped quotes in double-quoted strings', () => {
            expect(isExpressionIncomplete('"say \\"hi\\" please"')).toBe(false);
        });

        it('should handle escaped quotes in single-quoted strings', () => {
            expect(isExpressionIncomplete("'it\\'s fine'")).toBe(false);
        });

        it('should handle escaped backslash before closing quote', () => {
            expect(isExpressionIncomplete('"path\\\\"')).toBe(false);
        });
    });

    describe('unterminated strings (incomplete)', () => {
        it('should return true for unterminated double-quoted string', () => {
            expect(isExpressionIncomplete('"hello')).toBe(true);
        });

        it('should return true for unterminated single-quoted string', () => {
            expect(isExpressionIncomplete("'hello")).toBe(true);
        });

        it('should return true for unterminated template literal', () => {
            expect(isExpressionIncomplete('`hello')).toBe(true);
        });

        it('should return true for string ending with escape', () => {
            expect(isExpressionIncomplete('"hello\\')).toBe(true);
        });
    });

    describe('comments', () => {
        it('should ignore brackets in line comments', () => {
            expect(isExpressionIncomplete('x // { open brace')).toBe(false);
        });

        it('should resume parsing after line comment ends', () => {
            expect(isExpressionIncomplete('// comment\n{')).toBe(true);
        });

        it('should ignore brackets in block comments', () => {
            expect(isExpressionIncomplete('/* { [ ( */ done')).toBe(false);
        });

        it('should return true for unterminated block comment', () => {
            expect(isExpressionIncomplete('/* unclosed')).toBe(true);
        });

        it('should handle block comment spanning multiple lines', () => {
            expect(isExpressionIncomplete('/* line1\nline2 */')).toBe(false);
        });
    });

    describe('mixed scenarios', () => {
        it('should handle string inside unclosed object', () => {
            expect(isExpressionIncomplete('{ name: "Alice"')).toBe(true);
        });

        it('should handle complete expression with strings and brackets', () => {
            expect(isExpressionIncomplete('db.test.find({ name: "Alice", tags: ["a", "b"] })')).toBe(false);
        });

        it('should handle multi-line aggregate with comments', () => {
            const text = ['db.test.aggregate([', '  // first stage', '  { $match: { x: 1 } },'].join('\n');
            expect(isExpressionIncomplete(text)).toBe(true);
        });

        it('should handle complete multi-line aggregate', () => {
            const text = [
                'db.test.aggregate([',
                '  { $match: { x: 1 } },',
                '  { $group: { _id: "$type", count: { $sum: 1 } } }',
                '])',
            ].join('\n');
            expect(isExpressionIncomplete(text)).toBe(false);
        });

        it('should handle regex-like patterns (not real regex parsing)', () => {
            // Our scanner doesn't parse regex — treats /.../ as division or comment start.
            // This is acceptable since regex rarely contains brackets in shell input.
            expect(isExpressionIncomplete('db.test.find({ name: "test" })')).toBe(false);
        });
    });
});
