/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Document, type WithId } from 'mongodb';
import { SchemaAnalyzer } from '../src/SchemaAnalyzer';

interface TaggedDocumentCase {
    readonly label: string;
    readonly payload: unknown;
}

/**
 * Values produced by a second copy of the `bson` package (for example when a bundler
 * resolves the ESM entry for one importer and the CommonJS entry for another) fail every
 * `instanceof` check while still carrying the `_bsontype` discriminator. Without the tag
 * fallback they are classified as plain objects and their internals leak into the schema
 * as fields such as `_id.buffer` or `rating.value`.
 */
function foreign(bsontype: string, ownProps: Record<string, unknown>): unknown {
    return Object.assign(Object.create({ _bsontype: bsontype }) as object, ownProps);
}

describe('SchemaAnalyzer with BSON values from a foreign bson copy', () => {
    it('classifies tagged wrappers by type instead of exposing their internals', () => {
        const document = {
            _id: foreign('ObjectId', { buffer: new Uint8Array(12) }),
            rating: foreign('Double', { value: 4.5 }),
            votes: foreign('Int32', { value: 3 }),
            balance: foreign('Decimal128', { bytes: new Uint8Array(16) }),
            views: foreign('Long', { low: 1, high: 0, unsigned: false }),
            token: foreign('Binary', { buffer: new Uint8Array(4), sub_type: 4, position: 4 }),
            name: 'Diner',
        } as unknown as WithId<Document>;

        const fields = SchemaAnalyzer.fromDocument(document).getKnownFields();

        expect(fields.map((f) => `${f.path}:${f.bsonType}`)).toEqual([
            '_id:objectid',
            'balance:decimal128',
            'name:string',
            'rating:double',
            'token:uuid',
            'views:long',
            'votes:int32',
        ]);
    });

    // MinKey and MaxKey have no own enumerable properties, so misclassifying them as objects
    // made the fields vanish from the output entirely rather than report a wrong type.
    it('keeps fields whose wrapper has no own properties', () => {
        const document = {
            _id: foreign('ObjectId', { buffer: new Uint8Array(12) }),
            lowest: foreign('MinKey', {}),
            highest: foreign('MaxKey', {}),
        } as unknown as WithId<Document>;

        const fields = SchemaAnalyzer.fromDocument(document).getKnownFields();

        expect(fields.map((f) => `${f.path}:${f.bsonType}`)).toEqual([
            '_id:objectid',
            'highest:maxkey',
            'lowest:minkey',
        ]);
    });

    it('still treats untagged plain objects as nested documents', () => {
        const document = {
            _id: foreign('ObjectId', { buffer: new Uint8Array(12) }),
            address: { street: 'Main', zipcode: '10001' },
        } as unknown as WithId<Document>;

        const fields = SchemaAnalyzer.fromDocument(document).getKnownFields();

        expect(fields.map((f) => f.path)).toEqual(['_id', 'address.street', 'address.zipcode']);
    });

    it.each<TaggedDocumentCase>([
        { label: 'plain document', payload: { _bsontype: 'ObjectId', value: 1 } },
        {
            label: 'null-prototype document',
            payload: Object.assign(Object.create(null) as object, { _bsontype: 'ObjectId', value: 1 }),
        },
        {
            label: 'document shadowing hasOwnProperty',
            payload: { _bsontype: 'ObjectId', value: 1, hasOwnProperty: false },
        },
    ])('traverses recognized tag fields in a $label', ({ payload }) => {
        const document = {
            _id: foreign('ObjectId', { buffer: new Uint8Array(12) }),
            payload,
        } as unknown as WithId<Document>;

        const fields = SchemaAnalyzer.fromDocument(document).getKnownFields();

        expect(fields.map((field) => `${field.path}:${field.bsonType}`)).toEqual(
            expect.arrayContaining(['_id:objectid', 'payload._bsontype:string', 'payload.value:double']),
        );
        expect(fields.some((field) => field.path === 'payload')).toBe(false);
    });

    it('traverses documents despite a tag on Object.prototype', () => {
        const previousDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, '_bsontype');
        try {
            Object.defineProperty(Object.prototype, '_bsontype', { configurable: true, value: 'ObjectId' });
            const document = { payload: { value: 1 } } as unknown as WithId<Document>;
            const fields = SchemaAnalyzer.fromDocument(document).getKnownFields();
            expect(fields.map((field) => `${field.path}:${field.bsonType}`)).toEqual(['payload.value:double']);
        } finally {
            if (previousDescriptor) {
                Object.defineProperty(Object.prototype, '_bsontype', previousDescriptor);
            } else {
                Reflect.deleteProperty(Object.prototype, '_bsontype');
            }
        }
    });
});
