/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type Document, type MongoClient } from 'mongodb';
import * as vscode from 'vscode';
import { z } from 'zod';

import { openCollectionViewInternal } from '../../../commands/openCollectionView/openCollectionView';
import { ClustersClient } from '../../../documentdb/ClustersClient';
import { ShellCommandIds } from '../../../documentdb/shell/constants';
import { getHostsFromConnectionString } from '../../../documentdb/utils/connectionStringHelpers';
import {
    getDatabaseCollections,
    getStorageStats,
    sampleClusterHealth,
    type ClusterHealthSample,
    type ClusterStorageStats,
    type DatabaseCollectionsResult,
    type RawCommandDiagnostic,
} from '../../../documentdb/utils/getClusterHealth';
import { readOnlyJsonDocumentProvider } from '../../../utils/readOnlyJsonDocumentProvider';
import { type BaseRouterContext } from '../../_integration/appRouter';
import { publicProcedureWithTelemetry, router, type WithTelemetry } from '../../_integration/trpc';
import { resolveClusterNode, resolveNamespaceNode } from './resolveNamespaceNode';

/**
 * The server commands the dashboard describes a cluster with, run for the diagnostics
 * document and reported verbatim.
 *
 * These supplement the commands captured directly by the storage collector. The document
 * carries each command beside its reply rather than an interpretation of it: a reader of a
 * bug report needs what the server actually said, and every parse of these replies that the
 * dashboard once needed has since been deleted along with the panels it fed.
 *
 * `connectionStatus` is not among them because its reply names the signed-in principal.
 */
const DIAGNOSTIC_COMMANDS: readonly Document[] = [
    { buildInfo: 1 },
    { serverStatus: 1 },
    { hello: 1 },
    { replSetGetStatus: 1 },
    { hostInfo: 1 },
    { listShards: 1 },
];

/**
 * Runs every diagnostic command and keeps each outcome.
 *
 * A refusal is recorded, not dropped: every supported platform rejects at least one of these,
 * and "Azure DocumentDB (vCore) refuses serverStatus" is a finding a bug report needs, not a
 * gap to hide. They run concurrently because a failing command waits out the driver's server
 * selection timeout, and six of those in series is a minute of nothing happening.
 */
export async function collectRawCommandReplies(client: MongoClient): Promise<RawCommandDiagnostic[]> {
    const adminDb = client.db().admin();

    return Promise.all(
        DIAGNOSTIC_COMMANDS.map(async (command): Promise<RawCommandDiagnostic> => {
            try {
                return {
                    database: 'admin',
                    command,
                    result: { ok: true, response: await adminDb.command(command) },
                };
            } catch (error) {
                return {
                    database: 'admin',
                    command,
                    result: { ok: false, error: error instanceof Error ? error.message : String(error) },
                };
            }
        }),
    );
}

export type RouterContext = BaseRouterContext & {
    /**
     * Stable cluster identifier for cache/client lookups.
     * Use this for ClustersClient.getClient() and CredentialCache operations,
     * never the tree id (which changes when a connection is moved into a folder).
     */
    clusterId: string;
    /** Human-readable cluster display name shown in the dashboard header. */
    clusterDisplayName: string;
    /**
     * Identifies which tree view this cluster belongs to.
     * @see Views enum for possible values (e.g., 'connectionsView', 'discoveryView')
     */
    viewId: string;
};

/** Flat string map produced by `getClusterMetadata` (e.g. `serverInfo_version`). */
export interface ClusterDashboardInfo {
    clusterDisplayName: string;
    metadata: Record<string, string | undefined>;
    /**
     * The `host:port` endpoints from the connection string, shown as the header's subtitle.
     *
     * A connection is opened against a name, and the display name in the tree is whatever
     * the user (or a discovery provider) chose to call it — the two routinely disagree, and
     * only this one identifies which server is on screen. Parsed with
     * `getHostsFromConnectionString`, so no user, password, or query option travels with it.
     */
    hosts: string[];
}

export const clusterDashboardRouter = router({
    /**
     * One-shot header data. `getClusterMetadata` is cached per client, so this is cheap
     * to call again when a panel is revealed.
     */
    getClusterInfo: publicProcedureWithTelemetry.query(async ({ ctx }): Promise<ClusterDashboardInfo> => {
        const myCtx = ctx as WithTelemetry<RouterContext>;

        const client = await ClustersClient.getClient(myCtx.clusterId);
        const metadata = await client.getClusterMetadata();

        // Best effort: a connection restored from a session without cached credentials has
        // no connection string to parse, and the header simply omits the subtitle.
        let hosts: string[] = [];
        try {
            const connectionString = client.getCredentials()?.connectionString;
            if (connectionString) {
                hosts = getHostsFromConnectionString(connectionString);
            }
        } catch {
            hosts = [];
        }

        return { clusterDisplayName: myCtx.clusterDisplayName, metadata, hosts };
    }),

    /** Per-collection breakdown for one database, loaded when its row is expanded. */
    getDatabaseCollections: publicProcedureWithTelemetry
        .input(z.object({ databaseName: z.string().min(1) }))
        .query(async ({ input, ctx }): Promise<DatabaseCollectionsResult> => {
            const myCtx = ctx as WithTelemetry<RouterContext>;

            const client = await ClustersClient.getClient(myCtx.clusterId);

            // Expanding a row can fan out to 100 `collStats`; the panel is often collapsed or the
            // dashboard closed long before they finish.
            return getDatabaseCollections(client.getMongoClient(), input.databaseName, myCtx.signal);
        }),

    /** Live health sample. Polled by the webview, so telemetry is suppressed. */
    getHealthSample: publicProcedureWithTelemetry.query(async ({ ctx }): Promise<ClusterHealthSample> => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        myCtx.actionContext.telemetry.suppressAll = true;

        const client = await ClustersClient.getClient(myCtx.clusterId);

        return sampleClusterHealth(client.getMongoClient());
    }),

    /** Storage breakdown for the inventory list. */
    getStorageStats: publicProcedureWithTelemetry.query(async ({ ctx }): Promise<ClusterStorageStats> => {
        const myCtx = ctx as WithTelemetry<RouterContext>;

        const client = await ClustersClient.getClient(myCtx.clusterId);

        return getStorageStats(client.getMongoClient(), myCtx.signal);
    }),

    /**
     * Opens the interactive shell against this cluster.
     *
     * Routed through the existing shell command rather than reimplemented, so the dashboard
     * inherits its terminal wiring, telemetry and connection handling unchanged.
     */
    openShell: publicProcedureWithTelemetry.mutation(async ({ ctx }): Promise<void> => {
        const myCtx = ctx as WithTelemetry<RouterContext>;

        await vscode.commands.executeCommand(ShellCommandIds.openWithInput, {
            clusterId: myCtx.clusterId,
            clusterDisplayName: myCtx.clusterDisplayName,
        });
    }),

    /** Runs the tree's existing create-database command for this cluster. */
    createDatabase: publicProcedureWithTelemetry.mutation(async ({ ctx }): Promise<void> => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        const clusterNode = await resolveClusterNode(myCtx.viewId, myCtx.clusterId);

        if (!clusterNode) {
            throw new Error(l10n.t('Could not find this cluster in the tree view. Expand the cluster and try again.'));
        }

        await vscode.commands.executeCommand('vscode-documentdb.command.createDatabase', clusterNode, null, {
            source: 'webview;clusterDashboard',
        });
    }),

    /** Runs the tree's existing create-collection command for the database on screen. */
    createCollection: publicProcedureWithTelemetry
        .input(z.object({ databaseName: z.string().min(1) }))
        .mutation(async ({ input, ctx }): Promise<void> => {
            const myCtx = ctx as WithTelemetry<RouterContext>;
            const databaseNode = await resolveNamespaceNode(myCtx.viewId, myCtx.clusterId, input.databaseName);

            if (!databaseNode) {
                throw new Error(
                    l10n.t('Could not find "{name}" in the tree view. Expand the database and try again.', {
                        name: input.databaseName,
                    }),
                );
            }

            await vscode.commands.executeCommand('vscode-documentdb.command.createCollection', databaseNode, null, {
                source: 'webview;clusterDashboard',
            });
        }),

    /** Opens the Collection View for a row in the inventory. */
    openCollectionView: publicProcedureWithTelemetry
        .input(
            z.object({
                databaseName: z.string().min(1),
                collectionName: z.string().min(1),
                initialTab: z.enum(['tab_result', 'tab_indexes', 'tab_queryInsights']).optional(),
            }),
        )
        .mutation(async ({ input, ctx }): Promise<void> => {
            const myCtx = ctx as WithTelemetry<RouterContext>;

            await openCollectionViewInternal(myCtx.actionContext, {
                clusterId: myCtx.clusterId,
                clusterDisplayName: myCtx.clusterDisplayName,
                viewId: myCtx.viewId,
                databaseName: input.databaseName,
                collectionName: input.collectionName,
                initialTab: input.initialTab,
            });
        }),

    /**
     * Collects everything the dashboard knows into one read-only JSON document, so a cluster's
     * state can be attached to a bug report in one action instead of being retyped from
     * screenshots.
     *
     * Read-only, through the same provider as the raw document views, rather than an untitled
     * editor: an untitled document is dirty from the moment it opens and VS Code asks the
     * reader to save or discard a file they only wanted to look at.
     *
     * Everything is re-read here, on the host, at the moment of export. No application data
     * travels with it: the document describes the deployment and what it holds, never the
     * documents themselves or the commands running against them.
     *
     * It is still a description of someone's estate — database and collection names, host
     * addresses, server configuration — so it is confirmed before it is produced rather than
     * after it has been uploaded.
     */
    exportDiagnostics: publicProcedureWithTelemetry.mutation(async ({ ctx }): Promise<void> => {
        const myCtx = ctx as WithTelemetry<RouterContext>;

        const confirmed = await vscode.window.showWarningMessage(
            l10n.t('Export diagnostics for this cluster?'),
            {
                modal: true,
                detail: l10n.t(
                    'The document names every database and collection on this cluster and describes the servers behind it, including their addresses. It contains no documents, queries or credentials. Review it before sharing.',
                ),
            },
            l10n.t('Export'),
        );

        if (confirmed === undefined) {
            myCtx.actionContext.telemetry.properties.exportConfirmed = 'false';
            return;
        }
        myCtx.actionContext.telemetry.properties.exportConfirmed = 'true';

        const client = await ClustersClient.getClient(myCtx.clusterId);
        const mongoClient = client.getMongoClient();
        const storageCommands: RawCommandDiagnostic[] = [];

        const [storage, commands, health] = await Promise.all([
            getStorageStats(mongoClient, undefined, storageCommands),
            collectRawCommandReplies(mongoClient),
            sampleClusterHealth(mongoClient),
        ]);

        const diagnostics = {
            generatedAt: new Date().toISOString(),
            cluster: { displayName: myCtx.clusterDisplayName, viewId: myCtx.viewId },
            // Each invocation beside exactly what the server answered (or why it did not).
            commands: [...commands, ...storageCommands],
            // Interpreted summaries built for the dashboard, not raw server replies.
            aggregates: {
                storage,
                health,
            },
        };

        await readOnlyJsonDocumentProvider.openDocument(
            l10n.t('Cluster diagnostics'),
            JSON.stringify(diagnostics, null, 4),
        );
    }),
});
