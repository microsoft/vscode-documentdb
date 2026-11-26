/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EJSON, UUID } from 'bson';
import { BSONRegExp, DBRef, Decimal128, Double, Int32, Long, ObjectId, type Document } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { assignRowIdentities, isIdentityTrustedForProjection, toDocumentId } from './documentIdentity';

describe('documentIdentity', () => {
    it('round-trips falsy, BSON and composite IDs through the existing default action parser', () => {
        const ids: unknown[] = [
            0,
            false,
            '',
            null,
            'plain',
            new ObjectId('000000000000000000000001'),
            new UUID('00112233-4455-6677-8899-aabbccddeeff'),
            new Int32(7),
            new Double(1.5),
            Decimal128.fromString('1.25'),
            new Date('2026-11-26T00:00:00Z'),
            { author: 'John', userId: 0, nested: { value: null }, items: [false, ''] },
        ];
        for (const id of ids) {
            const canonical = EJSON.stringify(id, { relaxed: false });
            expect(toDocumentId({ _id: id })).toBe(canonical);
            expect(EJSON.stringify(EJSON.parse(canonical), { relaxed: false })).toBe(canonical);
        }
    });

    it('withholds numeric subtype IDs that the default parser changes', () => {
        for (const id of [
            new Double(7),
            Long.fromNumber(7),
            Long.fromString('9007199254740993'),
            { n: Long.fromNumber(7) },
        ]) {
            expect(toDocumentId({ _id: id })).toBeUndefined();
        }
    });

    it('requires an own ID and rejects undefined and unsupported root types', () => {
        const inherited = Object.create({ _id: 'inherited' }) as Document;
        expect(toDocumentId(inherited)).toBeUndefined();
        expect(toDocumentId({})).toBeUndefined();
        for (const id of [
            undefined,
            [],
            /pattern/,
            new BSONRegExp('pattern'),
            new Map([['key', 'value']]),
            new DBRef('refs', new ObjectId()),
            Symbol('id'),
            (): void => {},
            new (class UnknownId {
                value = 1;
            })(),
        ]) {
            expect(toDocumentId({ _id: id })).toBeUndefined();
        }
    });

    it('rejects operator-like keys, undefined and invalid dates inside composite IDs', () => {
        for (const id of [
            { $eq: 'wrong' },
            { nested: { $gt: 0 } },
            { nested: [{ $in: [] }] },
            { nested: undefined },
            { nested: [undefined] },
            { nested: new Date(NaN) },
            new Date(NaN),
        ]) {
            expect(toDocumentId({ _id: id })).toBeUndefined();
        }
        const circular: Document = {};
        circular.self = circular;
        expect(toDocumentId({ _id: circular })).toBeUndefined();
    });

    it('allows prototype-like literal ID fields without treating them as metadata', () => {
        const id: unknown = JSON.parse('{"__proto__":"value","constructor":0,"id":false}');
        expect(toDocumentId({ _id: id })).toBe(EJSON.stringify(id, { relaxed: false }));
        expect(toDocumentId({ _id: { a: 1, b: 2 } })).not.toBe(toDocumentId({ _id: { b: 2, a: 1 } }));
    });

    it('trusts only unchanged projection provenance and simple root flags', () => {
        for (const projection of [undefined, {}, { name: 1 }, { _id: 0 }, { _id: 1 }, { _id: false }, { _id: true }]) {
            expect(isIdentityTrustedForProjection(projection)).toBe(true);
        }
        for (const projection of [
            { _id: '$name' },
            { _id: { $literal: 1 } },
            { _id: { x: 1 } },
            { '_id.x': 1 },
            { _id: undefined },
        ]) {
            expect(isIdentityTrustedForProjection(projection)).toBe(false);
        }
    });

    it('gives only unique trusted IDs stable keys, leaving every other row positional', () => {
        const documents: Document[] = [{ _id: 'unique' }, { _id: 'duplicate' }, {}, { _id: 'duplicate' }, { _id: 0 }];
        const identities = assignRowIdentities(documents, true);
        expect(identities).toEqual([
            { rowKey: 'id:"unique"', documentId: '"unique"' },
            { rowKey: 'pos:1' },
            { rowKey: 'pos:2' },
            { rowKey: 'pos:3' },
            { rowKey: 'id:{"$numberInt":"0"}', documentId: '{"$numberInt":"0"}' },
        ]);
        expect(assignRowIdentities([...documents].reverse(), true).at(-1)).toEqual(identities[0]);
        expect(assignRowIdentities(documents, false)).toEqual(documents.map((_, index) => ({ rowKey: `pos:${index}` })));
        expect(new Set(identities.map((identity) => identity.rowKey)).size).toBe(documents.length);
        expect(assignRowIdentities([{ _id: { a: 0 } }, { _id: { a: 0 } }], true)).toEqual([
            { rowKey: 'pos:0' },
            { rowKey: 'pos:1' },
        ]);
    });
});
