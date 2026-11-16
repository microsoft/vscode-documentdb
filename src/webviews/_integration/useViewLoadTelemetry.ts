/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useRef } from 'react';
import { type ViewFirstDataOutcome } from './observability/viewLoadTelemetry';
import { useTrpcClient } from './useTrpcClient';

export interface ViewLoadReporter {
    /**
     * The view's first load settled. Only the first call is sent; later loads (refresh, paging,
     * polling) are not load time. `firstDataRpcMs` is the webview's own timing of the request(s)
     * that produced the data.
     */
    reportFirstData(outcome: ViewFirstDataOutcome, firstDataRpcMs?: number): void;
}

/**
 * Sends the webview's load milestones for `documentDB.webview.viewLoaded`.
 *
 * Mounting reports `webviewReady` (the bundle ran and requests can be issued). The host owns the
 * timing and reports once per panel, so a remount or a repeated call cannot add a second event;
 * the guard here only avoids needless messages. Panels opened without load tracking ignore both.
 */
export function useViewLoadTelemetry(): ViewLoadReporter {
    const trpcClient = useTrpcClient();
    const firstDataReportedRef = useRef(false);

    useEffect(() => {
        trpcClient.common.reportViewLoad.mutate({ milestone: 'webviewReady' }).catch((error: unknown) => {
            console.debug('Failed to report view readiness:', error);
        });
    }, [trpcClient]);

    return useMemo(
        () => ({
            reportFirstData: (outcome: ViewFirstDataOutcome, firstDataRpcMs?: number): void => {
                if (firstDataReportedRef.current) {
                    return;
                }
                firstDataReportedRef.current = true;
                trpcClient.common.reportViewLoad
                    .mutate({ milestone: 'firstData', outcome, firstDataRpcMs })
                    .catch((error: unknown) => {
                        console.debug('Failed to report the first data load:', error);
                    });
            },
        }),
        [trpcClient],
    );
}
