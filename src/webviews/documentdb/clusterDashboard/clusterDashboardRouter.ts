/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

/** Header payload: the display name plus the cached, connection-time cluster metadata. */
export interface ClusterDashboardInfo {
    clusterDisplayName: string;
    /** Flat string map produced by `getClusterMetadata` (e.g. `serverInfo_version`). */
    metadata: Record<string, string | undefined>;
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
        .input(z.object({ opid: z.string(), namespace: z.string() }))
        .mutation(async ({ input, ctx }): Promise<{ killed: boolean }> => {
            const myCtx = ctx as WithTelemetry<RouterContext>;

            const confirmed = await getConfirmationAsInSettings(
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

            if (!confirmed) {
                return { killed: false };
            }

            const client = await ClustersClient.getClient(myCtx.clusterId);
            await killOperation(client.getMongoClient(), input.opid);

            showConfirmationAsInSettings(l10n.t('Operation "{opid}" has been killed.', { opid: input.opid }));

            return { killed: true };
        }),
});
