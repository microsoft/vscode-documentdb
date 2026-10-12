/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { applySrvResolutionReport } from './srvResolutionTelemetry';

import { type SrvResolutionReport } from '@documentdb-js/srv-resolver';
import { type SrvResolutionTelemetry } from './srvResolutionTelemetry';

const report: SrvResolutionReport = {
    srvHost: 'x.global.mongocluster.cosmos.azure.com',
    path: 'fallback',
    outcome: 'succeeded',
    nodeErrorCode: 'EBADRESP',
    fallbackOutcome: 'succeeded',
    dnsServers: [],
    forcedFallback: false,
    aresVersion: '1.34.8',
    nodeRuntimeVersion: '22.0.0',
};

function apply(overrides: Partial<SrvResolutionReport>, correlation = {}): SrvResolutionTelemetry {
    const telemetry: SrvResolutionTelemetry = { properties: {}, measurements: {} };
    applySrvResolutionReport(telemetry, { ...report, ...overrides }, 'shell', correlation);
    return telemetry;
}

describe('applySrvResolutionReport', (): void => {
    it.each([
        [[], 'none'],
        [['127.0.0.1:5353', '[::1]:53'], 'loopback'],
        [['192.168.1.1:53', '[fe80::1%eth0]:53'], 'private'],
        [['8.8.8.8'], 'public'],
        [['192.168.1.1', '8.8.8.8'], 'mixed'],
    ])('classifies DNS servers %j as %s without sending them', (servers, expected): void => {
        const telemetry = apply({ dnsServers: servers });
        expect(telemetry.properties.dnsServerClass).toBe(expected);
        expect(telemetry.measurements.dnsServerCount).toBe(servers.length);
        const data = JSON.stringify(telemetry);
        for (const server of servers) {
            expect(data).not.toContain(server);
        }
    });

    it('copies categorical values and correlation IDs, never the host or other caller data', (): void => {
        const telemetry = apply(
            { forcedFallback: true, fallbackErrorCode: 'txt:ESERVFAIL', nodeProbeDurationMs: 5, srvTargetCount: 2 },
            { journeyCorrelationId: 'journey', connectionCorrelationId: undefined, srvHost: report.srvHost },
        );
        expect(telemetry.properties).toMatchObject({
            surface: 'shell',
            journeyCorrelationId: 'journey',
            isAzureEndpoint: 'true',
            forcedFallback: 'true',
            fallbackErrorCode: 'txt:ESERVFAIL',
        });
        expect(telemetry.properties).not.toHaveProperty('connectionCorrelationId');
        expect(telemetry.measurements).toMatchObject({ nodeProbeDurationMs: 5, srvTargetCount: 2 });
        expect(JSON.stringify(telemetry)).not.toContain(report.srvHost);
    });
});
