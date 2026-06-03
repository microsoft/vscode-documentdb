/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * =============================================================================
 *  Index Management — tRPC router (BACKEND INTEGRATION SURFACE)
 * =============================================================================
 *
 *  This file is the single seam between the Index Management UI (IndexesTab
 *  and friends, under ./components) and the DocumentDB backend. The webview
 *  ONLY talks to the backend through these procedures — there is no other
 *  IPC channel for index operations.
 *
 *  For the backend engineer picking this up:
 *  ------------------------------------------------------------------
 *  Every procedure below is marked with a `// BACKEND INTEGRATION POINT`
 *  banner that lists:
 *      • What the UI expects back (shape + semantics)
 *      • Which `ClustersClient` method is currently called
 *      • Edge cases / follow-ups still to be validated end-to-end
 *
 *  The current implementation wires straight to `ClustersClient` (which
 *  proxies to `LlmEnhancedFeatureApis`). If you need to change the underlying
 *  transport (e.g. swap in a server-side endpoint, batch requests, add
 *  caching, gate on capability flags), do it INSIDE these procedures — the
 *  webview never needs to know.
 *
 *  Known follow-ups (not blocking for the UI shell):
 *      1. `dropIndex` against an in-progress build is not currently aborted —
 *         confirm DocumentDB behaviour and surface a better error if needed.
 *      2. `hideIndex` / `unhideIndex` rely on server-side `collMod`; gate them
 *         off for cluster tiers that don't support it.
 *      3. `IndexRow.notes` is read-only today; persistence layer TBD.
 *      4. Search-index types (`$search`, vector) aren't surfaced — the table
 *         filter ignores them on purpose for v1.
 *      5. Edit-then-recreate flow is not implemented in the UI; the delete +
 *         create round-trip is the current workaround.
 * =============================================================================
 */

import * as l10n from '@vscode/l10n';
import { z } from 'zod';
import { ClustersClient, type IndexItemModel } from '../../../documentdb/ClustersClient';
import { type IndexSpecification } from '../../../documentdb/LlmEnhancedFeatureApis';
import { SchemaStore } from '../../../documentdb/SchemaStore';
import { meterSilentCatch } from '../../../utils/callWithAccumulatingTelemetry';
import { type BaseRouterContext } from '../../_integration/appRouter';
import { publicProcedureWithTelemetry, router, type WithTelemetry } from '../../_integration/trpc';
import { FIELD_SUGGESTION_LIMIT } from './constants';
import { type CreateIndexInput, type IndexRow } from './types';

export type RouterContext = BaseRouterContext & {
    /** Stable cluster identifier for cache/client lookups. */
    clusterId: string;
    /** Identifies which tree view this cluster belongs to. */
    viewId: string;
    databaseName: string;
    collectionName: string;
};

/**
 * Zod schemas for tRPC input validation. Defining them once at module scope
 * keeps the procedure declarations terse and re-uses the same instance for
 * every call.
 */
const SortDirectionSchema = z.union([z.literal(1), z.literal(-1)]);

const CreateIndexInputSchema = z.object({
    fields: z
        .array(
            z.object({
                field: z.string().min(1),
                direction: SortDirectionSchema,
            }),
        )
        .min(1),
    type: z.enum(['singleField', 'ttl', 'geospatial', 'text']),
    name: z.string().optional(),
    notes: z.string().optional(),
    unique: z.boolean().optional(),
    sparse: z.boolean().optional(),
    expireAfterSeconds: z.number().int().nonnegative().optional(),
});

/** Convert a raw IndexItemModel to the IndexRow shape used by the webview. */
function toIndexRow(
    raw: IndexItemModel,
    sizeBytes: number | undefined,
    usage: { ops: number; since: string } | undefined,
): IndexRow {
    const keyEntries: ReadonlyArray<{ field: string; direction: number | string }> = raw.key
        ? Object.entries(raw.key).map(([field, direction]) => ({ field, direction }))
        : [];

    return {
        name: raw.name,
        key: keyEntries,
        hidden: raw.hidden === true,
        unique: raw.unique === true,
        sparse: raw.sparse === true,
        expireAfterSeconds: typeof raw.expireAfterSeconds === 'number' ? raw.expireAfterSeconds : undefined,
        sizeBytes,
        usageOps: usage?.ops,
        usageSince: usage?.since,
        isDefault: raw.name === '_id_',
        statsAvailable: usage !== undefined,
    };
}

/**
 * Build an `IndexSpecification` from the dialog input. The wire-level
 * direction value depends on the index type: text and geospatial keys use
 * string sentinels, traditional indexes use ±1.
 */
function buildIndexSpec(input: CreateIndexInput): IndexSpecification {
    const key: Record<string, number | string> = {};

    for (const entry of input.fields) {
        switch (input.type) {
            case 'text':
                key[entry.field] = 'text';
                break;
            case 'geospatial':
                key[entry.field] = '2dsphere';
                break;
            case 'singleField':
            case 'ttl':
            default:
                key[entry.field] = entry.direction;
                break;
        }
    }

    const spec: IndexSpecification = { key };
    if (input.name && input.name.trim().length > 0) {
        spec.name = input.name.trim();
    }
    if (input.unique) {
        spec.unique = true;
    }
    if (input.sparse) {
        spec.sparse = true;
    }
    if (input.type === 'ttl' && typeof input.expireAfterSeconds === 'number') {
        spec.expireAfterSeconds = input.expireAfterSeconds;
    }
    return spec;
}

export const indexViewRouter = router({
    /**
     * BACKEND INTEGRATION POINT — getInfo
     * -----------------------------------------------------------------
     * Returns the database/collection identity for the tab header. Pure
     * context read; no backend call. Safe to leave as-is.
     */
    getInfo: publicProcedureWithTelemetry.query(({ ctx }) => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        return {
            databaseName: myCtx.databaseName,
            collectionName: myCtx.collectionName,
        };
    }),

    /**
     * BACKEND INTEGRATION POINT — listIndexes
     * -----------------------------------------------------------------
     * Powers the main IndexTable. Calls 3 backend methods and stitches
     * the results together:
     *     1. ClustersClient.listIndexes          → required (throws on fail)
     *     2. ClustersClient.getCollectionStats   → optional; gives `sizeBytes`
     *     3. ClustersClient.getIndexStats        → optional; gives usage ops
     * Both optional calls are wrapped in try/catch + meterSilentCatch so
     * the table still renders if a tier lacks $indexStats / collStats.
     *
     * UI contract: returns IndexRow[]; an empty array shows the empty
     * state. NEVER return null — the UI does not handle it.
     */
    listIndexes: publicProcedureWithTelemetry.query(async ({ ctx }) => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        const client = await ClustersClient.getClient(myCtx.clusterId);

        const rawIndexes = await client.listIndexes(myCtx.databaseName, myCtx.collectionName);

        let indexSizes: Record<string, number> = {};
        try {
            const stats = await client.getCollectionStats(myCtx.databaseName, myCtx.collectionName);
            indexSizes = stats.indexSizes ?? {};
        } catch {
            meterSilentCatch('indexView_getCollectionStats');
        }

        const usageByName = new Map<string, { ops: number; since: string }>();
        try {
            const indexStats = await client.getIndexStats(myCtx.databaseName, myCtx.collectionName);
            for (const stat of indexStats) {
                if (stat.accesses === 'N/A') {
                    continue;
                }
                usageByName.set(stat.name, {
                    ops: stat.accesses.ops,
                    since:
                        stat.accesses.since instanceof Date
                            ? stat.accesses.since.toISOString()
                            : new Date(stat.accesses.since).toISOString(),
                });
            }
        } catch {
            meterSilentCatch('indexView_getIndexStats');
        }

        const rows: IndexRow[] = rawIndexes.map((idx) =>
            toIndexRow(idx, indexSizes[idx.name], usageByName.get(idx.name)),
        );

        myCtx.telemetry.measurements.indexCount = rows.length;
        return rows;
    }),

    /**
     * BACKEND INTEGRATION POINT — getCollectionDocumentCount
     * -----------------------------------------------------------------
     * Used ONLY to decide whether to show the "large collection" warning
     * banner in the Create Index dialog (threshold:
     * LARGE_COLLECTION_THRESHOLD_DOCS, in ./constants.ts). Returns 0 on
     * failure so the dialog still opens. Currently piggybacks on
     * getCollectionStats; swap to `db.command({ count })` if cheaper.
     */
    getCollectionDocumentCount: publicProcedureWithTelemetry.query(async ({ ctx }) => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        try {
            const client = await ClustersClient.getClient(myCtx.clusterId);
            const stats = await client.getCollectionStats(myCtx.databaseName, myCtx.collectionName);
            return stats.count;
        } catch {
            meterSilentCatch('indexView_getDocumentCount');
            return 0;
        }
    }),

    /**
     * BACKEND INTEGRATION POINT — getFieldSuggestions
     * -----------------------------------------------------------------
     * Feeds the Create Index dialog field picker. Pulls from the shared
     * in-process SchemaStore (populated as a side effect of CollectionView
     * sampling). NO new backend call. If you want richer suggestions,
     * trigger a SchemaStore sample here before reading.
     *
     * Capped at FIELD_SUGGESTION_LIMIT to keep the dropdown usable.
     */
    getFieldSuggestions: publicProcedureWithTelemetry.query(({ ctx }) => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        const fields = SchemaStore.getInstance().getKnownFields(
            myCtx.clusterId,
            myCtx.databaseName,
            myCtx.collectionName,
        );
        const unique = new Set<string>();
        for (const f of fields) {
            if (f.path) {
                unique.add(f.path);
            }
            if (unique.size >= FIELD_SUGGESTION_LIMIT) {
                break;
            }
        }
        return Array.from(unique).sort();
    }),

    /**
     * BACKEND INTEGRATION POINT — createIndex
     * -----------------------------------------------------------------
     * Calls ClustersClient.createIndex(databaseName, collectionName, spec).
     * `spec` is built by buildIndexSpec() above which maps the UI inputs
     * (`singleField` / `ttl` / `text` / `geospatial`) onto the wire shape
     * (±1 vs 'text' vs '2dsphere'). If the backend response contains
     * `result.note` we treat the call as failed and surface the note as
     * the error message (DocumentDB returns warnings/errors here today).
     *
     * UI contract: success → `{ ok: true, indexName }`. Failure → throw
     * with a localised user-facing message; the dialog stays open.
     *
     * TODO(backend): confirm partial-index options (partialFilterExpression)
     * are not silently dropped — the dialog does not expose them yet.
     */
    createIndex: publicProcedureWithTelemetry.input(CreateIndexInputSchema).mutation(async ({ input, ctx }) => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        const client = await ClustersClient.getClient(myCtx.clusterId);
        const spec = buildIndexSpec(input);

        myCtx.telemetry.properties.indexType = input.type;
        myCtx.telemetry.measurements.fieldCount = input.fields.length;

        const result = await client.createIndex(myCtx.databaseName, myCtx.collectionName, spec);
        if (result.ok === 0 || result.note) {
            const message = typeof result.note === 'string' ? result.note : l10n.t('Failed to create index.');
            throw new Error(message);
        }
        return { ok: true, indexName: result.indexName };
    }),

    /**
     * BACKEND INTEGRATION POINT — dropIndex
     * -----------------------------------------------------------------
     * Calls ClustersClient.dropIndex(...). Refuses `_id_` up front (the
     * UI also disables the action, this is defence in depth). Surfaces
     * `result.note` as the user-visible error, same pattern as createIndex.
     *
     * UI contract: success → `{ ok: true }` then the table re-fetches.
     * Failure → throw with a localised message; the confirm dialog stays.
     */
    dropIndex: publicProcedureWithTelemetry
        .input(z.object({ indexName: z.string().min(1) }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as WithTelemetry<RouterContext>;
            if (input.indexName === '_id_') {
                throw new Error(l10n.t('The "_id_" index cannot be deleted.'));
            }
            const client = await ClustersClient.getClient(myCtx.clusterId);
            const result = await client.dropIndex(myCtx.databaseName, myCtx.collectionName, input.indexName);
            if (result.ok === 0 || result.note) {
                const message = typeof result.note === 'string' ? result.note : l10n.t('Failed to delete index.');
                throw new Error(message);
            }
            return { ok: true };
        }),

    /**
     * BACKEND INTEGRATION POINT — hideIndex / unhideIndex
     * -----------------------------------------------------------------
     * Both call ClustersClient.{hide,unhide}Index(...). Under the hood
     * this issues a `collMod` to flip `hidden` on the index. Some
     * cluster tiers / engine versions don't support this; if you add
     * a capability check, return a typed error here so the UI can
     * disable the toggle proactively.
     */
    hideIndex: publicProcedureWithTelemetry
        .input(z.object({ indexName: z.string().min(1) }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as WithTelemetry<RouterContext>;
            if (input.indexName === '_id_') {
                throw new Error(l10n.t('The "_id_" index cannot be hidden.'));
            }
            const client = await ClustersClient.getClient(myCtx.clusterId);
            await client.hideIndex(myCtx.databaseName, myCtx.collectionName, input.indexName);
            return { ok: true };
        }),

    unhideIndex: publicProcedureWithTelemetry
        .input(z.object({ indexName: z.string().min(1) }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as WithTelemetry<RouterContext>;
            const client = await ClustersClient.getClient(myCtx.clusterId);
            await client.unhideIndex(myCtx.databaseName, myCtx.collectionName, input.indexName);
            return { ok: true };
        }),
});
