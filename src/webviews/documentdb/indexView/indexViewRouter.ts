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
 *      3. Search-index types (`$search`, vector) aren't surfaced — the table
 *         filter ignores them on purpose for v1.
 *      4. Edit-then-recreate flow is not implemented in the UI; the delete +
 *         create round-trip is the current workaround.
 * =============================================================================
 */

import * as l10n from '@vscode/l10n';
import { z } from 'zod';
import { ClustersClient, type IndexItemModel } from '../../../documentdb/ClustersClient';
import { PlaygroundCommandIds } from '../../../documentdb/playground/constants';
import { SchemaStore } from '../../../documentdb/SchemaStore';
import { ShellCommandIds } from '../../../documentdb/shell/constants';
import { meterSilentCatch } from '../../../utils/accumulatingTelemetry';
import { confirmIndexAction } from '../../../utils/dialogs/confirmIndexAction';
import { type BaseRouterContext } from '../../_integration/appRouter';
import { publicProcedureWithTelemetry, router, type WithTelemetry } from '../../_integration/trpc';
import { FIELD_SUGGESTION_LIMIT } from './constants';
import { buildCreateIndexShellCommand, buildIndexSpec, CreateIndexInputSchema } from './indexCreation';
import { type IndexRow } from './types';

export type RouterContext = BaseRouterContext & {
    /** Stable cluster identifier for cache/client lookups. */
    clusterId: string;
    /** Human-readable cluster name, forwarded to playground/shell hand-offs. */
    clusterDisplayName: string;
    /** Identifies which tree view this cluster belongs to. */
    viewId: string;
    databaseName: string;
    collectionName: string;
};

/** Convert a raw IndexItemModel to the IndexRow shape used by the webview. */
function toIndexRow(
    raw: IndexItemModel,
    sizeBytes: number | undefined,
    usage: { ops: number; since: string } | undefined,
    building: boolean,
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
        partialFilterExpression: asRecord(raw.partialFilterExpression),
        collation: asRecord(raw.collation),
        wildcardProjection: asRecord(raw.wildcardProjection),
        sizeBytes,
        usageOps: usage?.ops,
        usageSince: usage?.since,
        isDefault: raw.name === '_id_',
        statsAvailable: usage !== undefined,
        state: building ? 'building' : 'ready',
    };
}

/** Narrow an unknown index option to a plain object, or `undefined` otherwise. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
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
        const buildingNames = new Set<string>();
        try {
            const indexStats = await client.getIndexStats(myCtx.databaseName, myCtx.collectionName);
            for (const stat of indexStats) {
                if (stat.building === true) {
                    buildingNames.add(stat.name);
                }
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
            toIndexRow(idx, indexSizes[idx.name], usageByName.get(idx.name), buildingNames.has(idx.name)),
        );

        myCtx.actionContext.telemetry.measurements.indexCount = rows.length;
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
     * `spec` is built by buildIndexSpec() above which maps each field's type
     * (asc/desc/text/2dsphere/hashed) onto the wire key value and forwards the
     * index-level options (unique/sparse/TTL/partial filter/collation). If the
     * backend response contains `result.note` we treat the call as failed and
     * surface the note as the error message (DocumentDB returns warnings/errors
     * here today).
     *
     * UI contract: success → `{ ok: true, indexName }`. Failure → throw
     * with a localised user-facing message; the drawer stays open.
     */
    createIndex: publicProcedureWithTelemetry.input(CreateIndexInputSchema).mutation(async ({ input, ctx }) => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        const client = await ClustersClient.getClient(myCtx.clusterId);
        const spec = buildIndexSpec(input);

        myCtx.actionContext.telemetry.properties.fieldTypes = input.fields.map((f) => f.type).join(',');
        myCtx.actionContext.telemetry.properties.compound = String(input.fields.length > 1);
        myCtx.actionContext.telemetry.properties.ttl = String(typeof input.expireAfterSeconds === 'number');
        myCtx.actionContext.telemetry.measurements.fieldCount = input.fields.length;

        const result = await client.createIndex(myCtx.databaseName, myCtx.collectionName, spec);
        if (result.ok === 0 || result.note) {
            const message = typeof result.note === 'string' ? result.note : l10n.t('Failed to create index.');
            throw new Error(message);
        }
        return { ok: true, indexName: result.indexName };
    }),

    /**
     * BACKEND INTEGRATION POINT — openCreateInPlayground
     * -----------------------------------------------------------------
     * Prepares (does not run) the createIndex command in a new query
     * playground, using the same cross-feature hand-off the collection view
     * uses. The user reviews and runs it there.
     */
    openCreateInPlayground: publicProcedureWithTelemetry
        .input(CreateIndexInputSchema)
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as WithTelemetry<RouterContext>;
            myCtx.actionContext.telemetry.properties.activationSource = 'indexViewCreateDrawer';
            const content = buildCreateIndexShellCommand(myCtx.collectionName, input);
            const vscode = await import('vscode');
            await vscode.commands.executeCommand(PlaygroundCommandIds.newWithContent, {
                clusterId: myCtx.clusterId,
                clusterDisplayName: myCtx.clusterDisplayName,
                databaseName: myCtx.databaseName,
                content,
                viewId: myCtx.viewId,
            });
            return { ok: true };
        }),

    /**
     * BACKEND INTEGRATION POINT — openCreateInShell
     * -----------------------------------------------------------------
     * Prepares (does not run) the createIndex command in an interactive
     * shell, mirroring the collection view's "open in shell" hand-off.
     */
    openCreateInShell: publicProcedureWithTelemetry.input(CreateIndexInputSchema).mutation(async ({ input, ctx }) => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        myCtx.actionContext.telemetry.properties.activationSource = 'indexViewCreateDrawer';
        const initialInput = buildCreateIndexShellCommand(myCtx.collectionName, input);
        const vscode = await import('vscode');
        await vscode.commands.executeCommand(ShellCommandIds.openWithInput, {
            clusterId: myCtx.clusterId,
            clusterDisplayName: myCtx.clusterDisplayName,
            databaseName: myCtx.databaseName,
            viewId: myCtx.viewId,
            initialInput,
        });
        return { ok: true };
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
        .input(
            z.object({
                indexName: z.string().min(1),
                sizeText: z.string().optional(),
                usageText: z.string().optional(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as WithTelemetry<RouterContext>;
            if (input.indexName === '_id_') {
                throw new Error(l10n.t('The "_id_" index cannot be deleted.'));
            }
            if (input.indexName === '*') {
                throw new Error(l10n.t('The index name "*" is reserved.'));
            }

            // Confirm on the extension host using the same modal detail dialog
            // as hide / unhide, so every index action reads consistently.
            const confirmed = await confirmIndexAction('delete', {
                indexName: input.indexName,
                collectionName: myCtx.collectionName,
                sizeText: input.sizeText,
                usageText: input.usageText,
            });
            if (!confirmed) {
                return { ok: true, cancelled: true };
            }

            const client = await ClustersClient.getClient(myCtx.clusterId);
            const result = await client.dropIndex(myCtx.databaseName, myCtx.collectionName, input.indexName);
            if (result.ok === 0 || result.note) {
                const message = typeof result.note === 'string' ? result.note : l10n.t('Failed to delete index.');
                throw new Error(message);
            }
            return { ok: true, cancelled: false };
        }),

    /**
     * BACKEND INTEGRATION POINT — openIndexDefinition
     * -----------------------------------------------------------------
     * Opens the raw, server-reported index definition in a new untitled
     * JSON document so the user can inspect any options the UI does not
     * render explicitly. Re-fetches the live list and matches by name so
     * the output is always current; the synthetic `type` discriminator we
     * add in `listIndexes` is stripped so only real fields are shown.
     */
    openIndexDefinition: publicProcedureWithTelemetry
        .input(z.object({ indexName: z.string().min(1) }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as WithTelemetry<RouterContext>;
            const client = await ClustersClient.getClient(myCtx.clusterId);
            const rawIndexes = await client.listIndexes(myCtx.databaseName, myCtx.collectionName);
            const match = rawIndexes.find((idx) => idx.name === input.indexName);
            if (!match) {
                throw new Error(l10n.t('Index "{0}" was not found.', input.indexName));
            }

            // Strip our synthetic `type` discriminator so only the real,
            // server-reported fields are shown.
            const definition: Record<string, unknown> = { ...match };
            delete definition.type;
            const prettyJson = JSON.stringify(definition, null, 4);

            const vscode = await import('vscode');
            const doc = await vscode.workspace.openTextDocument({ content: prettyJson, language: 'json' });
            await vscode.window.showTextDocument(doc);

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
        .input(
            z.object({
                indexName: z.string().min(1),
                sizeText: z.string().optional(),
                usageText: z.string().optional(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as WithTelemetry<RouterContext>;
            if (input.indexName === '_id_') {
                throw new Error(l10n.t('The "_id_" index cannot be hidden.'));
            }
            const confirmed = await confirmIndexAction('hide', {
                indexName: input.indexName,
                collectionName: myCtx.collectionName,
                sizeText: input.sizeText,
                usageText: input.usageText,
            });
            if (!confirmed) {
                return { ok: true, cancelled: true };
            }
            const client = await ClustersClient.getClient(myCtx.clusterId);
            const result = await client.hideIndex(myCtx.databaseName, myCtx.collectionName, input.indexName);
            if (result.ok === 0 || result.errmsg) {
                const message = typeof result.errmsg === 'string' ? result.errmsg : l10n.t('Failed to hide index.');
                throw new Error(message);
            }
            return { ok: true, cancelled: false };
        }),

    unhideIndex: publicProcedureWithTelemetry
        .input(
            z.object({
                indexName: z.string().min(1),
                sizeText: z.string().optional(),
                usageText: z.string().optional(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as WithTelemetry<RouterContext>;
            if (input.indexName === '_id_') {
                throw new Error(l10n.t('The "_id_" index visibility cannot be changed.'));
            }
            const confirmed = await confirmIndexAction('unhide', {
                indexName: input.indexName,
                collectionName: myCtx.collectionName,
                sizeText: input.sizeText,
                usageText: input.usageText,
            });
            if (!confirmed) {
                return { ok: true, cancelled: true };
            }
            const client = await ClustersClient.getClient(myCtx.clusterId);
            const result = await client.unhideIndex(myCtx.databaseName, myCtx.collectionName, input.indexName);
            if (result.ok === 0 || result.errmsg) {
                const message = typeof result.errmsg === 'string' ? result.errmsg : l10n.t('Failed to unhide index.');
                throw new Error(message);
            }
            return { ok: true, cancelled: false };
        }),
});
