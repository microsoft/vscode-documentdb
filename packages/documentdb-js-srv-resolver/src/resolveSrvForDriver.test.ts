/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import dns from 'node:dns';
import { FallbackDnsError, resolveSrvFallback, resolveTxtFallback } from './fallbackDnsClient.js';
import { resolveSrvForDriver } from './resolveSrvForDriver.js';
import { SrvResolutionCancelledError } from './types.js';

import type * as FallbackDnsClient from './fallbackDnsClient.js';
import { type SrvRecord } from 'node:dns';
import { type SrvResolutionReport } from './report.js';
import { type ResolveSrvForDriverInput } from './resolveSrvForDriver.js';

jest.mock('./fallbackDnsClient.js', () => ({
    ...jest.requireActual<typeof FallbackDnsClient>('./fallbackDnsClient.js'),
    resolveSrvFallback: jest.fn(),
    resolveTxtFallback: jest.fn(),
}));

const host = 'x.global.mongocluster.cosmos.azure.com';
const uri = `mongodb+srv://user:S3cr3t%40pw@${host}/db`;
const records: SrvRecord[] = [
    { name: 'one.global.mongocluster.cosmos.azure.com', port: 10260, priority: 0, weight: 0 },
    { name: 'two.global.mongocluster.cosmos.azure.com', port: 10260, priority: 0, weight: 0 },
];
const dnsReply = { server: '192.168.1.1:53', transport: 'udp' as const, serversTried: 1 };

function probeError(code = 'EBADRESP'): Error & { code: string } {
    return Object.assign(new Error(`querySrv ${code} _mongodb._tcp.${host}`), { code });
}

describe('resolveSrvForDriver', (): void => {
    let probe: jest.SpyInstance<Promise<SrvRecord[]>, [string]>;
    let reports: SrvResolutionReport[];
    let trace: jest.Mock<void, [string]>;

    beforeEach((): void => {
        jest.clearAllMocks();
        probe = jest.spyOn(dns.promises.Resolver.prototype, 'resolveSrv').mockRejectedValue(probeError());
        jest.spyOn(dns, 'getServers').mockReturnValue(['192.168.1.1']);
        jest.mocked(resolveSrvFallback).mockResolvedValue({ ...dnsReply, records });
        jest.mocked(resolveTxtFallback).mockResolvedValue({
            ...dnsReply,
            records: [['authSource=admin&replicaSet=globaldb']],
        });
        reports = [];
        trace = jest.fn<void, [string]>();
    });

    afterEach((): void => {
        jest.restoreAllMocks();
    });

    function run(overrides: Partial<ResolveSrvForDriverInput> = {}): ReturnType<typeof resolveSrvForDriver> {
        return resolveSrvForDriver({
            connectionString: uri,
            onReport: (report): void => {
                reports.push(report);
            },
            logger: { trace },
            ...overrides,
        });
    }

    it('returns a non-SRV string unchanged without DNS or a report', async (): Promise<void> => {
        await expect(run({ connectionString: 'mongodb://localhost' })).resolves.toMatchObject({ path: 'notSrv' });
        expect(probe).not.toHaveBeenCalled();
        expect(reports).toHaveLength(0);
    });

    it('hands the original string to the driver when the probe succeeds', async (): Promise<void> => {
        probe.mockResolvedValue(records);
        const options = { appName: 'same' };
        const result = await run({ options });
        expect(result).toMatchObject({ connectionString: uri, path: 'node' });
        expect(result.options).toBe(options);
        expect(probe).toHaveBeenCalledWith(`_mongodb._tcp.${host}`);
        expect(resolveSrvFallback).not.toHaveBeenCalled();
        expect(reports[0]).toMatchObject({ outcome: 'succeeded', nodeErrorCode: 'none', srvTargetCount: 2 });
    });

    it('passes a non-eligible probe error through to the driver', async (): Promise<void> => {
        probe.mockRejectedValue(probeError('ENOTFOUND'));
        await expect(run()).resolves.toMatchObject({ connectionString: uri, path: 'nodeErrorPassthrough' });
        expect(resolveSrvFallback).not.toHaveBeenCalled();
    });

    it.each(['EBADRESP', 'EFORMERR', 'ECONNREFUSED'])('falls back on %s', async (code): Promise<void> => {
        probe.mockRejectedValue(probeError(code));
        const result = await run({ options: { srvServiceName: 'mongodb', appName: 'keep' } });
        expect(result.connectionString).toBe(
            'mongodb://user:S3cr3t%40pw@one.global.mongocluster.cosmos.azure.com:10260,two.global.mongocluster.cosmos.azure.com:10260/db?authSource=admin&replicaSet=globaldb&tls=true',
        );
        expect(result.options).toEqual({ appName: 'keep' });
        expect(result.report).toMatchObject({
            path: 'fallback',
            outcome: 'succeeded',
            nodeErrorCode: code,
            fallbackOutcome: 'succeeded',
            fallbackTransport: 'udp',
            txtSource: 'fallback',
            dnsServers: ['192.168.1.1'],
        });
        for (const [line] of trace.mock.calls) {
            expect(line).not.toMatch(/S3cr3t|user:|mongodb(\+srv)?:\/\//);
        }
    });

    it('reports a disabled fallback and hands over the original string', async (): Promise<void> => {
        await expect(run({ fallback: 'off' })).resolves.toMatchObject({
            connectionString: uri,
            report: { path: 'nodeErrorPassthrough', fallbackOutcome: 'disabled' },
        });
        expect(resolveSrvFallback).not.toHaveBeenCalled();
    });

    it('runs a forced fallback after a successful probe', async (): Promise<void> => {
        probe.mockResolvedValue(records);
        await expect(run({ fallback: 'force' })).resolves.toMatchObject({
            path: 'fallback',
            report: { nodeErrorCode: 'none', forcedFallback: true },
        });
    });

    it('accepts an absent TXT record', async (): Promise<void> => {
        jest.mocked(resolveTxtFallback).mockRejectedValue(new FallbackDnsError('ENODATA', 'queryTxt', host, 1));
        const result = await run();
        expect(result.connectionString).not.toContain('authSource');
        expect(result.report).toMatchObject({ txtSource: 'none', fallbackOutcome: 'succeeded' });
    });

    it.each([
        ['SRV', 'ETIMEOUT', 'ETIMEOUT'],
        ['TXT', 'ESERVFAIL', 'txt:ESERVFAIL'],
    ])('rethrows the original probe error when the fallback %s query fails', async (which, code, reported) => {
        const original = probeError();
        probe.mockRejectedValue(original);
        const failure = new FallbackDnsError(code, which === 'SRV' ? 'querySrv' : 'queryTxt', host, 2);
        jest.mocked(which === 'SRV' ? resolveSrvFallback : resolveTxtFallback).mockRejectedValue(failure);
        await expect(run()).rejects.toBe(original);
        expect(reports[0]).toMatchObject({ outcome: 'failed', fallbackErrorCode: reported, fallbackServersTried: 2 });
    });

    it('throws a rewrite rejection itself', async (): Promise<void> => {
        jest.mocked(resolveSrvFallback).mockResolvedValue({
            ...dnsReply,
            records: [{ ...records[0], name: 'evil.example.org' }],
        });
        await expect(run()).rejects.toMatchObject({ kind: 'parentDomainMismatch' });
        expect(reports[0]).toMatchObject({ fallbackErrorCode: 'parentDomainMismatch' });
    });

    it('cancels a pending probe and rejects with the abort reason', async (): Promise<void> => {
        const controller = new AbortController();
        let rejectProbe!: (error: unknown) => void;
        probe.mockImplementation(
            (): Promise<never> =>
                new Promise((_resolve, reject): void => {
                    rejectProbe = reject;
                }),
        );
        const cancel = jest
            .spyOn(dns.promises.Resolver.prototype, 'cancel')
            .mockImplementation((): void => rejectProbe(probeError('ECANCELLED')));
        const result = run({ signal: controller.signal });
        await Promise.resolve();
        const reason = new Error('stop');
        controller.abort(reason);
        await expect(result).rejects.toBe(reason);
        expect(cancel).toHaveBeenCalled();
        expect(reports[0].outcome).toBe('cancelled');
        expect(resolveSrvFallback).not.toHaveBeenCalled();
    });

    it('uses SrvResolutionCancelledError for a non-Error abort reason', async (): Promise<void> => {
        const controller = new AbortController();
        controller.abort('stop');
        await expect(run({ signal: controller.signal })).rejects.toBeInstanceOf(SrvResolutionCancelledError);
        expect(probe).not.toHaveBeenCalled();
    });

    it.each([
        [undefined, 20000],
        [5000, 5000],
        [40000, 20000],
    ])('bounds the fallback deadline (deadlineMs=%s)', async (deadlineMs, expected): Promise<void> => {
        jest.spyOn(Date, 'now').mockReturnValue(100000);
        await run({ deadlineMs });
        expect(jest.mocked(resolveSrvFallback).mock.calls[0][1]).toMatchObject({
            deadlineAt: 100000 + expected,
            servers: ['192.168.1.1'],
        });
    });
});
