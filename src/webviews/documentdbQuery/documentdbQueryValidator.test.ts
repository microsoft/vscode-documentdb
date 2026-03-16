/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { levenshteinDistance, validateExpression } from './documentdbQueryValidator';

describe('documentdbQueryValidator', () => {
    describe('validateExpression', () => {
        test('valid expression { age: { $gt: 25 } } produces no diagnostics', () => {
            const diagnostics = validateExpression('{ age: { $gt: 25 } }');
            expect(diagnostics).toHaveLength(0);
        });

        test('valid expression with multiple fields produces no diagnostics', () => {
            const diagnostics = validateExpression('{ name: "Alice", age: 30 }');
            expect(diagnostics).toHaveLength(0);
        });

        test('valid expression with BSON constructor produces no diagnostics', () => {
            const diagnostics = validateExpression('{ _id: ObjectId("507f1f77bcf86cd799439011") }');
            expect(diagnostics).toHaveLength(0);
        });

        test('valid expression with UUID constructor produces no diagnostics', () => {
            const diagnostics = validateExpression('{ id: UUID("123e4567-e89b-12d3-a456-426614174000") }');
            expect(diagnostics).toHaveLength(0);
        });

        test('valid expression with nested objects produces no diagnostics', () => {
            const diagnostics = validateExpression('{ a: { b: { c: 1 } } }');
            expect(diagnostics).toHaveLength(0);
        });

        test('syntax error { age: { $gt: } produces error diagnostic', () => {
            const diagnostics = validateExpression('{ age: { $gt: } }');
            expect(diagnostics.length).toBeGreaterThan(0);

            const errorDiag = diagnostics.find((d) => d.severity === 'error');
            expect(errorDiag).toBeDefined();
        });

        test('syntax error with unclosed brace produces error diagnostic', () => {
            const diagnostics = validateExpression('{ age: 25');
            expect(diagnostics.length).toBeGreaterThan(0);
            expect(diagnostics[0].severity).toBe('error');
        });

        test('typo UUUD("...") produces warning "Did you mean UUID?"', () => {
            const diagnostics = validateExpression('{ id: UUUD("abc") }');

            const warnings = diagnostics.filter((d) => d.severity === 'warning');
            expect(warnings.length).toBeGreaterThan(0);
            expect(warnings[0].message).toContain('UUID');
            expect(warnings[0].message).toContain('Did you mean');
        });

        test('typo Objected produces warning "Did you mean ObjectId?"', () => {
            const diagnostics = validateExpression('{ id: ObjctId("abc") }');

            const warnings = diagnostics.filter((d) => d.severity === 'warning');
            expect(warnings.length).toBeGreaterThan(0);
            expect(warnings[0].message).toContain('ObjectId');
        });

        test('unknown identifier foo used as function is not flagged if not near BSON constructor', () => {
            // "foo" is not close to any BSON constructor name (Levenshtein > 2)
            const diagnostics = validateExpression('{ id: foo("abc") }');
            const warnings = diagnostics.filter((d) => d.severity === 'warning');
            expect(warnings).toHaveLength(0);
        });

        test('unknown identifier as field name is not flagged', () => {
            // Field names (non-function identifiers) should never produce diagnostics
            const diagnostics = validateExpression('{ unknownField: 1 }');
            expect(diagnostics).toHaveLength(0);
        });

        test('unknown field name ___id is not flagged (field validation is out of scope)', () => {
            // The validator does not validate field names against the schema.
            // That requires integration with the completion store (known fields).
            const diagnostics = validateExpression('{ ___id: 1 }');
            expect(diagnostics).toHaveLength(0);
        });

        test('empty string produces no diagnostics', () => {
            const diagnostics = validateExpression('');
            expect(diagnostics).toHaveLength(0);
        });

        test('whitespace-only string produces no diagnostics', () => {
            const diagnostics = validateExpression('   ');
            expect(diagnostics).toHaveLength(0);
        });

        test('valid expression with Math.min produces no diagnostics', () => {
            const diagnostics = validateExpression('{ rating: Math.min(1.7, 2) }');
            expect(diagnostics).toHaveLength(0);
        });

        test('valid expression with Date.now produces no diagnostics', () => {
            const diagnostics = validateExpression('{ ts: Date.now() }');
            expect(diagnostics).toHaveLength(0);
        });

        test('typo Daate.now() produces warning "Did you mean Date?"', () => {
            const diagnostics = validateExpression('{ _id: Daate.now() }');

            const warnings = diagnostics.filter((d) => d.severity === 'warning');
            expect(warnings.length).toBeGreaterThan(0);
            expect(warnings[0].message).toContain('Date');
            expect(warnings[0].message).toContain('Did you mean');
        });

        test('typo Maht.min() produces warning "Did you mean Math?"', () => {
            const diagnostics = validateExpression('{ val: Maht.min(1, 2) }');

            const warnings = diagnostics.filter((d) => d.severity === 'warning');
            expect(warnings.length).toBeGreaterThan(0);
            expect(warnings[0].message).toContain('Math');
        });

        test('typo Nubmer.parseInt() produces warning "Did you mean Number?"', () => {
            const diagnostics = validateExpression('{ x: Nubmer.parseInt("42") }');

            const warnings = diagnostics.filter((d) => d.severity === 'warning');
            expect(warnings.length).toBeGreaterThan(0);
            expect(warnings[0].message).toContain('Number');
        });

        test('Date.nodw() does NOT produce a warning (method validation is out of scope)', () => {
            // We validate the object (Date) but not individual method names.
            // Date is a known global, so no warning. The .nodw() method name
            // is not validated — that would require method-level knowledge.
            const diagnostics = validateExpression('{ _id: Date.nodw() }');
            expect(diagnostics).toHaveLength(0);
        });

        test('valid expression with ISODate constructor produces no diagnostics', () => {
            const diagnostics = validateExpression('{ ts: ISODate("2024-01-01") }');
            expect(diagnostics).toHaveLength(0);
        });

        test('valid expression with MinKey produces no diagnostics', () => {
            const diagnostics = validateExpression('{ start: MinKey() }');
            expect(diagnostics).toHaveLength(0);
        });

        test('valid expression with MaxKey produces no diagnostics', () => {
            const diagnostics = validateExpression('{ end: MaxKey() }');
            expect(diagnostics).toHaveLength(0);
        });

        test('valid expression with regex produces no diagnostics', () => {
            const diagnostics = validateExpression('{ name: /^alice/i }');
            expect(diagnostics).toHaveLength(0);
        });

        test('valid expression with array produces no diagnostics', () => {
            const diagnostics = validateExpression('{ tags: { $in: ["a", "b"] } }');
            expect(diagnostics).toHaveLength(0);
        });

        test('diagnostics have valid offsets within the input range', () => {
            const code = '{ age: { $gt: } }';
            const diagnostics = validateExpression(code);

            for (const d of diagnostics) {
                expect(d.startOffset).toBeGreaterThanOrEqual(0);
                expect(d.endOffset).toBeLessThanOrEqual(code.length);
                expect(d.startOffset).toBeLessThanOrEqual(d.endOffset);
            }
        });
    });

    describe('levenshteinDistance', () => {
        test('identical strings have distance 0', () => {
            expect(levenshteinDistance('UUID', 'UUID')).toBe(0);
        });

        test('one character difference has distance 1', () => {
            expect(levenshteinDistance('UUID', 'UUUD')).toBe(1);
        });

        test('two character difference has distance 2', () => {
            expect(levenshteinDistance('ObjectId', 'ObjctId')).toBeLessThanOrEqual(2);
        });

        test('completely different strings have high distance', () => {
            expect(levenshteinDistance('UUID', 'something')).toBeGreaterThan(2);
        });

        test('empty string vs non-empty has distance equal to length', () => {
            expect(levenshteinDistance('', 'abc')).toBe(3);
            expect(levenshteinDistance('abc', '')).toBe(3);
        });

        test('both empty strings have distance 0', () => {
            expect(levenshteinDistance('', '')).toBe(0);
        });
    });
});
