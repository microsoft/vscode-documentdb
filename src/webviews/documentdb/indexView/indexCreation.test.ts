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

describe('vector index creation', () => {
    const hnswInput: CreateIndexInput = {
        kind: 'vector',
        field: 'embedding',
        dimensions: 1536,
        similarity: 'COS',
        algorithm: { kind: 'vector-hnsw', m: 16, efConstruction: 64 },
    };

    it('builds a cosmosSearch key with HNSW options', () => {
        const spec = buildIndexSpec(hnswInput);
        expect(spec.key).toEqual({ embedding: 'cosmosSearch' });
        expect(spec.cosmosSearchOptions).toEqual({
            kind: 'vector-hnsw',
            dimensions: 1536,
            similarity: 'COS',
            m: 16,
            efConstruction: 64,
        });
        // No explicit name → the server generates one.
        expect(spec.name).toBeUndefined();
    });

    it('builds IVF options with numLists', () => {
        const spec = buildIndexSpec({
            kind: 'vector',
            field: 'embedding',
            dimensions: 4,
            similarity: 'L2',
            algorithm: { kind: 'vector-ivf', numLists: 10 },
        });
        expect(spec.cosmosSearchOptions).toEqual({
            kind: 'vector-ivf',
            dimensions: 4,
            similarity: 'L2',
            numLists: 10,
        });
    });

    it('builds DiskANN options with product quantization', () => {
        const spec = buildIndexSpec({
            kind: 'vector',
            field: 'embedding',
            name: 'embedding_pq',
            dimensions: 1536,
            similarity: 'IP',
            algorithm: { kind: 'vector-diskann', maxDegree: 32, lBuild: 50 },
            compression: { kind: 'pq', pqCompressedDims: 96, pqSampleSize: 2000 },
        });
        expect(spec.name).toBe('embedding_pq');
        expect(spec.cosmosSearchOptions).toEqual({
            kind: 'vector-diskann',
            dimensions: 1536,
            similarity: 'IP',
            maxDegree: 32,
            lBuild: 50,
            compression: 'pq',
            pqCompressedDims: 96,
            pqSampleSize: 2000,
        });
    });

    it('adds half-precision compression for HNSW', () => {
        const spec = buildIndexSpec({
            ...hnswInput,
            dimensions: 3072,
            compression: { kind: 'half' },
        } as CreateIndexInput);
        expect(spec.cosmosSearchOptions).toMatchObject({ compression: 'half' });
    });

    it('renders a createIndex shell command with cosmosSearchOptions', () => {
        expect(buildCreateIndexShellCommand('products', hnswInput)).toBe(
            'db.getCollection("products").createIndex({"embedding":"cosmosSearch"}, ' +
                '{"cosmosSearchOptions":{"kind":"vector-hnsw","dimensions":1536,"similarity":"COS","m":16,"efConstruction":64}})',
        );
    });

    it('includes an explicit name in the shell command', () => {
        const command = buildCreateIndexShellCommand('products', { ...hnswInput, name: 'my_vec' } as CreateIndexInput);
        expect(command).toContain('"name":"my_vec"');
        expect(command).toContain('"cosmosSearchOptions"');
    });

    it('accepts a valid vector definition', () => {
        expect(CreateIndexInputSchema.safeParse(hnswInput).success).toBe(true);
    });

    it.each([
        {
            name: 'm below the minimum',
            input: { ...hnswInput, algorithm: { kind: 'vector-hnsw', m: 1, efConstruction: 64 } },
        },
        {
            name: 'efConstruction below 2 × m',
            input: { ...hnswInput, algorithm: { kind: 'vector-hnsw', m: 40, efConstruction: 64 } },
        },
        {
            name: 'half precision on DiskANN',
            input: {
                kind: 'vector',
                field: 'embedding',
                dimensions: 1536,
                similarity: 'COS',
                algorithm: { kind: 'vector-diskann', maxDegree: 32, lBuild: 50 },
                compression: { kind: 'half' },
            },
        },
        {
            name: 'product quantization on HNSW',
            input: { ...hnswInput, compression: { kind: 'pq' } },
        },
        {
            name: 'compressed dimensions not smaller than dimensions',
            input: {
                kind: 'vector',
                field: 'embedding',
                dimensions: 96,
                similarity: 'COS',
                algorithm: { kind: 'vector-diskann', maxDegree: 32, lBuild: 50 },
                compression: { kind: 'pq', pqCompressedDims: 96 },
            },
        },
        {
            name: 'non-integer dimensions',
            input: { ...hnswInput, dimensions: 1.5 },
        },
        {
            name: 'reserved index name',
            input: { ...hnswInput, name: '*' },
        },
    ])('rejects an invalid vector definition: $name', ({ input }) => {
        expect(CreateIndexInputSchema.safeParse(input).success).toBe(false);
    });
});
