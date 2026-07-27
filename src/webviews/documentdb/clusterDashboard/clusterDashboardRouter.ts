/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { z } from 'zod';

import { ClustersClient } from '../../../documentdb/ClustersClient';
import {
    getStorageStats,
    killOperation,
    listCurrentOperations,
    sampleClusterHealth,
    type ClusterHealthSample,
    type ClusterStorageStats,
    type CurrentOperationsResult,
} from '../../../documentdb/utils/getClusterHealth';
import { getConfirmationAsInSettings } from '../../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../../utils/dialogs/showConfirmation';
import { type BaseRouterContext } from '../../_integration/appRouter';
import { publicProcedureWithTelemetry, router, type WithTelemetry } from '../../_integration/trpc';

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
}

/**
 * Outcome of a kill request.
 *
 * `killOp` replies `{ok: 1}` whether or not anything matched, so the dashboard cannot
 * claim an operation "has been killed" — it can only distinguish these cases.
 */
export type KillOperationResult = {
    outcome: 'requested' | 'cancelled' | 'gone' | 'failed';
};

export const clusterDashboardRouter = router({
    /**
     * One-shot header data. `getClusterMetadata` is cached per client, so this is cheap
     * to call again when a panel is revealed.
     */
    getClusterInfo: publicProcedureWithTelemetry.query(async ({ ctx }): Promise<ClusterDashboardInfo> => {
        const myCtx = ctx as WithTelemetry<RouterContext>;

        const client = await ClustersClient.getClient(myCtx.clusterId);
        const metadata = await client.getClusterMetadata();

        return { clusterDisplayName: myCtx.clusterDisplayName, metadata };
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

        return getStorageStats(client.getMongoClient());
    }),

    /** In-flight operations for the Operations tab. Polled, so telemetry is suppressed. */
    getCurrentOperations: publicProcedureWithTelemetry.query(async ({ ctx }): Promise<CurrentOperationsResult> => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        myCtx.actionContext.telemetry.suppressAll = true;

        const client = await ClustersClient.getClient(myCtx.clusterId);

        return listCurrentOperations(client.getMongoClient());
    }),

    /**
     * Terminates a running operation. The confirmation prompt is raised here, on the host,
     * so it follows the user's configured confirmation style.
     */
    killOperation: publicProcedureWithTelemetry
        .input(z.object({ opid: z.string(), opidIsNumeric: z.boolean(), namespace: z.string() }))
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
            const stillRunning = current.operations.some(
                (operation) => operation.opid === input.opid && operation.namespace === input.namespace,
            );

            if (!stillRunning && current.errors.length === 0) {
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
