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
import { ext } from '../../../extensionVariables';
import { SettingsService } from '../../../services/SettingsService';
import { readOnlyJsonDocumentProvider } from '../../../utils/readOnlyJsonDocumentProvider';
import { type BaseRouterContext } from '../../_integration/appRouter';
import { publicProcedureWithTelemetry, router, type WithTelemetry } from '../../_integration/trpc';
import { describeMissingNamespace, resolveClusterNode, resolveNamespaceNode } from './resolveNamespaceNode';

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
    /** Correlation id shared by every event this panel produces. @see ClusterDashboardWebviewConfigurationType */
    dashboardSessionId?: string;
    /** Journey id of the command that opened this panel, when the tree carried one. */
    journeyCorrelationId?: string;
    /** Database the panel was opened on, if it was opened from a database node. */
    selectedDatabaseName?: string;
    /** Reports row-local create progress to the dashboard that owns this router. */
    onNamespaceBusy?: (databaseName: string, collectionName: string | undefined, busy: boolean) => Promise<void>;
};

/**
 * Narrows the procedure context and stamps the facts every dashboard event should carry.
 *
 * Every procedure here belongs to one panel, so `viewId` and the panel's session id are the
 * same for all of them; setting them in one place keeps a new procedure from silently
 * dropping out of per-panel aggregation.
 */
function dashboardContext(ctx: unknown): WithTelemetry<RouterContext> {
    const myCtx = ctx as WithTelemetry<RouterContext>;
    const telemetry = myCtx.actionContext.telemetry;

    telemetry.properties.viewId = myCtx.viewId;
    if (myCtx.dashboardSessionId) {
        telemetry.properties.dashboardSessionId = myCtx.dashboardSessionId;
    }
    if (myCtx.journeyCorrelationId) {
        telemetry.properties.journeyCorrelationId = myCtx.journeyCorrelationId;
    }

    return myCtx;
}

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

/**
 * Which control in the dashboard asked for the action, as the webview names it.
 *
 * The dashboard offers the same create and open actions from more than one place, and the
 * question these answer — is the toolbar button carrying the feature, or is it only ever
 * reached from the empty state — cannot be recovered from the event alone.
 */
const DASHBOARD_CONTROL = z.enum(['inventoryToolbar', 'emptyState', 'rowClick', 'rowActionButton']);

/** Prefixed so a dashboard-originated action is distinguishable from the tree's own. */
function describeActivationSource(control: z.infer<typeof DASHBOARD_CONTROL> | undefined): string {
    return control === undefined ? 'clusterDashboard' : `clusterDashboard:${control}`;
}

/** Why a read ran: a load the panel started for itself, or one the reader asked for. */
const LOAD_REASON = z.enum(['initial', 'manual', 'reconcile', 'background']);

export const clusterDashboardRouter = router({
    setShowDashboardOnConnect: publicProcedureWithTelemetry
        .input(z.boolean())
        .mutation(async ({ input, ctx }): Promise<void> => {
            const myCtx = dashboardContext(ctx);
            myCtx.actionContext.telemetry.properties.showDashboardOnConnect = input ? 'true' : 'false';

            await SettingsService.updateGlobalSetting(ext.settingsKeys.showDashboardOnConnect, input);
        }),

    /**
     * One-shot header data. `getClusterMetadata` is cached per client, so this is cheap
     * to call again when a panel is revealed.
     */
    getClusterInfo: publicProcedureWithTelemetry.query(async ({ ctx }): Promise<ClusterDashboardInfo> => {
        const myCtx = dashboardContext(ctx);

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

        // The header renders nothing without a subtitle, and a metadata read that returns an
        // empty map is the shape behind an otherwise blank set of facts.
        myCtx.actionContext.telemetry.properties.hasHosts = hosts.length > 0 ? 'true' : 'false';
        myCtx.actionContext.telemetry.measurements.metadataFieldCount = Object.keys(metadata).length;

        return { clusterDisplayName: myCtx.clusterDisplayName, metadata, hosts };
    }),

    /** Per-collection breakdown for one database, loaded when its row is expanded. */
    getDatabaseCollections: publicProcedureWithTelemetry
        .input(z.object({ databaseName: z.string().min(1), loadReason: LOAD_REASON.optional() }))
        .query(async ({ input, ctx }): Promise<DatabaseCollectionsResult> => {
            const myCtx = dashboardContext(ctx);
            myCtx.actionContext.telemetry.properties.loadReason = input.loadReason ?? 'initial';

            const client = await ClustersClient.getClient(myCtx.clusterId);

            // Expanding a row can fan out to 100 `collStats`; the panel is often collapsed or the
            // dashboard closed long before they finish.
            const result = await getDatabaseCollections(client.getMongoClient(), input.databaseName, myCtx.signal);

            myCtx.actionContext.telemetry.measurements.collectionCount = result.collections.length;
            myCtx.actionContext.telemetry.measurements.omittedCollectionCount = result.omittedCollectionCount;
            myCtx.actionContext.telemetry.measurements.statsErrorCount = result.errors.length;

            return result;
        }),

    /** Live health sample. Polled by the webview, so telemetry is suppressed. */
    getHealthSample: publicProcedureWithTelemetry.query(async ({ ctx }): Promise<ClusterHealthSample> => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        myCtx.actionContext.telemetry.suppressAll = true;

        const client = await ClustersClient.getClient(myCtx.clusterId);

        return sampleClusterHealth(client.getMongoClient());
    }),

    /** Storage breakdown for the inventory list. */
    getStorageStats: publicProcedureWithTelemetry
        .input(z.object({ loadReason: LOAD_REASON }).optional())
        .query(async ({ input, ctx }): Promise<ClusterStorageStats> => {
            const myCtx = dashboardContext(ctx);
            myCtx.actionContext.telemetry.properties.loadReason = input?.loadReason ?? 'initial';

            const client = await ClustersClient.getClient(myCtx.clusterId);

            const stats = await getStorageStats(client.getMongoClient(), myCtx.signal);

            // How large the estates being looked at actually are, and how often the read is only
            // partially answerable — a cluster whose stats are half errors renders a table of
            // dashes, which no error event reports today.
            myCtx.actionContext.telemetry.measurements.databaseCount = stats.databases.length;
            myCtx.actionContext.telemetry.measurements.omittedDatabaseCount = stats.omittedDatabaseCount;
            myCtx.actionContext.telemetry.measurements.statsErrorCount = stats.errors.length;

            return stats;
        }),

    /**
     * Opens the interactive shell against this cluster.
     *
     * Routed through the existing shell command rather than reimplemented, so the dashboard
     * inherits its terminal wiring, telemetry and connection handling unchanged.
     */
    openShell: publicProcedureWithTelemetry.mutation(async ({ ctx }): Promise<void> => {
        const myCtx = dashboardContext(ctx);
        myCtx.actionContext.telemetry.properties.activationSource = 'clusterDashboard:clusterToolbar';

        await vscode.commands.executeCommand(ShellCommandIds.openWithInput, {
            clusterId: myCtx.clusterId,
            clusterDisplayName: myCtx.clusterDisplayName,
            databaseName: 'test',
        });
    }),

    /** Runs the tree's existing copy-connection-string command for this cluster. */
    copyConnectionString: publicProcedureWithTelemetry.mutation(async ({ ctx }): Promise<void> => {
        const myCtx = dashboardContext(ctx);
        myCtx.actionContext.telemetry.properties.activationSource = 'clusterDashboard:clusterToolbar';
        const clusterNode = await resolveClusterNode(myCtx.viewId, myCtx.clusterId);

        if (!clusterNode) {
            myCtx.actionContext.telemetry.properties.failureReason = 'clusterNodeNotFound';
            throw new Error(describeMissingNamespace(myCtx.clusterDisplayName));
        }

        await vscode.commands.executeCommand('vscode-documentdb.command.copyConnectionString', clusterNode);
    }),

    /** Opens the existing data-migration experience for this cluster. */
    openDataMigration: publicProcedureWithTelemetry.mutation(async ({ ctx }): Promise<void> => {
        const myCtx = dashboardContext(ctx);
        myCtx.actionContext.telemetry.properties.activationSource = 'clusterDashboard:clusterToolbar';
        const clusterNode = await resolveClusterNode(myCtx.viewId, myCtx.clusterId);

        if (!clusterNode) {
            myCtx.actionContext.telemetry.properties.failureReason = 'clusterNodeNotFound';
            throw new Error(describeMissingNamespace(myCtx.clusterDisplayName));
        }

        await vscode.commands.executeCommand('vscode-documentdb.command.accessDataMigrationServices', clusterNode);
    }),

    /** Runs the tree's existing create-database command for this cluster. */
    createDatabase: publicProcedureWithTelemetry
        .input(z.object({ activationSource: DASHBOARD_CONTROL }))
        .mutation(async ({ input, ctx }): Promise<void> => {
            const myCtx = dashboardContext(ctx);
            const activationSource = describeActivationSource(input.activationSource);
            myCtx.actionContext.telemetry.properties.activationSource = activationSource;

            const clusterNode = await resolveClusterNode(myCtx.viewId, myCtx.clusterId);

            if (!clusterNode) {
                myCtx.actionContext.telemetry.properties.failureReason = 'clusterNodeNotFound';
                throw new Error(describeMissingNamespace(myCtx.clusterDisplayName));
            }

            let databaseName: string | undefined;
            try {
                await vscode.commands.executeCommand('vscode-documentdb.command.createDatabase', clusterNode, null, {
                    source: 'webview;clusterDashboard',
                    activationSource,
                    onNameResolved: async (name: string): Promise<void> => {
                        databaseName = name;
                        await myCtx.onNamespaceBusy?.(name, undefined, true);
                    },
                });
            } catch (error) {
                if (databaseName !== undefined) {
                    await myCtx.onNamespaceBusy?.(databaseName, undefined, false);
                }
                throw error;
            }

            // The wizard is cancellable and swallows its own cancellation, so a resolved call is
            // not the same as a name having been confirmed. Without this the event counts every
            // abandoned dialog as a create.
            myCtx.actionContext.telemetry.properties.nameConfirmed = databaseName === undefined ? 'false' : 'true';
        }),

    /** Runs the tree's existing create-collection command for the database on screen. */
    createCollection: publicProcedureWithTelemetry
        .input(z.object({ databaseName: z.string().min(1), activationSource: DASHBOARD_CONTROL }))
        .mutation(async ({ input, ctx }): Promise<void> => {
            const myCtx = dashboardContext(ctx);
            const activationSource = describeActivationSource(input.activationSource);
            myCtx.actionContext.telemetry.properties.activationSource = activationSource;

            const databaseNode = await resolveNamespaceNode(myCtx.viewId, myCtx.clusterId, input.databaseName);

            if (!databaseNode) {
                myCtx.actionContext.telemetry.properties.failureReason = 'namespaceNodeNotFound';
                throw new Error(describeMissingNamespace(myCtx.clusterDisplayName, input.databaseName));
            }

            let collectionName: string | undefined;
            try {
                await vscode.commands.executeCommand('vscode-documentdb.command.createCollection', databaseNode, null, {
                    source: 'webview;clusterDashboard',
                    activationSource,
                    onNameResolved: async (name: string): Promise<void> => {
                        collectionName = name;
                        await myCtx.onNamespaceBusy?.(input.databaseName, name, true);
                    },
                });
            } catch (error) {
                if (collectionName !== undefined) {
                    await myCtx.onNamespaceBusy?.(input.databaseName, collectionName, false);
                }
                throw error;
            }

            myCtx.actionContext.telemetry.properties.nameConfirmed = collectionName === undefined ? 'false' : 'true';
        }),

    /** Opens the Collection View for a row in the inventory. */
    openCollectionView: publicProcedureWithTelemetry
        .input(
            z.object({
                databaseName: z.string().min(1),
                collectionName: z.string().min(1),
                initialTab: z.enum(['tab_result', 'tab_indexes', 'tab_queryInsights']).optional(),
                activationSource: DASHBOARD_CONTROL.optional(),
            }),
        )
        .mutation(async ({ input, ctx }): Promise<void> => {
            const myCtx = dashboardContext(ctx);
            myCtx.actionContext.telemetry.properties.activationSource = describeActivationSource(input.activationSource);
            myCtx.actionContext.telemetry.properties.initialTab = input.initialTab ?? 'tab_result';

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
        const myCtx = dashboardContext(ctx);
        myCtx.actionContext.telemetry.properties.activationSource = 'clusterDashboard:moreActionsMenu';

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

        // How much of the deployment a bug report actually describes: a document whose every
        // command was refused is a report with nothing in it, and looks identical from here.
        myCtx.actionContext.telemetry.measurements.refusedCommandCount = diagnostics.commands.filter(
            ({ result }) => !result.ok,
        ).length;
        myCtx.actionContext.telemetry.measurements.commandCount = diagnostics.commands.length;
        myCtx.actionContext.telemetry.measurements.databaseCount = storage.databases.length;

        await readOnlyJsonDocumentProvider.openDocument(
            l10n.t('Cluster diagnostics'),
            JSON.stringify(diagnostics, null, 4),
        );
    }),
});
