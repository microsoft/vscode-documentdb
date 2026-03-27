/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { detectCursorContext, type CursorContext, type FieldTypeLookup } from './cursorContext';

/**
 * Helper: place cursor at the `|` marker in the input string.
 * Returns { text, offset } with the `|` removed.
 */
function parseCursor(input: string): { text: string; offset: number } {
    const idx = input.indexOf('|');
    if (idx === -1) {
        throw new Error(`Test input must contain a '|' cursor marker: "${input}"`);
    }
    return {
        text: input.slice(0, idx) + input.slice(idx + 1),
        offset: idx,
    };
}

/** Shorthand to detect context from a `|`-marked string. */
function detect(input: string, fieldLookup?: FieldTypeLookup): CursorContext {
    const { text, offset } = parseCursor(input);
    return detectCursorContext(text, offset, fieldLookup);
}

describe('detectCursorContext', () => {
    // ---------------------------------------------------------------
    // Step 1: Core context detection (complete expressions)
    // ---------------------------------------------------------------
    describe('Step 1: Core context detection', () => {
        describe('key position (root)', () => {
            it('detects key position in empty object', () => {
                const result = detect('{ | }');
                expect(result).toEqual({ position: 'key', depth: 1 });
            });

            it('detects key position after opening brace', () => {
                const result = detect('{|}');
                expect(result).toEqual({ position: 'key', depth: 1 });
            });

            it('detects key position after comma in root object', () => {
                const result = detect('{ name: "Alice", | }');
                expect(result).toEqual({ position: 'key', depth: 1 });
            });
        });

        describe('value position', () => {
            it('detects value position after colon', () => {
                const result = detect('{ _id: | }');
                expect(result).toEqual({ position: 'value', fieldName: '_id' });
            });

            it('detects value position for quoted key', () => {
                const result = detect('{ "my.field": | }');
                expect(result).toEqual({ position: 'value', fieldName: 'my.field' });
            });

            it('detects value position for single-quoted key', () => {
                const result = detect("{ 'address.city': | }");
                expect(result).toEqual({ position: 'value', fieldName: 'address.city' });
            });

            it('includes bsonType when fieldLookup provides it', () => {
                const lookup: FieldTypeLookup = (name) => (name === 'age' ? 'int32' : undefined);
                const result = detect('{ age: | }', lookup);
                expect(result).toEqual({ position: 'value', fieldName: 'age', fieldBsonType: 'int32' });
            });

            it('omits bsonType when fieldLookup returns undefined', () => {
                const lookup: FieldTypeLookup = () => undefined;
                const result = detect('{ age: | }', lookup);
                expect(result).toEqual({ position: 'value', fieldName: 'age' });
            });
        });

        describe('operator position (nested object)', () => {
            it('detects operator position inside nested object', () => {
                const result = detect('{ age: { | } }');
                expect(result).toEqual({ position: 'operator', fieldName: 'age' });
            });

            it('detects operator position with bsonType', () => {
                const lookup: FieldTypeLookup = (name) => (name === 'age' ? 'int32' : undefined);
                const result = detect('{ age: { | } }', lookup);
                expect(result).toEqual({ position: 'operator', fieldName: 'age', fieldBsonType: 'int32' });
            });

            it('detects operator position after comma in nested object', () => {
                const result = detect('{ age: { $gt: 5, | } }');
                expect(result).toEqual({ position: 'operator', fieldName: 'age' });
            });
        });

        describe('array-element position', () => {
            it('detects array-element inside $and', () => {
                const result = detect('{ $and: [ | ] }');
                expect(result).toEqual({ position: 'array-element', parentOperator: '$and' });
            });

            it('detects array-element inside $or', () => {
                const result = detect('{ $or: [ | ] }');
                expect(result).toEqual({ position: 'array-element', parentOperator: '$or' });
            });

            it('detects array-element inside $nor', () => {
                const result = detect('{ $nor: [ | ] }');
                expect(result).toEqual({ position: 'array-element', parentOperator: '$nor' });
            });
        });

        describe('key inside logical operator array element', () => {
            it('detects key inside $and array element object', () => {
                const result = detect('{ $and: [ { | } ] }');
                expect(result.position).toBe('key');
            });

            it('detects key inside $or array element object after comma', () => {
                const result = detect('{ $or: [ { x: 1 }, { | } ] }');
                expect(result.position).toBe('key');
            });
        });

        describe('edge cases', () => {
            it('returns unknown for empty string', () => {
                expect(detectCursorContext('', 0)).toEqual({ position: 'unknown' });
            });

            it('returns unknown for cursor at offset 0', () => {
                expect(detectCursorContext('{ age: 1 }', 0)).toEqual({ position: 'unknown' });
            });

            it('returns unknown for null-ish text', () => {
                expect(detectCursorContext('', 5)).toEqual({ position: 'unknown' });
            });

            it('clamps cursor offset to text length', () => {
                // Cursor past end of text — should still work
                const result = detectCursorContext('{ age: ', 100);
                expect(result).toEqual({ position: 'value', fieldName: 'age' });
            });
        });
    });

    // ---------------------------------------------------------------
    // Step 1.5: Incomplete / broken input (mid-typing states)
    // ---------------------------------------------------------------
    describe('Step 1.5: Incomplete / broken input', () => {
        it('{ age: | — colon just typed, no closing brace', () => {
            const result = detect('{ age: |');
            expect(result).toEqual({ position: 'value', fieldName: 'age' });
        });

        it('{ age: $| — started typing BSON constructor', () => {
            const result = detect('{ age: $|');
            expect(result).toEqual({ position: 'value', fieldName: 'age' });
        });

        it('{ age: $ |} — dollar with closing brace', () => {
            const result = detect('{ age: $ |}');
            expect(result).toEqual({ position: 'value', fieldName: 'age' });
        });

        it('{ age: {| — opened nested object, no close', () => {
            const result = detect('{ age: {|');
            expect(result).toEqual({ position: 'operator', fieldName: 'age' });
        });

        it('{ age: { $| — partially typed operator', () => {
            const result = detect('{ age: { $|');
            expect(result).toEqual({ position: 'operator', fieldName: 'age' });
        });

        it('{ age: { $ |} — incomplete operator inside nested object', () => {
            const result = detect('{ age: { $ |}');
            expect(result).toEqual({ position: 'operator', fieldName: 'age' });
        });

        it('{ age: { $g| — partially typed $gt', () => {
            const result = detect('{ age: { $g|');
            expect(result).toEqual({ position: 'operator', fieldName: 'age' });
        });

        it('{ | — opened root object, no field name yet', () => {
            const result = detect('{ |');
            expect(result).toEqual({ position: 'key', depth: 1 });
        });

        it('{ a| — partially typed field name', () => {
            const result = detect('{ a|');
            expect(result).toEqual({ position: 'key', depth: 1 });
        });

        it('{ name: "Alice", | — comma after first pair, new key expected', () => {
            const result = detect('{ name: "Alice", |');
            expect(result).toEqual({ position: 'key', depth: 1 });
        });

        it('{ name: "Alice", a| — partially typed second field name', () => {
            const result = detect('{ name: "Alice", a|');
            expect(result).toEqual({ position: 'key', depth: 1 });
        });

        it('{ $and: [| — opened array for logical operator', () => {
            const result = detect('{ $and: [|');
            expect(result).toEqual({ position: 'array-element', parentOperator: '$and' });
        });

        it('{ $and: [ {| — inside $and array element object', () => {
            const result = detect('{ $and: [ {|');
            expect(result.position).toBe('key');
        });

        it('{ age: { $gt: 5, | — after comma inside nested operator object', () => {
            const result = detect('{ age: { $gt: 5, |');
            expect(result).toEqual({ position: 'operator', fieldName: 'age' });
        });

        it('{| — just the opening brace', () => {
            const result = detect('{|');
            expect(result).toEqual({ position: 'key', depth: 1 });
        });

        it('empty string → unknown', () => {
            expect(detectCursorContext('', 0)).toEqual({ position: 'unknown' });
        });

        it('handles fieldLookup with incomplete input', () => {
            const lookup: FieldTypeLookup = (name) => (name === 'age' ? 'int32' : undefined);
            const result = detect('{ age: { $|', lookup);
            expect(result).toEqual({ position: 'operator', fieldName: 'age', fieldBsonType: 'int32' });
        });

        it('{ $or: [ { name: "x" }, {| — second element in $or array', () => {
            const result = detect('{ $or: [ { name: "x" }, {|');
            expect(result.position).toBe('key');
        });
    });

    // ---------------------------------------------------------------
    // Multi-line expressions
    // ---------------------------------------------------------------
    describe('multi-line expressions', () => {
        it('key position in multi-line object', () => {
            const result = detect(`{
  name: "Alice",
  |
}`);
            expect(result).toEqual({ position: 'key', depth: 1 });
        });

        it('value position in multi-line object', () => {
            const result = detect(`{
  age: |
}`);
            expect(result).toEqual({ position: 'value', fieldName: 'age' });
        });

        it('operator position in multi-line nested object', () => {
            const result = detect(`{
  age: {
    |
  }
}`);
            expect(result).toEqual({ position: 'operator', fieldName: 'age' });
        });
    });
});
