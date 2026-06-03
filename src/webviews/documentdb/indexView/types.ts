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
    /** Bytes consumed by this index in storage (from collStats.indexSizes). */
    sizeBytes?: number;
    /** Number of times the index has been used since `usageSince`. */
    usageOps?: number;
    /** ISO timestamp string from which usage stats started accumulating. */
    usageSince?: string;
    /** Optional user-supplied notes (currently a placeholder for future persistence). */
    notes?: string;
    /** True for the special `_id_` index — cannot be dropped, hidden, or edited. */
    isDefault: boolean;
    /** Whether the underlying server reported stats successfully. */
    statsAvailable: boolean;
}

/** Logical badge category used for the colour-coded Type column. */
export type IndexTypeBadge = 'Default' | 'ObjectId' | 'Single Field' | 'Compound' | 'Text' | 'Geospatial';

/** Sort direction stored alongside a field in the create-index form. */
export type SortDirection = 1 | -1;

/** Index type choice for the Create Index modal. */
export type CreateIndexType = 'singleField' | 'ttl' | 'geospatial' | 'text';

/** Payload sent from the webview when the user submits the Create Index dialog. */
export interface CreateIndexInput {
    fields: Array<{ field: string; direction: SortDirection }>;
    type: CreateIndexType;
    name?: string;
    notes?: string;
    unique?: boolean;
    sparse?: boolean;
    expireAfterSeconds?: number;
}
