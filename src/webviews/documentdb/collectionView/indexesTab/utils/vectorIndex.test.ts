/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { classifyIndex } from './indexType';
import {
    formatVectorAlgorithm,
    getVectorIndexOptions,
    normalizeVectorIndexOptions,
    vectorIndexSearchText,
} from './vectorIndex';

describe('vector index listing', () => {
    it('classifies the observed DocumentDB key sentinel as Vector', () => {
        expect(
            classifyIndex({
                name: 'dbg_vec_hnsw_l2_4d_m16_ef64',
                key: [{ field: 'vectorDebug.hnswL2_4d', direction: 'cosmosSearch' }],
            }),
        ).toBe('Vector');
    });

    it('normalizes the observed DocumentDB vector options', () => {
        expect(
            normalizeVectorIndexOptions({
                kind: 'vector-hnsw',
                dimensions: 4,
                similarity: 'L2',
                m: 16,
                efConstruction: 64,
            }),
        ).toEqual({
            kind: 'vector-hnsw',
            dimensions: 4,
            similarity: 'L2',
            numLists: undefined,
            m: 16,
            efConstruction: 64,
            maxDegree: undefined,
            lBuild: undefined,
            compression: undefined,
            pqCompressedDims: undefined,
            pqSampleSize: undefined,
        });
    });

    it('ignores malformed known settings without rejecting the options object', () => {
        expect(
            normalizeVectorIndexOptions({
                kind: 'vector-future',
                dimensions: 'four',
                similarity: 'FUTURE',
                futureSetting: true,
            }),
        ).toEqual({
            kind: 'vector-future',
            dimensions: undefined,
            similarity: 'FUTURE',
            numLists: undefined,
            m: undefined,
            efConstruction: undefined,
            maxDegree: undefined,
            lBuild: undefined,
            compression: undefined,
            pqCompressedDims: undefined,
            pqSampleSize: undefined,
        });
        expect(normalizeVectorIndexOptions(null)).toBeUndefined();
    });

    it('accepts the alternate option container when the primary container is malformed', () => {
        expect(
            getVectorIndexOptions({
                cosmosSearchOptions: 'unavailable',
                cosmosSearch: { kind: 'vector-ivf', dimensions: 4, similarity: 'COS', numLists: 10 },
            }),
        ).toMatchObject({
            kind: 'vector-ivf',
            dimensions: 4,
            similarity: 'COS',
            numLists: 10,
        });
    });

    it('builds searchable text for vector metadata', () => {
        const options = normalizeVectorIndexOptions({
            kind: 'vector-diskann',
            dimensions: 1536,
            similarity: 'COS',
            compression: 'pq',
            pqCompressedDims: 96,
            pqSampleSize: 2000,
        });

        expect(formatVectorAlgorithm(options?.kind)).toBe('DiskANN');
        expect(vectorIndexSearchText(options)).toContain('1536');
        expect(vectorIndexSearchText(options)).toContain('cosine');
        expect(vectorIndexSearchText(options)).toContain('product quantization');
        expect(vectorIndexSearchText(undefined)).toBe('');
    });
});
