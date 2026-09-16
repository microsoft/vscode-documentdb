/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type VectorIndexOptions } from '../types';

interface RawVectorIndexOptions {
    cosmosSearchOptions?: unknown;
    cosmosSearch?: unknown;
}

function optionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Normalize known vector settings without rejecting future service options. */
export function normalizeVectorIndexOptions(value: unknown): VectorIndexOptions | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
    }

    const options = value as Record<string, unknown>;
    return {
        kind: optionalString(options.kind),
        dimensions: optionalNumber(options.dimensions),
        similarity: optionalString(options.similarity),
        numLists: optionalNumber(options.numLists),
        m: optionalNumber(options.m),
        efConstruction: optionalNumber(options.efConstruction),
        maxDegree: optionalNumber(options.maxDegree),
        lBuild: optionalNumber(options.lBuild),
        compression: optionalString(options.compression),
        pqCompressedDims: optionalNumber(options.pqCompressedDims),
        pqSampleSize: optionalNumber(options.pqSampleSize),
    };
}

export function getVectorIndexOptions(index: RawVectorIndexOptions): VectorIndexOptions | undefined {
    return normalizeVectorIndexOptions(index.cosmosSearchOptions) ?? normalizeVectorIndexOptions(index.cosmosSearch);
}

export function formatVectorAlgorithm(kind: string | undefined): string | undefined {
    switch (kind) {
        case 'vector-ivf':
            return 'IVF';
        case 'vector-hnsw':
            return 'HNSW';
        case 'vector-diskann':
            return 'DiskANN';
        default:
            return kind;
    }
}

function similaritySearchName(similarity: string | undefined): string | undefined {
    switch (similarity) {
        case 'COS':
            return 'cosine';
        case 'L2':
            return 'euclidean';
        case 'IP':
            return 'inner product';
        default:
            return undefined;
    }
}

function compressionSearchName(compression: string | undefined): string | undefined {
    switch (compression) {
        case 'half':
            return 'half precision';
        case 'pq':
            return 'product quantization';
        default:
            return undefined;
    }
}

export function vectorIndexSearchText(options: VectorIndexOptions | undefined): string {
    if (!options) {
        return '';
    }

    return [
        'vector',
        formatVectorAlgorithm(options.kind),
        options.kind,
        options.dimensions,
        options.similarity,
        similaritySearchName(options.similarity),
        options.compression,
        compressionSearchName(options.compression),
        options.numLists,
        options.m,
        options.efConstruction,
        options.maxDegree,
        options.lBuild,
        options.pqCompressedDims,
        options.pqSampleSize,
    ]
        .filter((value) => value !== undefined)
        .join(' ')
        .toLowerCase();
}
