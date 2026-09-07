/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { z } from 'zod';

import { openCollectionViewInternal } from '../../../commands/openCollectionView/openCollectionView';
import { ClustersClient } from '../../../documentdb/ClustersClient';
import { ShellCommandIds } from '../../../documentdb/shell/constants';
import { getHostsFromConnectionString } from '../../../documentdb/utils/connectionStringHelpers';
import {
    CURRENT_OP_SHARE_WINDOW_MS,
    getClusterPrivileges,
    getClusterTopology,
    getDatabaseCollections,
    getStorageStats,
    killOperation,
    listCurrentOperations,
    sampleClusterHealth,
    type ClusterHealthSample,
    type ClusterPrivileges,
    type ClusterStorageStats,
    type ClusterTopology,
    type CurrentOperationsResult,
    type DatabaseCollectionsResult,
} from '../../../documentdb/utils/getClusterHealth';
import { CopilotService } from '../../../services/copilotService';
import { getConfirmationAsInSettings } from '../../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../../utils/dialogs/showConfirmation';
import { readOnlyJsonDocumentProvider } from '../../../utils/readOnlyJsonDocumentProvider';
import { type BaseRouterContext } from '../../_integration/appRouter';
import { publicProcedureWithTelemetry, router, type WithTelemetry } from '../../_integration/trpc';
import { buildAskCopilotPrompt } from './askCopilotPrompt';
import {
    clearObservedOperations,
    getObservedOperations,
    isOccurrenceStillRunning,
    recordObservedOperations,
    type IdentifiedOperation,
    type ObservedOperation,
} from './operationHistory';
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

/**
 * Outcome of a kill request.
 *
 * `killOp` replies `{ok: 1}` whether or not anything matched, so the dashboard cannot
 * claim an operation "has been killed" — it can only distinguish these cases.
 */
export type KillOperationResult = {
    outcome: 'requested' | 'cancelled' | 'gone' | 'failed' | 'unverified';
};

/**
 * What the Operations tab renders: the live snapshot plus everything observed so far.
 * Both travel together because they are produced by the same poll.
 */
export interface OperationsPayload extends Omit<CurrentOperationsResult, 'operations'> {
    /** Each carries the occurrence identity the host assigned it. */
    operations: IdentifiedOperation[];
    history: ObservedOperation[];
}

/** Zod mirror of `ClusterHealthSample`, so exported diagnostics carry the live charts too. */
const healthSampleSchema = z.object({
    timestampMs: z.number(),
    pingLatencyMs: z.number().nullable(),
    uptimeSeconds: z.number().nullable(),
    connectionsCurrent: z.number().nullable(),
    opcounters: z.record(z.string(), z.number()).nullable(),
    activeOperations: z.number().nullable(),
    errors: z.array(z.string()),
});

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

    /**
     * The servers behind the connection. One-shot: membership changes on the timescale of a
     * failover, and the tab that renders it is not a monitoring surface.
     */
    getTopology: publicProcedureWithTelemetry.query(async ({ ctx }): Promise<ClusterTopology> => {
        const myCtx = ctx as WithTelemetry<RouterContext>;

        const client = await ClustersClient.getClient(myCtx.clusterId);

        return getClusterTopology(client.getMongoClient());
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

    /**
     * What the signed-in user is allowed to do. One-shot: privileges do not change during a
     * session, and this only drives whether an action is offered, never whether data loads.
     */
    getPrivileges: publicProcedureWithTelemetry.query(async ({ ctx }): Promise<ClusterPrivileges> => {
        const myCtx = ctx as WithTelemetry<RouterContext>;

        const client = await ClustersClient.getClient(myCtx.clusterId);

        return getClusterPrivileges(client.getMongoClient());
    }),

    /** Storage breakdown for the Storage tab. */
    getStorageStats: publicProcedureWithTelemetry.query(async ({ ctx }): Promise<ClusterStorageStats> => {
        const myCtx = ctx as WithTelemetry<RouterContext>;

        const client = await ClustersClient.getClient(myCtx.clusterId);

        return getStorageStats(client.getMongoClient(), myCtx.signal);
    }),

    /** In-flight operations for the Operations tab. Polled, so telemetry is suppressed. */
    getCurrentOperations: publicProcedureWithTelemetry.query(async ({ ctx }): Promise<OperationsPayload> => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        myCtx.actionContext.telemetry.suppressAll = true;

        const client = await ClustersClient.getClient(myCtx.clusterId);
        // May share the health sample's answer when both land in the same tick; the pre-kill
        // re-check below deliberately does not.
        const result = await listCurrentOperations(client.getMongoClient(), CURRENT_OP_SHARE_WINDOW_MS);

        // Every poll feeds the history, so the tab can answer "what has run" and not only
        // "what is running". Recorded here rather than in the webview so it survives a tab
        // switch, a hidden panel, and the webview remounting.
        //
        // A poll whose every attempt failed reports no operations, which is not the same fact
        // as "nothing is running" — recording it would flip every entry to Ended and tell a
        // user watching a long aggregation that it died.
        const operations = recordObservedOperations(
            myCtx.clusterId,
            result.operations,
            Date.now(),
            result.errors.length === 0,
        );

        return { ...result, operations, history: getObservedOperations(myCtx.clusterId) };
    }),

    /**
     * Opens everything the server answered about itself as a read-only JSON document.
     *
     * The Cluster card shows the handful of facts worth a permanent row; the metadata probe
     * collects far more, and which fields a given platform answers varies enough that no
     * fixed grid can cover it. Rather than guess, the whole reply is one click away — the
     * same escape hatch the index list's "View Raw Index Definition" and Query Insights'
     * "View Raw Execution Stats" provide.
     */
    viewRawClusterInfo: publicProcedureWithTelemetry.mutation(async ({ ctx }): Promise<void> => {
        const myCtx = ctx as WithTelemetry<RouterContext>;

        const client = await ClustersClient.getClient(myCtx.clusterId);
        const metadata = await client.getClusterMetadata();
        const topology = await getClusterTopology(client.getMongoClient()).catch(() => null);

        // No hosts and no connection string: the metadata carries only hashed domain
        // fragments, but the seed list is the address itself, and this document is one
        // Ctrl+A away from a bug report.
        const document = { metadata, topology };

        await readOnlyJsonDocumentProvider.openDocument(
            l10n.t('Cluster details: {clusterDisplayName}', { clusterDisplayName: myCtx.clusterDisplayName }),
            JSON.stringify(document, null, 4),
        );
    }),

    /**
     * Opens the topology probe's own reply as a read-only JSON document.
     *
     * The card can only name what it recognises, and every supported platform refuses at
     * least one of the commands the probe runs; the untouched reply is where a reader finds
     * out what a given server actually said.
     */
    viewRawTopology: publicProcedureWithTelemetry.mutation(async ({ ctx }): Promise<void> => {
        const myCtx = ctx as WithTelemetry<RouterContext>;

        const client = await ClustersClient.getClient(myCtx.clusterId);
        const topology = await getClusterTopology(client.getMongoClient());

        await readOnlyJsonDocumentProvider.openDocument(l10n.t('Cluster topology'), JSON.stringify(topology, null, 4));
    }),

    /** Drops the observed-operation history for this cluster. */
    clearOperationHistory: publicProcedureWithTelemetry.mutation(({ ctx }): void => {
        const myCtx = ctx as WithTelemetry<RouterContext>;

        clearObservedOperations(myCtx.clusterId);
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

    /** Copies an operation's command document to the clipboard. */
    copyCommand: publicProcedureWithTelemetry
        .input(z.object({ command: z.string() }))
        .mutation(async ({ input }): Promise<void> => {
            await vscode.env.clipboard.writeText(input.command);
            showConfirmationAsInSettings(l10n.t('Command copied to the clipboard.'));
        }),

    /**
     * Opens Copilot Chat preloaded with an operation and its cluster context.
     *
     * The value over pasting into chat by hand is what travels along: the redacted command
     * document, the observed runtime, and the platform's command support — so the model
     * does not recommend tools this server rejects. The handoff goes to the chat UI rather
     * than an inline completion so the user can keep interrogating from there.
     */
    askCopilotAboutOperation: publicProcedureWithTelemetry
        .input(
            z.object({
                opid: z.string(),
                type: z.string(),
                namespace: z.string(),
                commandPreview: z.string(),
                secsRunning: z.number().nullable(),
                clientDescription: z.string().nullable(),
                ended: z.boolean(),
            }),
        )
        .mutation(async ({ input, ctx }): Promise<void> => {
            const myCtx = ctx as WithTelemetry<RouterContext>;

            if (!(await CopilotService.isAvailable())) {
                throw new Error(
                    l10n.t(
                        'GitHub Copilot is not available. Please install the GitHub Copilot extension and ensure you have an active subscription.',
                    ),
                );
            }

            // Cached per client, so this does not re-run the metadata commands.
            const client = await ClustersClient.getClient(myCtx.clusterId);
            const metadata = await client.getClusterMetadata();

            const prompt = buildAskCopilotPrompt(myCtx.clusterDisplayName, metadata, input);

            await vscode.commands.executeCommand('workbench.action.chat.open', { query: prompt });
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
     * The live samples come from the webview because they are only kept there; everything
     * else is re-read fresh. No connection string or credential is included: cluster metadata
     * carries only hashed domain fragments, and command previews have had credential-bearing
     * commands and secret-shaped fields stripped.
     *
     * **That is not the same as safe to share.** What survives redaction is the rest of every
     * in-flight command: query filter values, document contents, and the client address that
     * issued them. This document is built to be attached to a bug report, so the user is asked
     * to confirm what it contains before it is produced rather than discovering it after
     * uploading. See `buildCommandPreview` for why a denylist cannot do better.
     */
    exportDiagnostics: publicProcedureWithTelemetry
        .input(z.object({ samples: z.array(healthSampleSchema) }))
        .mutation(async ({ input, ctx }): Promise<void> => {
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

            const [metadata, privileges, storage, operations, topology] = await Promise.all([
                client.getClusterMetadata(),
                getClusterPrivileges(mongoClient),
                getStorageStats(mongoClient),
                listCurrentOperations(mongoClient),
                getClusterTopology(mongoClient),
            ]);

            const diagnostics = {
                generatedAt: new Date().toISOString(),
                cluster: { displayName: myCtx.clusterDisplayName, viewId: myCtx.viewId },
                metadata,
                privileges,
                topology,
                storage,
                currentOperations: operations,
                observedOperations: getObservedOperations(myCtx.clusterId),
                healthSamples: input.samples,
            };

            await readOnlyJsonDocumentProvider.openDocument(
                l10n.t('Cluster diagnostics'),
                JSON.stringify(diagnostics, null, 4),
            );
        }),

    /**
     * Terminates a running operation. The confirmation prompt is raised here, on the host,
     * so it follows the user's configured confirmation style.
     */
    killOperation: publicProcedureWithTelemetry
        .input(
            z.object({
                opid: z.string(),
                opidIsNumeric: z.boolean(),
                namespace: z.string(),
                /** Identity of the run the user acted on, so a reissued opid is not mistaken for it. */
                occurrenceId: z.string(),
            }),
        )
        .mutation(async ({ input, ctx }): Promise<KillOperationResult> => {
            const myCtx = ctx as WithTelemetry<RouterContext>;

            let confirmed: boolean;
            try {
                confirmed = await getConfirmationAsInSettings(
                    l10n.t('Are you sure?'),
                    l10n.t('Kill operation "{opid}" on "{namespace}"?', {
                        opid: input.opid,
                        namespace: input.namespace || l10n.t('this cluster'),
                    }) +
                        '\n' +
                        l10n.t('This cannot be undone.'),
                    input.opid,
                    { fallbackWord: 'kill' },
                );
            } catch (error) {
                // The word-confirmation style (the default) throws UserCancelledError on
                // Escape rather than returning false. Without this, backing out of the
                // prompt surfaces in the webview as "Failed to kill the operation."
                if (error instanceof UserCancelledError) {
                    return { outcome: 'cancelled' };
                }
                throw error;
            }

            if (!confirmed) {
                return { outcome: 'cancelled' };
            }

            const client = await ClustersClient.getClient(myCtx.clusterId);
            const mongoClient = client.getMongoClient();

            // The prompt above blocks indefinitely (`ignoreFocusOut: true`) while the
            // Operations tab keeps refreshing, so by now the opid may have been recycled
            // onto a different operation. Re-check before killing rather than terminating
            // whatever happens to hold that id.
            const current = await listCurrentOperations(mongoClient);

            // A re-check that did not reach the server proves nothing. Killing anyway would
            // terminate whatever now holds the id on the strength of a check that failed, so
            // the destructive action fails closed and the user can retry with a fresh list.
            if (current.errors.length > 0) {
                showConfirmationAsInSettings(
                    l10n.t('Could not confirm that operation "{opid}" is still running. Nothing was killed.', {
                        opid: input.opid,
                    }),
                );
                return { outcome: 'unverified' };
            }

            // Folding the fresh poll into the history is what decides whether this opid is the
            // same run the user saw or a new one wearing its id: an operation whose elapsed
            // time went backwards, or one that a previous poll already retired, becomes a new
            // occurrence with a new identity.
            recordObservedOperations(myCtx.clusterId, current.operations, Date.now());

            if (!isOccurrenceStillRunning(myCtx.clusterId, input.occurrenceId)) {
                showConfirmationAsInSettings(l10n.t('Operation "{opid}" is no longer running.', { opid: input.opid }));
                return { outcome: 'gone' };
            }

            const acknowledged = await killOperation(mongoClient, input.opid, input.opidIsNumeric);

            if (!acknowledged) {
                return { outcome: 'failed' };
            }

            // `killOp` acknowledges the *request*; the server does not report whether an
            // operation actually matched, so the wording stays deliberately non-committal.
            showConfirmationAsInSettings(l10n.t('Kill request sent for operation "{opid}".', { opid: input.opid }));

            return { outcome: 'requested' };
        }),
});
