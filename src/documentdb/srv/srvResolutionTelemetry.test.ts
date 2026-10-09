/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createSrvResolutionSummary } from './srvResolutionSummary';
import { applySrvResolutionReport } from './srvResolutionTelemetry';

import { type SrvResolutionReport } from '@documentdb-js/srv-resolver';
import { type SrvResolutionTelemetry } from './srvResolutionTelemetry';

const report: SrvResolutionReport = {
    srvHost: 'x.global.mongocluster.cosmos.azure.com',
    srvServiceName: 'mongodb',
    path: 'fallback',
    outcome: 'succeeded',
    nodeErrorCode: 'EBADRESP',
    fallbackOutcome: 'succeeded',
    txtOptionsApplied: [],
    dnsServers: [],
    forcedFallback: false,
    aresVersion: '1.34.8',
    nodeRuntimeVersion: '22.0.0',
};

describe('SRV telemetry classification', (): void => {
    it.each([
        [[], 'none', 'none'],
        [['127.0.0.1:5353', '127.1.2.3'], 'loopback', 'ipv4'],
        [['[::1]:5353', '0:0:0:0:0:0:0:1'], 'loopback', 'ipv6'],
        [['10.0.0.1', '192.168.1.1:53', '172.16.1.1'], 'private', 'ipv4'],
        [['[fc00::1]:53', 'fe80::1'], 'private', 'ipv6'],
        [['[fe80::1%eth0]:53'], 'private', 'ipv6'],
        [['8.8.8.8:53', '1.1.1.1'], 'public', 'ipv4'],
        [['[2001:4860:4860::8888]:53'], 'public', 'ipv6'],
        [['127.0.0.1', '192.168.1.1'], 'mixed', 'ipv4'],
        [['192.168.1.1', '8.8.8.8'], 'mixed', 'ipv4'],
        [['8.8.8.8', '2001:4860:4860::8888'], 'public', 'mixed'],
    ])('classifies %j as %s / %s without disclosing addresses', (servers, expectedClass, family): void => {
        const telemetry: SrvResolutionTelemetry = { properties: {}, measurements: {} };
        applySrvResolutionReport(telemetry, { ...report, dnsServers: servers }, 'shell', { shellSessionId: 'session' });
        expect(telemetry.properties).toMatchObject({ dnsServerClass: expectedClass, dnsServerIpFamily: family });
        expect(telemetry.measurements.dnsServerCount).toBe(servers.length);
        const data = JSON.stringify(telemetry.properties);
        for (const server of servers) {
            expect(data).not.toContain(server);
        }
        expect(data).not.toContain(report.srvHost);
    });

    it.each([
        ['x.GLOBAL.mongocluster.cosmos.azure.com', 'true', 'true'],
        ['x.global.example.org', 'false', 'true'],
        ['globalish.example.org', 'false', 'false'],
        ['x.azure.com.example.org', 'false', 'false'],
    ])('classifies endpoint %s without emitting it', (srvHost, azure, global): void => {
        const telemetry: SrvResolutionTelemetry = { properties: {}, measurements: {} };
        applySrvResolutionReport(telemetry, { ...report, srvHost }, 'playground', {});
        expect(telemetry.properties).toMatchObject({ isAzureEndpoint: azure, isGlobalEndpoint: global });
        expect(JSON.stringify(telemetry)).not.toContain(srvHost);
    });

    it('copies only correlation IDs, categorical properties and numeric measurements', (): void => {
        const telemetry: SrvResolutionTelemetry = { properties: {}, measurements: {} };
        applySrvResolutionReport(
            telemetry,
            {
                ...report,
                targetCompressed: false,
                tlsAdded: false,
                forcedFallback: true,
                fallbackErrorCode: 'txt:ESERVFAIL',
                txtSource: 'none',
                txtOptionsApplied: ['replicaSet', 'authSource'],
                nodeProbeDurationMs: 5,
                fallbackDurationMs: 8,
                srvTargetCount: 2,
                fallbackServersTried: 1,
            },
            'extension',
            { journeyCorrelationId: 'journey', connectionCorrelationId: undefined, srvHost: report.srvHost },
        );
        expect(telemetry.properties).toMatchObject({
            journeyCorrelationId: 'journey',
            targetCompressed: 'false',
            tlsAdded: 'false',
            forcedFallback: 'true',
            txtOptionsApplied: 'authSource,replicaSet',
            txtSource: 'none',
            fallbackErrorCode: 'txt:ESERVFAIL',
        });
        expect(telemetry.properties).not.toHaveProperty('srvHost');
        expect(telemetry.properties).not.toHaveProperty('connectionCorrelationId');
        expect(telemetry.measurements).toEqual({
            nodeProbeDurationMs: 5,
            fallbackDurationMs: 8,
            srvTargetCount: 2,
            dnsServerCount: 0,
            fallbackServersTried: 1,
        });
    });

    it('produces a minimal host-free summary at resolution time', (): void => {
        const clock = jest.spyOn(Date, 'now').mockReturnValue(123456);
        try {
            expect(createSrvResolutionSummary({ ...report, fallbackTransport: 'tcp', srvTargetCount: 2 })).toEqual({
                path: 'fallback',
                nodeErrorCode: 'EBADRESP',
                fallbackTransport: 'tcp',
                srvTargetCount: 2,
                resolvedAt: 123456,
            });
            expect(
                createSrvResolutionSummary({ ...report, path: 'node', nodeErrorCode: 'none' }).nodeErrorCode,
            ).toBeUndefined();
        } finally {
            clock.mockRestore();
        }
    });
});
