/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BSON, Decimal128, Double, Int32, Long, ObjectId } from 'bson';
import { describe, expect, it } from 'vitest';
import { parseDocumentFromEditor, stringifyDocumentForEditor } from './documentEjson';

describe('documentEjson', () => {
    it('preserves Long, integral Double, and Int32 across read -> editor -> save round-trips', () => {
        const id = new ObjectId('65f1a2b3c4d5e6f708192a3b');
        const original = {
            _id: id,
            smallLong: Long.fromNumber(5),
            bigLong: Long.fromString('9007199254740993'),
            integralDouble: new Double(1),
            largeIntegralDouble: new Double(3000000000),
            negativeZeroDouble: new Double(-0),
            fractionalDouble: new Double(1.5),
            int32: new Int32(7),
            decimal: Decimal128.fromString('12.34'),
            nested: {
                arr: [Long.fromNumber(42), new Double(2), new Double(2.5), new Int32(3)],
            },
        };

        // Simulate reading from MongoDB with promoteValues: false
        const readFromDb = BSON.deserialize(BSON.serialize(original), { promoteValues: false });
        const editorText = stringifyDocumentForEditor(readFromDb);

        // Ordinary Int32 and fractional Double stay readable as plain JSON numbers
        expect(editorText).toContain('"int32": 7');
        expect(editorText).toContain('"fractionalDouble": 1.5');

        // Long and integral Double keep explicit wrappers so precision and BSON types survive
        expect(editorText).toContain('"$numberLong": "5"');
        expect(editorText).toContain('"$numberLong": "9007199254740993"');
        expect(editorText).toContain('"$numberDouble": "1.0"');
        expect(editorText).toContain('"$numberDouble": "3000000000.0"');
        expect(editorText).toContain('"$numberDouble": "-0.0"');

        // Simulate parsing on save and persisting back to BSON
        const parsedForSave = parseDocumentFromEditor(editorText);
        const savedInDb = BSON.deserialize(BSON.serialize(parsedForSave), { promoteValues: false });

        expect(savedInDb._id).toBeInstanceOf(ObjectId);
        expect((savedInDb._id as ObjectId).toHexString()).toBe(id.toHexString());

        expect(savedInDb.smallLong).toBeInstanceOf(Long);
        expect((savedInDb.smallLong as Long).toString()).toBe('5');

        expect(savedInDb.bigLong).toBeInstanceOf(Long);
        expect((savedInDb.bigLong as Long).toString()).toBe('9007199254740993');

        expect(savedInDb.integralDouble).toBeInstanceOf(Double);
        expect((savedInDb.integralDouble as Double).valueOf()).toBe(1);

        expect(savedInDb.largeIntegralDouble).toBeInstanceOf(Double);
        expect((savedInDb.largeIntegralDouble as Double).valueOf()).toBe(3000000000);

        expect(savedInDb.negativeZeroDouble).toBeInstanceOf(Double);
        expect(Object.is((savedInDb.negativeZeroDouble as Double).valueOf(), -0)).toBe(true);

        expect(savedInDb.fractionalDouble).toBeInstanceOf(Double);
        expect((savedInDb.fractionalDouble as Double).valueOf()).toBe(1.5);

        expect(savedInDb.int32).toBeInstanceOf(Int32);
        expect((savedInDb.int32 as Int32).valueOf()).toBe(7);

        expect(savedInDb.decimal).toBeInstanceOf(Decimal128);
        expect((savedInDb.decimal as Decimal128).toString()).toBe('12.34');

        const nestedArr = (savedInDb.nested as { arr: unknown[] }).arr;
        expect(nestedArr[0]).toBeInstanceOf(Long);
        expect((nestedArr[0] as Long).toString()).toBe('42');
        expect(nestedArr[1]).toBeInstanceOf(Double);
        expect((nestedArr[1] as Double).valueOf()).toBe(2);
        expect(nestedArr[2]).toBeInstanceOf(Double);
        expect((nestedArr[2] as Double).valueOf()).toBe(2.5);
        expect(nestedArr[3]).toBeInstanceOf(Int32);
        expect((nestedArr[3] as Int32).valueOf()).toBe(3);
    });

    it('handles null documents and non-finite doubles', () => {
        expect(stringifyDocumentForEditor(null)).toBe('null');

        const doc = BSON.deserialize(BSON.serialize({ nanVal: new Double(NaN), infVal: new Double(Infinity) }), {
            promoteValues: false,
        });
        const editorText = stringifyDocumentForEditor(doc);
        const saved = BSON.deserialize(BSON.serialize(parseDocumentFromEditor(editorText)), {
            promoteValues: false,
        });

        expect(saved.nanVal).toBeInstanceOf(Double);
        expect(Number.isNaN((saved.nanVal as Double).valueOf())).toBe(true);
        expect(saved.infVal).toBeInstanceOf(Double);
        expect((saved.infVal as Double).valueOf()).toBe(Infinity);
    });
});
