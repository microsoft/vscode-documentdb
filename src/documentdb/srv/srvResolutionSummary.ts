/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SrvResolutionPath, SrvResolutionReport } from '@documentdb-js/srv-resolver';

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
