/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shape of a single index row sent to the webview. Combines the raw
 * `IndexItemModel` data (name, key, flags) with the per-index statistics
 * (memory size, usage counter, time window) we pull from `collStats` and
 * `$indexStats` on the extension side so the React layer never has to know
 * the wire-level command names.
 */
export interface IndexRow {
    /** Index name, e.g. `_id_` or `name_1_age_-1`. */
    name: string;
    /** Raw key specification, ordered. */
    key: ReadonlyArray<{ field: string; direction: number | string }>;
    /** Whether this index is hidden from the query planner. */
    hidden: boolean;
    unique: boolean;
    sparse: boolean;
    /** TTL in seconds (only present on TTL indexes). */
    expireAfterSeconds?: number;
    /** Partial-index filter document (only present on partial indexes). */
    partialFilterExpression?: Record<string, unknown>;
    /** Custom collation document (only present when the index defines one). */
    collation?: Record<string, unknown>;
    /** Wildcard projection document (only present on wildcard indexes with a projection). */
    wildcardProjection?: Record<string, unknown>;
    /** Known options reported for a DocumentDB vector index. */
    vectorOptions?: VectorIndexOptions;
    /** Bytes consumed by this index in storage (from collStats.indexSizes). */
    sizeBytes?: number;
    /** Number of times the index has been used since `usageSince`. */
    usageOps?: number;
    /** ISO timestamp string from which usage stats started accumulating. */
    usageSince?: string;
    /** True for the special `_id_` index — cannot be dropped, hidden, or edited. */
    isDefault: boolean;
    /** Whether the underlying server reported stats successfully. */
    statsAvailable: boolean;
    /**
     * Build state of the index:
     * - `ready` — a normal, usable index (default when the server reports nothing special).
     * - `building` — the server reports this index as still building (`$indexStats.building`).
     * - `creating` — a client-only optimistic row shown while a just-submitted create is in flight.
     */
    state?: 'ready' | 'building' | 'creating';
}

/** Display-safe subset of the options returned in `cosmosSearchOptions`. */
export interface VectorIndexOptions {
    kind?: string;
    dimensions?: number;
    similarity?: string;
    numLists?: number;
    m?: number;
    efConstruction?: number;
    maxDegree?: number;
    lBuild?: number;
    compression?: string;
    pqCompressedDims?: number;
    pqSampleSize?: number;
}

/** Logical badge category used for the colour-coded Type column. */
export type IndexTypeBadge =
    | 'Default'
    | 'ObjectId'
    | 'Single Field'
    | 'Compound'
    | 'Text'
    | 'Geospatial'
    | 'Wildcard'
    | 'Hashed'
    | 'Vector';

/** Sort direction stored alongside a field in the create-index form. */
export type SortDirection = 1 | -1;

/**
 * Per-field index type in the Create Index form. `asc`/`desc` are ordinary
 * b-tree keys; `text`/`2dsphere`/`hashed` are special key types applied to the
 * field they sit on. This mirrors the driver's key spec, where each field maps
 * to a direction (±1) or a type sentinel string.
 */
export type FieldIndexType = 'asc' | 'desc' | 'text' | '2dsphere' | 'hashed';

/** One key in the create-index form: a field path plus its per-field type. */
export interface CreateIndexField {
    field: string;
    type: FieldIndexType;
}

/**
 * Field-keyed create-index payload used by the Standard and Wildcard forms.
 * Field types live on each key; TTL, unique, sparse, partial filter and
 * collation are index-level options — matching the driver's two-argument
 * `createIndex(keys, options)` shape rather than a single "index type".
 */
export interface FieldCreateIndexInput {
    fields: CreateIndexField[];
    name?: string;
    unique?: boolean;
    sparse?: boolean;
    expireAfterSeconds?: number;
    /** Raw partial-filter JSON text, parsed (loosely) on the extension side. */
    partialFilterExpression?: string;
    /** Raw collation JSON text, parsed (loosely) on the extension side. */
    collation?: string;
    /** Raw wildcard-projection JSON text, parsed (loosely) on the extension side. */
    wildcardProjection?: string;
}

/** Distance metric a DocumentDB vector index compares vectors with. */
export type VectorSimilarity = 'COS' | 'L2' | 'IP';

/** Approximate-nearest-neighbour algorithm a DocumentDB vector index uses. */
export type VectorAlgorithmKind = 'vector-ivf' | 'vector-hnsw' | 'vector-diskann';

/**
 * Algorithm choice plus its own build-time tuning. Discriminated on `kind` so
 * an IVF index can never carry HNSW settings and vice versa.
 */
export type VectorAlgorithmSpec =
    | { kind: 'vector-ivf'; numLists: number }
    | { kind: 'vector-hnsw'; m: number; efConstruction: number }
    | { kind: 'vector-diskann'; maxDegree: number; lBuild: number };

/**
 * Optional index compression. Half precision applies to IVF/HNSW; product
 * quantization applies to DiskANN. The `pq` variant carries optional tuning.
 */
export type VectorCompressionSpec = { kind: 'half' } | { kind: 'pq'; pqCompressedDims?: number; pqSampleSize?: number };

/**
 * Create-index payload for a DocumentDB vector (`cosmosSearch`) index. It is
 * shaped for its own service contract rather than folding vector-only options
 * into the field-keyed payload, so invalid states (e.g. a vector index with
 * TTL) are unrepresentable.
 */
export interface VectorCreateIndexInput {
    kind: 'vector';
    /** The single field path the vector is indexed on. */
    field: string;
    name?: string;
    /** Fixed number of values in each vector; comes from the embedding model. */
    dimensions: number;
    similarity: VectorSimilarity;
    algorithm: VectorAlgorithmSpec;
    compression?: VectorCompressionSpec;
}

/**
 * Payload sent from the webview when the user submits the Create Index drawer.
 * A discriminated union: vector indexes carry `kind: 'vector'`, while Standard
 * and Wildcard indexes use the field-keyed shape.
 */
export type CreateIndexInput = FieldCreateIndexInput | VectorCreateIndexInput;

/** Narrow a create-index payload to its vector variant. */
export function isVectorCreateIndexInput(input: CreateIndexInput): input is VectorCreateIndexInput {
    return 'kind' in input && input.kind === 'vector';
}
