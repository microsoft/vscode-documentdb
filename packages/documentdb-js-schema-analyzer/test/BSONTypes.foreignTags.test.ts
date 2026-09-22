/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { runInNewContext } from 'node:vm';
import {
    Binary,
    BSONRegExp,
    BSONSymbol,
    Code,
    DBRef,
    Decimal128,
    Double,
    Int32,
    Long,
    MaxKey,
    MinKey,
    ObjectId,
    Timestamp,
    UUID,
} from 'mongodb';
import { BSONTypes } from '../src/BSONTypes';

/**
 * Builds a stand-in for a value created by a second copy of the `bson` package: every
 * `instanceof` check fails, but `_bsontype` survives. Real wrapper instances carry the tag
 * on their prototype, not as an own property, so the stand-in does the same.
 */
function foreign(bsontype: unknown, ownProps: Record<string, unknown> = {}): unknown {
    return Object.assign(Object.create({ _bsontype: bsontype }) as object, ownProps);
}

describe('BSONTypes.inferType tag fallback', () => {
    const taggedCases: ReadonlyArray<{
        label: string;
        tag: string;
        props: Record<string, unknown>;
        expected: BSONTypes;
    }> = [
        { label: 'ObjectId', tag: 'ObjectId', props: { buffer: new Uint8Array(12) }, expected: BSONTypes.ObjectId },
        { label: 'Int32', tag: 'Int32', props: { value: 7 }, expected: BSONTypes.Int32 },
        { label: 'Double', tag: 'Double', props: { value: 1.5 }, expected: BSONTypes.Double },
        { label: 'Long', tag: 'Long', props: { low: 9, high: 0, unsigned: false }, expected: BSONTypes.Long },
        {
            label: 'Decimal128',
            tag: 'Decimal128',
            props: { bytes: new Uint8Array(16) },
            expected: BSONTypes.Decimal128,
        },
        {
            label: 'Timestamp',
            tag: 'Timestamp',
            props: { low: 1, high: 0, unsigned: true },
            expected: BSONTypes.Timestamp,
        },
        {
            label: 'Binary',
            tag: 'Binary',
            props: { buffer: new Uint8Array(4), sub_type: 0, position: 4 },
            expected: BSONTypes.Binary,
        },
        {
            label: 'Binary with the UUID subtype',
            tag: 'Binary',
            props: { buffer: new Uint8Array(16), sub_type: Binary.SUBTYPE_UUID, position: 16 },
            expected: BSONTypes.UUID,
        },
        {
            label: 'Binary with the legacy UUID subtype',
            tag: 'Binary',
            props: { buffer: new Uint8Array(16), sub_type: Binary.SUBTYPE_UUID_OLD, position: 16 },
            expected: BSONTypes.UUID_LEGACY,
        },
        { label: 'BSONRegExp', tag: 'BSONRegExp', props: { pattern: 'a', options: 'i' }, expected: BSONTypes.RegExp },
        { label: 'BSONSymbol', tag: 'BSONSymbol', props: { value: 'sym' }, expected: BSONTypes.Symbol },
        { label: 'Code', tag: 'Code', props: { code: 'x' }, expected: BSONTypes.Code },
        {
            label: 'Code carrying a scope',
            tag: 'Code',
            props: { code: 'x', scope: { a: 1 } },
            expected: BSONTypes.CodeWithScope,
        },
        { label: 'DBRef', tag: 'DBRef', props: { collection: 'c', db: 'd', oid: {} }, expected: BSONTypes.DBRef },
        { label: 'MinKey', tag: 'MinKey', props: {}, expected: BSONTypes.MinKey },
        { label: 'MaxKey', tag: 'MaxKey', props: {}, expected: BSONTypes.MaxKey },
    ];

    it.each(taggedCases)('classifies a foreign $label as $expected', ({ tag, props, expected }) => {
        expect(BSONTypes.inferType(foreign(tag, props))).toBe(expected);
    });

    it.each(taggedCases)('treats an ordinary document with the recognized $tag tag as data', ({ tag }) => {
        expect(BSONTypes.inferType({ _bsontype: tag, value: 1 })).toBe(BSONTypes.Object);
    });

    it.each([
        { label: 'null prototype', value: Object.assign(Object.create(null) as object, { _bsontype: 'ObjectId' }) },
        { label: 'shadowed hasOwnProperty', value: { _bsontype: 'ObjectId', hasOwnProperty: false } },
        { label: 'own tag over an inherited tag', value: foreign('Double', { _bsontype: 'ObjectId' }) },
        { label: 'cross-realm document', value: runInNewContext('({ _bsontype: "ObjectId", value: 1 })') as unknown },
    ])('treats $label with an own tag as data', ({ value }) => {
        expect(BSONTypes.inferType(value)).toBe(BSONTypes.Object);
    });

    it('does not read a tag inherited from Object.prototype', () => {
        const previousDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, '_bsontype');
        const readTag = jest.fn(() => 'ObjectId');
        try {
            Object.defineProperty(Object.prototype, '_bsontype', { configurable: true, get: readTag });
            expect(BSONTypes.inferType({ value: 1 })).toBe(BSONTypes.Object);
            expect(BSONTypes.inferType(Object.create(null) as object)).toBe(BSONTypes.Object);
            expect(readTag).not.toHaveBeenCalled();
        } finally {
            if (previousDescriptor) {
                Object.defineProperty(Object.prototype, '_bsontype', previousDescriptor);
            } else {
                Reflect.deleteProperty(Object.prototype, '_bsontype');
            }
        }
    });

    // '__proto__', 'constructor' and friends resolved to inherited members back when the tag
    // map was an object literal, and were returned as if they were types.
    it.each(['NotABsonType', '', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
        'treats the unsupported tag %p as a plain object',
        (tag) => {
            expect(BSONTypes.inferType(foreign(tag, { nested: 1 }))).toBe(BSONTypes.Object);
        },
    );

    it.each([[42], [null], [undefined], [{}]])('treats the non-string tag %p as a plain object', (tag) => {
        expect(BSONTypes.inferType(foreign(tag, { nested: 1 }))).toBe(BSONTypes.Object);
    });
});

describe('BSONTypes.inferType path agreement', () => {
    const realValues: ReadonlyArray<{ label: string; value: object }> = [
        { label: 'ObjectId', value: new ObjectId() },
        { label: 'Int32', value: new Int32(7) },
        { label: 'Double', value: new Double(1.5) },
        { label: 'Long', value: Long.fromNumber(9) },
        { label: 'Decimal128', value: Decimal128.fromString('1.5') },
        { label: 'Timestamp', value: new Timestamp({ t: 1, i: 1 }) },
        { label: 'Binary', value: new Binary(new Uint8Array(4), 0) },
        { label: 'Binary with the UUID subtype', value: new Binary(new Uint8Array(16), Binary.SUBTYPE_UUID) },
        {
            label: 'Binary with the legacy UUID subtype',
            value: new Binary(new Uint8Array(16), Binary.SUBTYPE_UUID_OLD),
        },
        { label: 'UUID', value: new UUID() },
        { label: 'BSONRegExp', value: new BSONRegExp('a', 'i') },
        { label: 'BSONSymbol', value: new BSONSymbol('sym') },
        { label: 'Code', value: new Code('x') },
        { label: 'Code carrying a scope', value: new Code('x', { a: 1 }) },
        { label: 'DBRef', value: new DBRef('c', new ObjectId()) },
        { label: 'MinKey', value: new MinKey() },
        { label: 'MaxKey', value: new MaxKey() },
    ];

    // The two paths disagreeing is the whole failure mode: the same value must not get one
    // answer locally and another after a bundler loads a second copy of `bson`.
    it.each(realValues)('$label is classified the same locally and through the tag fallback', ({ value }) => {
        const twin = foreign((value as { _bsontype?: unknown })._bsontype, { ...value });

        expect(BSONTypes.inferType(twin)).toBe(BSONTypes.inferType(value));
    });

    it.each(realValues)('$label is not classified as a plain object', ({ value }) => {
        expect(BSONTypes.inferType(value)).not.toBe(BSONTypes.Object);
    });
});
