/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { hasAzureDomain } from '../utils/connectionStringHelpers';
import { extractHostname, isLocalOrPrivateHost } from '../utils/hostClassification';

import { type SrvResolutionReport } from '@documentdb-js/srv-resolver';
import { type ITelemetryContext } from '@microsoft/vscode-azext-utils';
import { type SrvResolutionSurface } from './prepareDriverConnectionString';

export interface SrvResolutionTelemetry {
    properties: ITelemetryContext['properties'];
    measurements: ITelemetryContext['measurements'];
}

/** Classifies the system DNS servers without sending their addresses. */
function dnsServerClass(servers: readonly string[]): string {
    const classes = new Set(
        servers.map(extractHostname).map((host): string => {
            if (host.startsWith('127.') || host === '::1') {
                return 'loopback';
            }
            return isLocalOrPrivateHost(host) ? 'private' : 'public';
        }),
    );
    if (classes.size === 0) {
        return 'none';
    }
    return classes.size === 1 ? [...classes][0] : 'mixed';
}

/** Copies only categorical values, numbers and correlation IDs; never hosts or DNS server addresses. */
export function applySrvResolutionReport(
    telemetry: Pick<ITelemetryContext, 'properties' | 'measurements'>,
    report: SrvResolutionReport,
    surface: SrvResolutionSurface,
    correlation: Readonly<Record<string, string | undefined>>,
): void {
    for (const [key, value] of Object.entries(correlation)) {
        if ((key.endsWith('CorrelationId') || key === 'shellSessionId') && value !== undefined) {
            telemetry.properties[key] = value;
        }
    }
    Object.assign(telemetry.properties, {
        surface,
        path: report.path,
        nodeErrorCode: report.nodeErrorCode,
        fallbackOutcome: report.fallbackOutcome,
        fallbackErrorCode: report.fallbackErrorCode,
        fallbackTransport: report.fallbackTransport,
        txtSource: report.txtSource,
        dnsServerClass: dnsServerClass(report.dnsServers),
        aresVersion: report.aresVersion,
        nodeRuntimeVersion: report.nodeRuntimeVersion,
        isAzureEndpoint: hasAzureDomain(report.srvHost) ? 'true' : 'false',
        forcedFallback: report.forcedFallback ? 'true' : 'false',
    });
    Object.assign(telemetry.measurements, {
        nodeProbeDurationMs: report.nodeProbeDurationMs,
        fallbackDurationMs: report.fallbackDurationMs,
        srvTargetCount: report.srvTargetCount,
        dnsServerCount: report.dnsServers.length,
        fallbackServersTried: report.fallbackServersTried,
    });
}
