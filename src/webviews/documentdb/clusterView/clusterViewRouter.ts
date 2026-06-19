/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * =============================================================================
 *  Cluster Dashboard — tRPC router (BACKEND INTEGRATION SURFACE)
 * =============================================================================
 *
 *  This file is the single seam between the cluster dashboard UI
 *  (ClusterView and friends, under ./components) and the DocumentDB backend.
 *  The webview ONLY talks to the backend through these procedures.
 *
 *  Design notes for maintainers:
 *  ------------------------------------------------------------------
 *  • The client is obtained per-call via `ClustersClient.getClient(clusterId)`
 *    (the same stable-cache pattern used by the Index Management router).
 *    No ClusterSession is created because the dashboard is read-mostly
 *    (list + stats) plus two lazy create flows.
 *  • Metric procedures (`getDatabaseMetrics` / `getCollectionMetrics`) NEVER
 *    throw for an individual row: a denied/unsupported `dbStats` / `collStats`
 *    must degrade to a "—" cell, not fail the whole table. They return
 *    `null` metrics on failure and the UI renders the unavailable state.
 *  • The cheap list procedures (`listDatabases` / `listCollections`) DO throw
 *    on failure so the UI can surface an auth/connection error state.
 *  • Create flows delegate to the shared AzureWizard commands (the same native
 *    flows used by the tree's right-click "Create database" / "Create
 *    collection" actions). Those wizards prompt with a native input box,
 *    validate the name, and refresh the relevant tree node on success — so the
 *    dashboard and the tree stay in sync without a bespoke webview dialog.
 * =============================================================================
 */

import { AzureWizard, callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { z } from 'zod';
import { CollectionNameStep } from '../../../commands/createCollection/CollectionNameStep';
import { type CreateCollectionWizardContext } from '../../../commands/createCollection/CreateCollectionWizardContext';
import { ExecuteStep as CreateCollectionExecuteStep } from '../../../commands/createCollection/ExecuteStep';
import { type CreateDatabaseWizardContext } from '../../../commands/createDatabase/CreateDatabaseWizardContext';
import { DatabaseNameStep } from '../../../commands/createDatabase/DatabaseNameStep';
import { ExecuteStep as CreateDatabaseExecuteStep } from '../../../commands/createDatabase/ExecuteStep';
import { ClustersClient } from '../../../documentdb/ClustersClient';
import { CredentialCache } from '../../../documentdb/CredentialCache';
import { meterSilentCatch } from '../../../utils/callWithAccumulatingTelemetry';
import { showConfirmationAsInSettings } from '../../../utils/dialogs/showConfirmation';
import { nonNullValue } from '../../../utils/nonNull';
import { type BaseRouterContext } from '../../_integration/appRouter';
import { publicProcedureWithTelemetry, router, type WithTelemetry } from '../../_integration/trpc';
import { type CollectionMetrics, type CreateResult, type DatabaseMetrics } from './types';

export type RouterContext = BaseRouterContext & {
    /** Stable cluster identifier for cache/client lookups. */
    clusterId: string;
    /** Human-readable cluster name used for the dashboard header. */
    clusterDisplayName: string;
    /** Identifies which tree view this cluster belongs to. */
    viewId: string;
    /**
     * The cluster's VS Code TreeView element id (`cluster.treeId`). Used to
     * refresh the tree after create operations so the dashboard and the tree
     * stay in sync.
     */
    clusterTreeId: string;
};

const DatabaseNameInput = z.object({ databaseName: z.string().min(1) });
const CollectionNameInput = z.object({
    databaseName: z.string().min(1),
    collectionName: z.string().min(1),
});

/**
 * Runs the shared "Create database" AzureWizard — the exact same native flow
 * (input box + name validation + lazy-create + tree refresh) used by the
 * cluster node's right-click "Create database" command. Reusing the wizard
 * (rather than a webview dialog) keeps a single create code path and a single
 * source of validation rules.
 *
 * Errors are surfaced by `callWithTelemetryAndErrorHandling` as a native error
 * notification (its default behaviour); user cancellation is silent. Returns
 * whether a database was created so the dashboard can refresh its table.
 */
async function runCreateDatabaseWizard(
    clusterId: string,
    clusterName: string,
    clusterTreeId: string,
): Promise<CreateResult> {
    if (!CredentialCache.hasCredentials(clusterId)) {
        return {
            created: false,
            error: l10n.t(
                'You are not signed in to the cluster "{0}". Expand it in the tree to sign in, then try again.',
                clusterName,
            ),
        };
    }

    let created = false;
    await callWithTelemetryAndErrorHandling(
        'vscode-documentdb.clusterView.createDatabase',
        async (actionContext: IActionContext) => {
            const wizardContext: CreateDatabaseWizardContext = {
                ...actionContext,
                credentialsId: clusterId,
                clusterName: clusterName,
                nodeId: clusterTreeId,
            };

            const wizard = new AzureWizard(wizardContext, {
                title: l10n.t('Create database'),
                promptSteps: [new DatabaseNameStep()],
                executeSteps: [new CreateDatabaseExecuteStep()],
                showLoadingPrompt: true,
            });

            await wizard.prompt();
            await wizard.execute();

            const newName = nonNullValue(
                wizardContext.databaseName,
                'wizardContext.databaseName',
                'clusterViewRouter.ts',
            );
            showConfirmationAsInSettings(l10n.t('The "{name}" database has been created.', { name: newName }));
            created = true;
        },
    );

    return { created };
}

/**
 * Runs the shared "Create collection" AzureWizard — the same native flow used
 * by the database node's right-click "Create collection" command. The owning
 * database node is refreshed by the wizard's execute step, keeping the tree in
 * sync. Returns whether a collection was created so the dashboard can refresh.
 */
async function runCreateCollectionWizard(
    clusterId: string,
    databaseName: string,
    databaseNodeId: string,
): Promise<CreateResult> {
    if (!CredentialCache.hasCredentials(clusterId)) {
        return {
            created: false,
            error: l10n.t('You are not signed in to the cluster. Expand it in the tree to sign in, then try again.'),
        };
    }

    let created = false;
    await callWithTelemetryAndErrorHandling(
        'vscode-documentdb.clusterView.createCollection',
        async (actionContext: IActionContext) => {
            const wizardContext: CreateCollectionWizardContext = {
                ...actionContext,
                credentialsId: clusterId,
                databaseId: databaseName,
                nodeId: databaseNodeId,
            };

            const wizard = new AzureWizard(wizardContext, {
                title: l10n.t('Create collection'),
                promptSteps: [new CollectionNameStep()],
                executeSteps: [new CreateCollectionExecuteStep()],
                showLoadingPrompt: true,
            });

            await wizard.prompt();
            await wizard.execute();

            const newName = nonNullValue(
                wizardContext.newCollectionName,
                'wizardContext.newCollectionName',
                'clusterViewRouter.ts',
            );
            showConfirmationAsInSettings(
                l10n.t('The "{newCollectionName}" collection has been created.', { newCollectionName: newName }),
            );
            created = true;
        },
    );

    return { created };
}

export const clusterViewRouter = router({
    /**
     * BACKEND INTEGRATION POINT — getClusterInfo
     * -----------------------------------------------------------------
     * Returns the cluster display name for the dashboard header. Pure
     * context read; no backend call.
     */
    getClusterInfo: publicProcedureWithTelemetry.query(({ ctx }) => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        return { clusterDisplayName: myCtx.clusterDisplayName };
    }),

    /**
     * BACKEND INTEGRATION POINT — listDatabases
     * -----------------------------------------------------------------
     * Cheap list call that powers the immediate render of the overview
     * table. Throws on failure so the UI shows a connection/auth error
     * state. Returns database names only; metrics stream in separately.
     */
    listDatabases: publicProcedureWithTelemetry.query(async ({ ctx }) => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        const client = await ClustersClient.getClient(myCtx.clusterId);
        const databases = await client.listDatabases();
        myCtx.telemetry.measurements.databaseCount = databases.length;
        return databases.map((db) => ({ name: db.name }));
    }),

    /**
     * BACKEND INTEGRATION POINT — getDatabaseMetrics
     * -----------------------------------------------------------------
     * Per-row metrics for the overview table via `dbStats`. NEVER throws:
     * returns `null` when stats are unavailable/denied so the row degrades
     * to a "—" state instead of failing the whole table. `storageSize` →
     * on-disk size, `collections` → collection count, `indexes` → index count.
     */
    getDatabaseMetrics: publicProcedureWithTelemetry
        .input(DatabaseNameInput)
        .query(async ({ input, ctx }): Promise<DatabaseMetrics | null> => {
            const myCtx = ctx as WithTelemetry<RouterContext>;
            try {
                const client = await ClustersClient.getClient(myCtx.clusterId);
                const stats = await client.getDatabaseStats(input.databaseName);
                return {
                    storageSize: stats.storageSize,
                    collectionCount: stats.collections,
                    indexCount: stats.indexes,
                };
            } catch {
                meterSilentCatch('clusterView_getDatabaseMetrics');
                return null;
            }
        }),

    /**
     * BACKEND INTEGRATION POINT — listCollections
     * -----------------------------------------------------------------
     * Cheap list call for the database drill-in. Throws on failure so the
     * UI can surface an error state. Metrics stream in separately.
     */
    listCollections: publicProcedureWithTelemetry.input(DatabaseNameInput).query(async ({ input, ctx }) => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        const client = await ClustersClient.getClient(myCtx.clusterId);
        const collections = await client.listCollections(input.databaseName);
        myCtx.telemetry.measurements.collectionCount = collections.length;
        return collections.map((c) => ({ name: c.name }));
    }),

    /**
     * BACKEND INTEGRATION POINT — getCollectionMetrics
     * -----------------------------------------------------------------
     * Per-row metrics for the drill-in table via `collStats`. NEVER throws:
     * returns `null` when stats are unavailable/denied. Maps the raw
     * `collStats` fields to the dashboard's collection metric columns:
     * `storageSize` → on-disk size, `count` → document count,
     * `avgObjSize` → average document size, `nindexes` → index count,
     * `totalIndexSize` → total index size.
     */
    getCollectionMetrics: publicProcedureWithTelemetry
        .input(CollectionNameInput)
        .query(async ({ input, ctx }): Promise<CollectionMetrics | null> => {
            const myCtx = ctx as WithTelemetry<RouterContext>;
            try {
                const client = await ClustersClient.getClient(myCtx.clusterId);
                const stats = await client.getCollectionStats(input.databaseName, input.collectionName);
                return {
                    storageSize: stats.storageSize,
                    documentCount: stats.count,
                    avgDocumentSize: stats.avgObjSize,
                    indexCount: stats.nindexes,
                    totalIndexSize: stats.totalIndexSize,
                };
            } catch {
                meterSilentCatch('clusterView_getCollectionMetrics');
                return null;
            }
        }),

    /**
     * BACKEND INTEGRATION POINT — createDatabase
     * -----------------------------------------------------------------
     * Delegates to the shared "Create database" AzureWizard so the dashboard
     * uses the identical native flow (and validation) as the cluster node's
     * right-click command — no bespoke webview dialog. The wizard's execute
     * step refreshes the cluster node in the tree. Returns whether a database
     * was created so the dashboard can refresh its table.
     */
    createDatabase: publicProcedureWithTelemetry.mutation(async ({ ctx }): Promise<CreateResult> => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        return runCreateDatabaseWizard(myCtx.clusterId, myCtx.clusterDisplayName, myCtx.clusterTreeId);
    }),

    /**
     * BACKEND INTEGRATION POINT — createCollection
     * -----------------------------------------------------------------
     * Delegates to the shared "Create collection" AzureWizard for the named
     * database, mirroring the database node's right-click command. The wizard
     * refreshes the owning database node in the tree. Returns whether a
     * collection was created so the dashboard can refresh its table.
     */
    createCollection: publicProcedureWithTelemetry
        .input(DatabaseNameInput)
        .mutation(async ({ input, ctx }): Promise<CreateResult> => {
            const myCtx = ctx as WithTelemetry<RouterContext>;
            // The database node id is the cluster tree id plus the db name.
            const databaseNodeId = `${myCtx.clusterTreeId}/${input.databaseName}`;
            return runCreateCollectionWizard(myCtx.clusterId, input.databaseName, databaseNodeId);
        }),
});
