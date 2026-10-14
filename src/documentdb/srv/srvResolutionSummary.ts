/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type SrvResolutionPath, type SrvResolutionReport } from '@documentdb-js/srv-resolver';

/**
 * In-memory summary of how a connection's SRV record was resolved. No host names, no connection
 * string; never persisted. Kept on `ClustersClient` for a future cluster dashboard (D0021).
 */
export interface SrvResolutionSummary {
    readonly path: SrvResolutionPath;
    readonly nodeErrorCode?: string;
    readonly fallbackTransport?: 'udp' | 'tcp';
    readonly srvTargetCount?: number;
    readonly resolvedAt: number;
}

export function createSrvResolutionSummary(report: SrvResolutionReport): SrvResolutionSummary {
    return {
        path: report.path,
        nodeErrorCode: report.nodeErrorCode === 'none' ? undefined : report.nodeErrorCode,
        fallbackTransport: report.fallbackTransport,
        srvTargetCount: report.srvTargetCount,
        resolvedAt: Date.now(),
    };
}
