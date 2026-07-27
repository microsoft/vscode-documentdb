/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { buildCreateIndexShellCommand, buildIndexSpec, CreateIndexInputSchema } from './indexCreation';
import { type CreateIndexInput } from './types';

const ordinaryInput: CreateIndexInput = {
    fields: [{ field: 'name', type: 'asc' }],
};

describe('wildcard index creation', () => {
    it('builds all-fields and scoped wildcard keys', () => {
        const allFieldsInput: CreateIndexInput = { fields: [{ field: '$**', type: 'asc' }] };
        const scopedInput: CreateIndexInput = { fields: [{ field: 'metadata.$**', type: 'asc' }] };

        expect(buildIndexSpec(allFieldsInput).key).toEqual({ '$**': 1 });
        expect(buildIndexSpec(scopedInput).key).toEqual({
            'metadata.$**': 1,
        });
        expect(buildCreateIndexShellCommand('collection', allFieldsInput)).toBe(
            'db.getCollection("collection").createIndex({"$**":1})',
        );
        expect(buildCreateIndexShellCommand('collection', scopedInput)).toBe(
            'db.getCollection("collection").createIndex({"metadata.$**":1})',
        );
    });

    it('parses and forwards a wildcard projection', () => {
        const input: CreateIndexInput = {
            fields: [{ field: '$**', type: 'asc' }],
            wildcardProjection: "{ name: 1, 'metadata.category': 1 }",
        };

        expect(buildIndexSpec(input).wildcardProjection).toEqual({ name: 1, 'metadata.category': 1 });
        expect(buildCreateIndexShellCommand('collection', input)).toContain(
            `"wildcardProjection":{ name: 1, 'metadata.category': 1 }`,
        );
    });

    it.each([
        {
            name: 'an ordinary compound field',
            input: {
                fields: [
                    { field: '$**', type: 'asc' },
                    { field: 'name', type: 'asc' },
                ],
            },
        },
        { name: 'unique', input: { fields: [{ field: '$**', type: 'asc' }], unique: true } },
        { name: 'sparse', input: { fields: [{ field: '$**', type: 'asc' }], sparse: true } },
        {
            name: 'TTL',
            input: { fields: [{ field: '$**', type: 'asc' }], expireAfterSeconds: 60 },
        },
        { name: 'descending direction', input: { fields: [{ field: '$**', type: 'desc' }] } },
    ])('rejects wildcard indexes combined with $name', ({ input }) => {
        expect(CreateIndexInputSchema.safeParse(input).success).toBe(false);
    });

    it('rejects a projection without a wildcard key', () => {
        expect(CreateIndexInputSchema.safeParse({ ...ordinaryInput, wildcardProjection: '{ name: 1 }' }).success).toBe(
            false,
        );
    });

    it('rejects a projection on a scoped path wildcard key', () => {
        expect(
            CreateIndexInputSchema.safeParse({
                fields: [{ field: 'metadata.$**', type: 'asc' }],
                wildcardProjection: '{ name: 1 }',
            }).success,
        ).toBe(false);
    });

    it('allows a scoped path wildcard key without a projection', () => {
        expect(CreateIndexInputSchema.safeParse({ fields: [{ field: 'metadata.$**', type: 'asc' }] }).success).toBe(
            true,
        );
    });

    it.each(['', '   ', '{}', '{  }'])(
        'treats a blank projection as unset on a scoped path wildcard key: %s',
        (wildcardProjection) => {
            expect(
                CreateIndexInputSchema.safeParse({
                    fields: [{ field: 'metadata.$**', type: 'asc' }],
                    wildcardProjection,
                }).success,
            ).toBe(true);
        },
    );

    it.each(['', '   ', '{}', '{  }'])(
        'treats a blank wildcard projection as unset on an ordinary index: %s',
        (wildcardProjection) => {
            expect(CreateIndexInputSchema.safeParse({ ...ordinaryInput, wildcardProjection }).success).toBe(true);
        },
    );

    it.each(['', '   ', '{}', '{  }'])(
        'treats a blank wildcard projection as unset on a wildcard index: %s',
        (wildcardProjection) => {
            expect(
                CreateIndexInputSchema.safeParse({ fields: [{ field: '$**', type: 'asc' }], wildcardProjection })
                    .success,
            ).toBe(true);
        },
    );

    it.each(['not valid {', '[]', '42'])('rejects invalid wildcard projection text: %s', (wildcardProjection) => {
        const input: CreateIndexInput = {
            fields: [{ field: '$**', type: 'asc' }],
            wildcardProjection,
        };

        expect(CreateIndexInputSchema.safeParse(input).success).toBe(false);
        expect(() => buildIndexSpec(input)).toThrow(/wildcard projection/i);
    });

    it('preserves existing non-wildcard index behavior', () => {
        expect(CreateIndexInputSchema.safeParse(ordinaryInput).success).toBe(true);
        expect(buildCreateIndexShellCommand('collection', ordinaryInput)).toBe(
            'db.getCollection("collection").createIndex({"name":1})',
        );
    });
});
