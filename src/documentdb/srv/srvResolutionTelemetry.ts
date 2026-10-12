/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isIP } from 'node:net';
import { hasAzureDomain } from '../utils/connectionStringHelpers';
import { extractHostname, isLocalOrPrivateHost } from '../utils/hostClassification';

import { type SrvResolutionReport } from '@documentdb-js/srv-resolver';
import { type ITelemetryContext } from '@microsoft/vscode-azext-utils';
import { type SrvResolutionSurface } from './prepareDriverConnectionString';

export interface SrvResolutionTelemetry {
    properties: ITelemetryContext['properties'];
    measurements: ITelemetryContext['measurements'];
}

function dnsServerClass(host: string): 'loopback' | 'private' | 'public' {
    if (
        (isIP(host) === 4 && host.startsWith('127.')) ||
        (isIP(host) === 6 && new URL(`http://[${host.split('%')[0]}]`).hostname === '[::1]')
    ) {
        return 'loopback';
    }
    return isLocalOrPrivateHost(host) ? 'private' : 'public';
}

function combinedClass(values: readonly string[]): string {
    const unique = new Set(values);
    if (!unique.size) {
        return 'none';
    }
    return unique.size === 1 ? values[0] : 'mixed';
}

export function applySrvResolutionReport(
    telemetry: Pick<ITelemetryContext, 'properties' | 'measurements'>,
    report: SrvResolutionReport,
    surface: SrvResolutionSurface,
    correlation: Readonly<Record<string, string | undefined>>,
): void {
    const servers = report.dnsServers.map(extractHostname);
    const families = servers.map((host): string => {
        switch (isIP(host)) {
            case 4:
                return 'ipv4';
            case 6:
                return 'ipv6';
            default:
                return 'none';
        }
    });
    // Only correlation IDs are accepted, never arbitrary caller data.
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
        txtOptionsApplied: report.txtOptionsApplied.length ? [...report.txtOptionsApplied].sort().join(',') : 'none',
        tlsAdded: report.tlsAdded === undefined ? undefined : report.tlsAdded ? 'true' : 'false',
        dnsServerClass: combinedClass(servers.map(dnsServerClass)),
        dnsServerIpFamily: combinedClass(families),
        aresVersion: report.aresVersion,
        nodeRuntimeVersion: report.nodeRuntimeVersion,
        isAzureEndpoint: hasAzureDomain(report.srvHost) ? 'true' : 'false',
        isGlobalEndpoint: report.srvHost.toLowerCase().split('.').includes('global') ? 'true' : 'false',
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
