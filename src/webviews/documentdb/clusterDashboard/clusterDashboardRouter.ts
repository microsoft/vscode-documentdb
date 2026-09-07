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
    getClusterTopology,
    getDatabaseCollections,
    getStorageStats,
    listCurrentOperations,
    sampleClusterHealth,
    type ClusterHealthSample,
    type ClusterStorageStats,
    type DatabaseCollectionsResult,
} from '../../../documentdb/utils/getClusterHealth';
import { readOnlyJsonDocumentProvider } from '../../../utils/readOnlyJsonDocumentProvider';
import { type BaseRouterContext } from '../../_integration/appRouter';
import { publicProcedureWithTelemetry, router, type WithTelemetry } from '../../_integration/trpc';
import { resolveNamespaceNode } from './resolveNamespaceNode';

/**
 * The tree commands the inventory list may run, as a closed set.
 *
 * Every entry is a command the tree already offers on a database or collection node, so the
 * dashboard adds no new capability — only a second place to reach one. Kept as an allowlist
 * because the command id crosses the webview boundary: a webview must never be able to name
 * an arbitrary VS Code command for the host to execute.
 */
export const NAMESPACE_COMMAND_IDS = [
    'vscode-documentdb.command.dropDatabase',
    'vscode-documentdb.command.dropCollection',
    'vscode-documentdb.command.importDocuments',
    'vscode-documentdb.command.exportDocuments',
    'vscode-documentdb.command.copyCollection',
    'vscode-documentdb.command.pasteCollection',
    'vscode-documentdb.command.copyReference',
    'vscode-documentdb.command.playground.new',
    'vscode-documentdb.command.shell.open',
] as const;

export type NamespaceCommandId = (typeof NAMESPACE_COMMAND_IDS)[number];

/**
 * The server commands the dashboard describes a cluster with, run for the diagnostics
 * document and reported verbatim.
 *
 * These are the same commands `getClusterMetadata` and `getClusterTopology` run. The document
 * carries their replies rather than the metadata map built from them: that map is shaped for
 * telemetry — hashed, stringified, pruned to a fixed key set — so a field missing from it says
 * nothing about whether the server reported it, which is exactly the question a diagnostics
 * document exists to answer.
 *
 * `connectionStatus` is not among them because its reply names the signed-in principal.
 */
const DIAGNOSTIC_COMMANDS: ReadonlyArray<{ name: string; command: Document }> = [
    { name: 'buildInfo', command: { buildInfo: 1 } },
    { name: 'hello', command: { hello: 1 } },
    { name: 'serverStatus', command: { serverStatus: 1 } },
    { name: 'hostInfo', command: { hostInfo: 1 } },
    { name: 'replSetGetStatus', command: { replSetGetStatus: 1 } },
    { name: 'listShards', command: { listShards: 1 } },
];

/** One command's outcome: what it answered, or why it did not. */
type RawCommandReply = { ok: true; response: Document } | { ok: false; error: string };

/**
 * Runs every diagnostic command and keeps each outcome.
 *
 * A refusal is recorded, not dropped: every supported platform rejects at least one of these,
 * and "Azure DocumentDB (vCore) refuses serverStatus" is a finding a bug report needs, not a
 * gap to hide. They run concurrently because a failing command waits out the driver's server
 * selection timeout, and six of those in series is a minute of nothing happening.
 */
async function collectRawCommandReplies(client: MongoClient): Promise<Record<string, RawCommandReply>> {
    const adminDb = client.db().admin();

    const entries = await Promise.all(
        DIAGNOSTIC_COMMANDS.map(async ({ name, command }): Promise<[string, RawCommandReply]> => {
            try {
                return [name, { ok: true, response: await adminDb.command(command) }];
            } catch (error) {
                return [name, { ok: false, error: error instanceof Error ? error.message : String(error) }];
            }
        }),
    );

    return Object.fromEntries(entries);
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

    /** Storage breakdown for the Storage tab. */
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

    /** Opens the Collection View for an operation's namespace. */
    openNamespace: publicProcedureWithTelemetry
        .input(
            z.object({
                namespace: z.string(),
                initialTab: z.enum(['tab_result', 'tab_indexes', 'tab_queryInsights']).optional(),
            }),
        )
        .mutation(async ({ input, ctx }): Promise<void> => {
            const myCtx = ctx as WithTelemetry<RouterContext>;

            // `ns` is `database.collection`, and a collection name may itself contain dots,
            // so only the first separator is a boundary.
            const separatorIndex = input.namespace.indexOf('.');
            const databaseName = separatorIndex === -1 ? '' : input.namespace.slice(0, separatorIndex);
            const collectionName = separatorIndex === -1 ? '' : input.namespace.slice(separatorIndex + 1);

            if (databaseName === '' || collectionName === '') {
                throw new Error(
                    l10n.t('"{namespace}" does not name a collection.', { namespace: input.namespace || '—' }),
                );
            }

            await openCollectionViewInternal(myCtx.actionContext, {
                clusterId: myCtx.clusterId,
                clusterDisplayName: myCtx.clusterDisplayName,
                viewId: myCtx.viewId,
                databaseName,
                collectionName,
                initialTab: input.initialTab,
            });
        }),

    /**
     * Runs one of the tree's own database/collection commands against a row in the inventory.
     *
     * The dashboard reads its inventory from the server, so a row is not a tree node; the
     * node is found again from the stable `clusterId` and handed to the command unchanged.
     * Reusing the commands rather than reimplementing them is what keeps a drop from the
     * dashboard identical to a drop from the tree — same confirmation, same telemetry, same
     * refresh.
     *
     * `commandId` is a closed enum, not a string. A webview must never be able to name an
     * arbitrary VS Code command for the host to execute.
     */
    runNamespaceCommand: publicProcedureWithTelemetry
        .input(
            z.object({
                commandId: z.enum(NAMESPACE_COMMAND_IDS),
                databaseName: z.string().min(1),
                collectionName: z.string().min(1).optional(),
            }),
        )
        .mutation(async ({ input, ctx }): Promise<void> => {
            const myCtx = ctx as WithTelemetry<RouterContext>;
            myCtx.actionContext.telemetry.properties.namespaceCommand = input.commandId;
            myCtx.actionContext.telemetry.properties.namespaceLevel =
                input.collectionName === undefined ? 'database' : 'collection';

            const node = await resolveNamespaceNode(
                myCtx.viewId,
                myCtx.clusterId,
                input.databaseName,
                input.collectionName,
            );

            if (!node) {
                myCtx.actionContext.telemetry.properties.failureReason = 'namespaceNodeNotFound';
                throw new Error(
                    l10n.t(
                        'This action needs "{name}" to be present in the tree view, and it could not be found there. Expand this cluster in the tree and try again.',
                        { name: input.collectionName ?? input.databaseName },
                    ),
                );
            }

            await vscode.commands.executeCommand(input.commandId, node, null, {
                source: 'webview;clusterDashboard',
            });
        }),

    /**
     * Collects everything the dashboard knows into one read-only JSON document, so a cluster's
     * state can be attached to a bug report in one action instead of being retyped from
     * screenshots.
     *
     * Read-only, through the same provider as the two raw views, rather than an untitled
     * editor: an untitled document is dirty from the moment it opens and VS Code asks the
     * reader to save or discard a file they only wanted to look at.
     *
     * Everything is re-read here, on the host, at the moment of export — including the health
     * sample. No connection string or credential is included: cluster metadata carries only
     * hashed domain fragments, and command previews have had credential-bearing commands and
     * secret-shaped fields stripped.
     *
     * **That is not the same as safe to share.** What survives redaction is the rest of every
     * in-flight command: query filter values, document contents, and the client address that
     * issued them. This document is built to be attached to a bug report, so the user is asked
     * to confirm what it contains before it is produced rather than discovering it after
     * uploading. See `buildCommandPreview` for why a denylist cannot do better.
     */
    exportDiagnostics: publicProcedureWithTelemetry.mutation(async ({ ctx }): Promise<void> => {
        const myCtx = ctx as WithTelemetry<RouterContext>;

        const confirmed = await vscode.window.showWarningMessage(
            l10n.t('Export diagnostics for this cluster?'),
            {
                modal: true,
                detail: l10n.t(
                    'The document includes the commands running on this cluster: query filters, document values, and the client addresses that issued them, alongside storage and topology figures. Passwords and connection strings are removed, but application data is not. Review it before sharing.',
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

        const [storage, operations, topology, commands, health] = await Promise.all([
            getStorageStats(mongoClient),
            listCurrentOperations(mongoClient),
            getClusterTopology(mongoClient),
            collectRawCommandReplies(mongoClient),
            sampleClusterHealth(mongoClient),
        ]);

        const diagnostics = {
            generatedAt: new Date().toISOString(),
            cluster: { displayName: myCtx.clusterDisplayName, viewId: myCtx.viewId },
            // What each server command actually answered. Deliberately not the flattened
            // metadata map the extension builds from these: that map is shaped for
            // telemetry — hashed, stringified, and pruned to a fixed key set — so a field
            // absent from it says nothing about whether the server reported it.
            commands,
            topology,
            storage,
            currentOperations: operations,
            health,
        };

        await readOnlyJsonDocumentProvider.openDocument(
            l10n.t('Cluster diagnostics'),
            JSON.stringify(diagnostics, null, 4),
        );
    }),
});
