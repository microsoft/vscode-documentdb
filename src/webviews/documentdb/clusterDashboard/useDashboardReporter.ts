/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useConfiguration } from '@microsoft/vscode-ext-webview/react';
import { useCallback } from 'react';

import { useTrpcClient } from '../../_integration/useTrpcClient';
import { type ClusterDashboardWebviewConfigurationType } from './clusterDashboardController';

/**
 * Reports an interaction that never reaches the host on its own.
 *
 * Moving between the two inventory levels, or re-sorting the table, changes nothing outside
 * the webview — no procedure runs, so no `documentDB.rpc.*` event is emitted and the action is
 * invisible. These are exactly the choices the dashboard needs to see: which of the two ways
 * back out of a database people actually use, and which column they arrange the estate by.
 *
 * Every event carries the panel's session id, so a webview-side event and the host-side
 * procedure it leads to can be read as one sequence.
 */
export function useDashboardReporter(): (
    eventName: string,
    properties?: Record<string, string>,
    measurements?: Record<string, number>,
) => void {
    const trpcClient = useTrpcClient();
    const configuration = useConfiguration<ClusterDashboardWebviewConfigurationType>();
    const dashboardSessionId = configuration.dashboardSessionId;

    return useCallback(
        (eventName, properties, measurements) => {
            void trpcClient.common.reportEvent
                .mutate({
                    eventName,
                    properties: { ...properties, ...(dashboardSessionId ? { dashboardSessionId } : {}) },
                    measurements,
                })
                .catch((error: unknown) => {
                    console.debug('Failed to report an event:', error);
                });
        },
        [dashboardSessionId, trpcClient],
    );
}
