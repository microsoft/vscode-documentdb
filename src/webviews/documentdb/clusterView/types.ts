/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Per-row metric load state. Rows render immediately from the cheap list call
 * with `status: 'loading'`, then transition to `loaded` (metrics present) or
 * `unavailable` (stats call failed or was denied) as results stream in.
 */
export type MetricStatus = 'loading' | 'loaded' | 'unavailable';

/** A single database row in the cluster overview table. */
export interface DatabaseRow {
    name: string;
    status: MetricStatus;
    /** On-disk storage size in bytes. `undefined` until loaded or when unavailable. */
    storageSize?: number;
    /** Number of collections; `undefined` until loaded or when unavailable. */
    collectionCount?: number;
    /** Total number of indexes across the database. */
    indexCount?: number;
}

/** A single collection row in the database drill-in table. */
export interface CollectionRow {
    name: string;
    status: MetricStatus;
    /** On-disk storage size in bytes. `undefined` until loaded or when unavailable. */
    storageSize?: number;
    /** Number of documents in the collection. */
    documentCount?: number;
    /** Average document size in bytes. */
    avgDocumentSize?: number;
    /** Number of indexes on the collection. */
    indexCount?: number;
    /** Total size in bytes of all indexes on the collection. */
    totalIndexSize?: number;
}

/** Metrics returned by the `getDatabaseMetrics` procedure. */
export interface DatabaseMetrics {
    /** On-disk storage size in bytes (`dbStats.storageSize`). */
    storageSize: number;
    /** Number of collections (`dbStats.collections`). */
    collectionCount: number;
    /** Total number of indexes across the database (`dbStats.indexes`). */
    indexCount: number;
}

/** Metrics returned by the `getCollectionMetrics` procedure. */
export interface CollectionMetrics {
    /** On-disk storage size in bytes (`collStats.storageSize`). */
    storageSize: number;
    /** Number of documents (`collStats.count`). */
    documentCount: number;
    /** Average document size in bytes (`collStats.avgObjSize`). */
    avgDocumentSize: number;
    /** Number of indexes (`collStats.nindexes`). */
    indexCount: number;
    /** Total size in bytes of all indexes (`collStats.totalIndexSize`). */
    totalIndexSize: number;
}

/** Sortable column keys for the database overview table. */
export type DatabaseSortColumn = 'name' | 'storageSize' | 'collectionCount' | 'indexCount';

/** Sortable column keys for the collection drill-in table. */
export type CollectionSortColumn =
    | 'name'
    | 'storageSize'
    | 'documentCount'
    | 'avgDocumentSize'
    | 'indexCount'
    | 'totalIndexSize';

/** Sort direction for the dashboard tables. */
export type SortDirection = 'ascending' | 'descending';

/** Result of a create-database / create-collection flow. */
export interface CreateResult {
    /** True when an entity was created and the dashboard table should refresh. */
    created: boolean;
    /**
     * Human-readable message for a pre-flight failure the dashboard should
     * surface inline (e.g. not signed in). Errors raised during the wizard
     * itself are shown natively by the command infrastructure, not here.
     */
    error?: string;
}
