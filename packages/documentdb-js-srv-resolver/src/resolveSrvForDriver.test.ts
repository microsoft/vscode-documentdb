/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MongoAPIError, MongoClient } from 'mongodb';
import * as dns from 'node:dns';
import { FallbackDnsError } from './fallbackDnsClient';
import { resolveSrvForDriver } from './resolveSrvForDriver';
import { getSrvRewriteErrorKind } from './srvUriRewrite';
import * as srvUriRewrite from './srvUriRewrite';
import { SrvResolutionCancelledError } from './types';

import type { SrvRecord } from 'node:dns';
import type { MongoClientOptions } from 'mongodb';
import type { FallbackDnsResult, FallbackSrvResult } from './fallbackDnsClient';
import type { ResolveSrvForDriverInput } from './resolveSrvForDriver';
import type { SrvResolutionReport } from './report';
import type { RewriteSrvUriResult } from './srvUriRewrite';

const host = 'x.global.mongocluster.cosmos.azure.com';
const uri = `mongodb+srv://user:S3cr3t%40pw@${host}/?appName=@x@`;
const records: SrvRecord[] = [
    { name: `one.global.mongocluster.cosmos.azure.com`, port: 10260, priority: 0, weight: 0 },
    { name: `two.global.mongocluster.cosmos.azure.com`, port: 10260, priority: 0, weight: 0 },
];
const srvReply: FallbackSrvResult = {
    records, server: '192.168.1.1:53', transport: 'udp', attempts: [],
    serversTried: 1, replyBytes: 100, targetCompressed: true,
};
const txtReply: FallbackDnsResult<string[]> = {
    records: [['authSource=admin&replicaSet=globaldb']], server: srvReply.server,
    transport: 'udp', attempts: [], serversTried: 1, replyBytes: 50,
};

function probeError(code = 'EBADRESP'): Error & { code: string } {
    return Object.assign(new Error(`querySrv ${code} _mongodb._tcp.${host}`), { code });
}

function dnsError(code: string, syscall: 'querySrv' | 'queryTxt' = 'querySrv'): FallbackDnsError {
    return new FallbackDnsError(code, syscall, host, 2, []);
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej): void => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function fixture(overrides: Partial<ResolveSrvForDriverInput> = {}): {
    input: ResolveSrvForDriverInput;
    probe: { resolveSrv: jest.Mock<Promise<SrvRecord[]>, [string]>; cancel: jest.Mock };
    fallback: {
        resolveSrv: jest.Mock<Promise<FallbackSrvResult>, Parameters<NonNullable<ResolveSrvForDriverInput['fallbackDns']>['resolveSrv']>>;
        resolveTxt: jest.Mock<Promise<FallbackDnsResult<string[]>>, Parameters<NonNullable<ResolveSrvForDriverInput['fallbackDns']>['resolveTxt']>>;
    };
    reports: SrvResolutionReport[];
    trace: jest.Mock<void, [string]>;
} {
    const probe = { resolveSrv: jest.fn<Promise<SrvRecord[]>, [string]>().mockRejectedValue(probeError()), cancel: jest.fn() };
    const fallback = {
        resolveSrv: jest.fn<Promise<FallbackSrvResult>, Parameters<NonNullable<ResolveSrvForDriverInput['fallbackDns']>['resolveSrv']>>().mockResolvedValue(srvReply),
        resolveTxt: jest.fn<Promise<FallbackDnsResult<string[]>>, Parameters<NonNullable<ResolveSrvForDriverInput['fallbackDns']>['resolveTxt']>>().mockResolvedValue(txtReply),
    };
    const reports: SrvResolutionReport[] = [];
    const trace = jest.fn<void, [string]>();
    return {
        input: {
            connectionString: uri, options: {}, createProbeResolver: (): typeof probe => probe,
            fallbackDns: fallback, getServers: (): string[] => ['192.168.1.1'],
            onReport: (report): void => { reports.push(report); }, logger: { trace },
            logPrefix: '[SrvResolution] correlation', logContext: 'surface=extension', ...overrides,
        },
        probe, fallback, reports, trace,
    };
}

describe('resolveSrvForDriver paths and reports', (): void => {
    it('returns non-SRV unchanged without DNS, trace or report', async (): Promise<void> => {
        const f = fixture({ connectionString: 'mongodb://localhost', options: { appName: 'same' } });
        const result = await resolveSrvForDriver(f.input);
        expect(result).toEqual({ connectionString: f.input.connectionString, options: f.input.options, path: 'notSrv' });
        expect(result.options).toBe(f.input.options);
        expect(f.probe.resolveSrv).not.toHaveBeenCalled();
        expect(f.fallback.resolveSrv).not.toHaveBeenCalled();
        expect(f.trace).not.toHaveBeenCalled();
        expect(f.reports).toHaveLength(0);
    });

    it('returns the original URI and exact options reference when the probe succeeds', async (): Promise<void> => {
        const f = fixture({ options: { srvServiceName: 'custom' } });
        f.probe.resolveSrv.mockResolvedValue(records);
        const result = await resolveSrvForDriver(f.input);
        expect(result.connectionString).toBe(uri);
        expect(result.options).toBe(f.input.options);
        expect(f.probe.resolveSrv).toHaveBeenCalledWith(`_custom._tcp.${host}`);
        expect(f.fallback.resolveSrv).not.toHaveBeenCalled();
        expect(result.report).toBe(f.reports[0]);
        expect(result.report).toMatchObject({
            path: 'node', outcome: 'succeeded', nodeErrorCode: 'none',
            fallbackOutcome: 'notAttempted', txtOptionsApplied: [], nodeProbeDurationMs: expect.any(Number),
            aresVersion: process.versions.ares, nodeRuntimeVersion: process.versions.node, srvTargetCount: 2,
        });
        expect(result.report?.txtSource).toBeUndefined();
        expect(result.report?.fallbackDurationMs).toBeUndefined();
    });

    it.each(['ENOTFOUND', 'ETIMEOUT', 'ENODATA'])('passes %s through to the driver without throwing', async (code): Promise<void> => {
        const f = fixture();
        f.probe.resolveSrv.mockRejectedValue(probeError(code));
        const result = await resolveSrvForDriver(f.input);
        expect(result).toMatchObject({
            connectionString: uri, path: 'nodeErrorPassthrough',
            report: { outcome: 'succeeded', nodeErrorCode: code, fallbackOutcome: 'notAttempted' },
        });
        expect(result.options).toBe(f.input.options);
        expect(f.fallback.resolveSrv).not.toHaveBeenCalled();
        expect(f.reports).toHaveLength(1);
    });

    it.each(['EBADRESP', 'EFORMERR', 'ECONNREFUSED'])('falls back on %s', async (code): Promise<void> => {
        const options = Object.freeze({ srvServiceName: 'custom', appName: 'unchanged' });
        const f = fixture({ options });
        f.probe.resolveSrv.mockRejectedValue(probeError(code));
        const result = await resolveSrvForDriver(f.input);
        expect(result.path).toBe('fallback');
        expect(result.connectionString.startsWith('mongodb://')).toBe(true);
        expect(result.options).not.toBe(options);
        expect(result.options).toEqual({ appName: 'unchanged' });
        expect(options).toEqual({ srvServiceName: 'custom', appName: 'unchanged' });
        expect(result.report).toBe(f.reports[0]);
        expect(result.report).toMatchObject({
            srvHost: host, srvServiceName: 'custom', path: 'fallback', outcome: 'succeeded',
            nodeErrorCode: code, fallbackOutcome: 'succeeded', fallbackTransport: 'udp',
            targetCompressed: true, txtSource: 'fallback', txtOptionsApplied: ['authSource', 'replicaSet'],
            tlsAdded: true, dnsServers: ['192.168.1.1'], fallbackServersTried: 1, srvTargetCount: 2,
            forcedFallback: false, nodeProbeDurationMs: expect.any(Number), fallbackDurationMs: expect.any(Number),
        });
        expect(f.trace.mock.calls.filter(([line]): boolean => line.includes('DNS reply for'))).toHaveLength(1);
    });

    it.each([
        ['EBADRESP', 'nodeErrorPassthrough', 'disabled'],
        ['ENOTFOUND', 'nodeErrorPassthrough', 'notAttempted'],
        ['none', 'node', 'notAttempted'],
    ])('off switch with %s reports %s and %s', async (code, path, outcome): Promise<void> => {
        const f = fixture({ fallback: 'off' });
        if (code === 'none') { f.probe.resolveSrv.mockResolvedValue(records); }
        else { f.probe.resolveSrv.mockRejectedValue(probeError(code)); }
        const result = await resolveSrvForDriver(f.input);
        expect(result.report).toMatchObject({ path, fallbackOutcome: outcome, forcedFallback: false });
        expect(f.fallback.resolveSrv).not.toHaveBeenCalled();
    });

    it.each(['none', 'ENOTFOUND'])('force runs fallback after %s and still probes', async (code): Promise<void> => {
        const f = fixture({ fallback: 'force' });
        if (code === 'none') { f.probe.resolveSrv.mockResolvedValue(records); }
        else { f.probe.resolveSrv.mockRejectedValue(probeError(code)); }
        const result = await resolveSrvForDriver(f.input);
        expect(result.report).toMatchObject({ path: 'fallback', nodeErrorCode: code, forcedFallback: true });
        expect(f.probe.resolveSrv).toHaveBeenCalledTimes(1);
        if (code === 'none') {
            expect(f.trace.mock.calls.some(([line]): boolean => line.includes('was rejected by Node.js'))).toBe(false);
        }
    });

    it('queries afresh on every call', async (): Promise<void> => {
        const f = fixture();
        await resolveSrvForDriver(f.input);
        await resolveSrvForDriver(f.input);
        expect(f.probe.resolveSrv).toHaveBeenCalledTimes(2);
        expect(f.fallback.resolveSrv).toHaveBeenCalledTimes(2);
        expect(f.fallback.resolveTxt).toHaveBeenCalledTimes(2);
        expect(f.reports).toHaveLength(2);
    });

    it('creates a fresh Node resolver with default timeout and tries', async (): Promise<void> => {
        const f = fixture();
        f.probe.resolveSrv.mockResolvedValue(records);
        const resolver = jest.spyOn(dns.promises, 'Resolver').mockImplementation((): dns.promises.Resolver =>
            f.probe as unknown as dns.promises.Resolver,
        );
        try {
            await resolveSrvForDriver({ ...f.input, createProbeResolver: undefined });
            await resolveSrvForDriver({ ...f.input, createProbeResolver: undefined });
            expect(resolver.mock.calls).toEqual([[], []]);
        } finally { resolver.mockRestore(); }
    });

    it('swallows onReport exceptions', async (): Promise<void> => {
        const f = fixture({ onReport: (): never => { throw new Error('observer'); } });
        await expect(resolveSrvForDriver(f.input)).resolves.toMatchObject({ path: 'fallback' });
        const original = probeError();
        f.probe.resolveSrv.mockRejectedValue(original);
        f.fallback.resolveSrv.mockRejectedValue(dnsError('ETIMEOUT'));
        await expect(resolveSrvForDriver(f.input)).rejects.toBe(original);
    });
});

describe('errors, preflight and privacy', (): void => {
    it('rethrows the original probe error object on DNS failure', async (): Promise<void> => {
        const f = fixture();
        const original = probeError();
        f.probe.resolveSrv.mockRejectedValue(original);
        f.fallback.resolveSrv.mockRejectedValue(dnsError('ETIMEOUT'));
        await expect(resolveSrvForDriver(f.input)).rejects.toBe(original);
        expect(f.reports[0]).toMatchObject({
            path: 'fallback', outcome: 'failed', fallbackOutcome: 'failed',
            fallbackErrorCode: 'ETIMEOUT', fallbackServersTried: 2, fallbackDurationMs: expect.any(Number),
        });
    });

    it('throws the fallback error itself when forced after a successful probe (R5)', async (): Promise<void> => {
        const f = fixture({ fallback: 'force' });
        const failure = dnsError('ETIMEOUT');
        f.probe.resolveSrv.mockResolvedValue(records);
        f.fallback.resolveSrv.mockRejectedValue(failure);
        await expect(resolveSrvForDriver(f.input)).rejects.toBe(failure);
        expect(f.reports[0]).toMatchObject({ nodeErrorCode: 'none', fallbackErrorCode: 'ETIMEOUT' });
    });

    it('throws the rewrite validation error unchanged, not the probe error', async (): Promise<void> => {
        const f = fixture();
        f.fallback.resolveSrv.mockResolvedValue({ ...srvReply, records: [{ ...records[0], name: 'evil.example.org' }] });
        const originalRewrite = srvUriRewrite.rewriteSrvUri;
        let originalFailure: unknown;
        const rewrite = jest.spyOn(srvUriRewrite, 'rewriteSrvUri').mockImplementation((args): RewriteSrvUriResult => {
            try { return originalRewrite(args); }
            catch (error) { originalFailure = error; throw error; }
        });
        try {
            let failure: unknown;
            try { await resolveSrvForDriver(f.input); } catch (error) { failure = error; }
            expect(failure).toBeInstanceOf(MongoAPIError);
            expect(failure).toBe(originalFailure);
            expect(getSrvRewriteErrorKind(failure)).toBe('parentDomainMismatch');
            expect(f.reports[0]).toMatchObject({ fallbackErrorCode: 'parentDomainMismatch', outcome: 'failed' });
        } finally { rewrite.mockRestore(); }
    });

    it('throws the real preflight error as-is and never starts fallback DNS', async (): Promise<void> => {
        let failure: unknown;
        const f = fixture({
            connectionString: `${uri}&directConnection=true`,
            createPreflightClient: (connectionString, options): MongoClient => {
                try { return new MongoClient(connectionString, options); }
                catch (error) { failure = error; throw error; }
            },
        });
        let thrown: unknown;
        try { await resolveSrvForDriver(f.input); } catch (error) { thrown = error; }
        expect(thrown).toBeInstanceOf(MongoAPIError);
        expect(failure).toBeDefined();
        expect(thrown).toBe(failure);
        expect(f.fallback.resolveSrv).not.toHaveBeenCalled();
        expect(f.fallback.resolveTxt).not.toHaveBeenCalled();
        expect(f.reports[0]).toMatchObject({ fallbackErrorCode: 'preflight' });
    });

    it.each(['ENODATA', 'ENOTFOUND'])('accepts absent TXT (%s)', async (code): Promise<void> => {
        const f = fixture();
        f.fallback.resolveTxt.mockRejectedValue(dnsError(code, 'queryTxt'));
        const result = await resolveSrvForDriver(f.input);
        expect(result.report).toMatchObject({ txtSource: 'none', txtOptionsApplied: [], fallbackOutcome: 'succeeded' });
    });

    it('reports TXT SERVFAIL, rethrowing the original probe failure', async (): Promise<void> => {
        const f = fixture();
        const original = probeError();
        f.probe.resolveSrv.mockRejectedValue(original);
        f.fallback.resolveTxt.mockRejectedValue(dnsError('ESERVFAIL', 'queryTxt'));
        await expect(resolveSrvForDriver(f.input)).rejects.toBe(original);
        expect(f.reports[0]).toMatchObject({ fallbackErrorCode: 'txt:ESERVFAIL', fallbackServersTried: 2 });
    });

    it('does not hide the primary SRV failure when TXT also fails', async (): Promise<void> => {
        const f = fixture();
        const original = probeError();
        f.probe.resolveSrv.mockRejectedValue(original);
        f.fallback.resolveSrv.mockRejectedValue(dnsError('ETIMEOUT'));
        f.fallback.resolveTxt.mockRejectedValue(dnsError('ESERVFAIL', 'queryTxt'));
        await expect(resolveSrvForDriver(f.input)).rejects.toBe(original);
        expect(f.reports[0].fallbackErrorCode).toBe('ETIMEOUT');
    });

    it('keeps the rewrite validation behavior for an empty successful TXT answer', async (): Promise<void> => {
        const f = fixture();
        f.fallback.resolveTxt.mockResolvedValue({ ...txtReply, records: [] });
        await expect(resolveSrvForDriver(f.input)).rejects.toBeInstanceOf(TypeError);
        expect(f.reports[0]).toMatchObject({ txtSource: 'fallback', fallbackErrorCode: 'txtInvalid' });
    });

    it.each(['options', 'uri'])('does not preflight OIDC on the node path (%s)', async (source): Promise<void> => {
        const createClient = jest.fn();
        const f = fixture({
            options: source === 'options' ? { authMechanism: 'MONGODB-OIDC' } : {},
            connectionString: source === 'uri' ? `mongodb+srv://${host}/?authMechanism=MONGODB-OIDC` : `mongodb+srv://${host}`,
            createPreflightClient: createClient,
        });
        f.probe.resolveSrv.mockResolvedValue(records);
        await expect(resolveSrvForDriver(f.input)).resolves.toMatchObject({ path: 'node' });
        expect(createClient).not.toHaveBeenCalled();
    });

    it.each(['options', 'uri'])('preflights OIDC using only a discarded stub (%s, R1)', async (source): Promise<void> => {
        const connect = jest.spyOn(MongoClient.prototype, 'connect');
        const options: MongoClientOptions = source === 'options' ? { authMechanism: 'MONGODB-OIDC' } : {};
        const callbacks: jest.Mock[] = [];
        const f = fixture({
            options,
            connectionString: source === 'uri' ? `mongodb+srv://${host}/?authMechanism=MONGODB-OIDC` : `mongodb+srv://${host}`,
            createPreflightClient: (connectionString, copy): MongoClient => {
                const callback = copy.authMechanismProperties?.OIDC_CALLBACK;
                expect(callback).toBeInstanceOf(Function);
                const spy = jest.fn(callback);
                callbacks.push(spy);
                return new MongoClient(connectionString, {
                    ...copy, authMechanismProperties: { ...copy.authMechanismProperties, OIDC_CALLBACK: spy },
                });
            },
        });
        try {
            const result = await resolveSrvForDriver(f.input);
            expect(result.path).toBe('fallback');
            expect(result.options.authMechanismProperties?.OIDC_CALLBACK).toBeUndefined();
            expect(options.authMechanismProperties).toBeUndefined();
            expect(connect).not.toHaveBeenCalled();
            expect(callbacks).toHaveLength(1);
            expect(callbacks[0]).not.toHaveBeenCalled();
        } finally { connect.mockRestore(); }
    });

    it.each(['OIDC_CALLBACK', 'OIDC_HUMAN_CALLBACK', 'ENVIRONMENT'])('keeps an existing OIDC provider (%s)', async (key): Promise<void> => {
        const value = key === 'ENVIRONMENT' ? 'azure' : jest.fn();
        const properties = { [key]: value, ...(key === 'ENVIRONMENT' ? { TOKEN_RESOURCE: 'test-resource' } : {}) };
        const f = fixture({
            connectionString: `mongodb+srv://${host}`, options: { authMechanism: 'MONGODB-OIDC', authMechanismProperties: properties },
            createPreflightClient: (connectionString, copy): MongoClient => {
                expect(copy.authMechanismProperties).toBe(properties);
                return new MongoClient(connectionString, copy);
            },
        });
        await expect(resolveSrvForDriver(f.input)).resolves.toMatchObject({ path: 'fallback' });
    });

    it('respects ENVIRONMENT provided through URI authMechanismProperties', async (): Promise<void> => {
        const f = fixture({
            connectionString: `mongodb+srv://${host}/?authMechanism=MONGODB-OIDC&authMechanismProperties=ENVIRONMENT:azure,TOKEN_RESOURCE:test-resource`,
            createPreflightClient: (connectionString, copy): MongoClient => {
                expect(copy.authMechanismProperties).toBeUndefined();
                return new MongoClient(connectionString, copy);
            },
        });
        await expect(resolveSrvForDriver(f.input)).resolves.toMatchObject({ path: 'fallback' });
    });

    it.each(['node', 'passthrough', 'success', 'srv', 'txt', 'rewrite', 'preflight', 'malformed', 'forced', 'off'])(
        'never traces credentials, URI or driver error messages (%s)', async (path): Promise<void> => {
            const f = fixture();
            if (path === 'node') { f.probe.resolveSrv.mockResolvedValue(records); }
            if (path === 'passthrough') { f.probe.resolveSrv.mockRejectedValue(probeError('ENOTFOUND')); }
            if (path === 'srv') { f.fallback.resolveSrv.mockRejectedValue(dnsError('ETIMEOUT')); }
            if (path === 'txt') { f.fallback.resolveTxt.mockRejectedValue(dnsError('ESERVFAIL', 'queryTxt')); }
            if (path === 'rewrite') {
                f.fallback.resolveSrv.mockResolvedValue({ ...srvReply, records: [{ ...records[0], name: 'other.org' }] });
            }
            let input = f.input;
            if (path === 'preflight') {
                input = { ...input, createPreflightClient: (): never => { throw new Error(`Invalid connection string "${uri}"`); } };
            }
            if (path === 'malformed') { input = { ...input, connectionString: 'mongodb+srv://user:S3cr3t%40pw@' }; }
            if (path === 'forced') { input = { ...input, fallback: 'force' }; f.probe.resolveSrv.mockResolvedValue(records); }
            if (path === 'off') { input = { ...input, fallback: 'off' }; }
            try { await resolveSrvForDriver(input); } catch { /* failure paths are expected */ }
            for (const [line] of f.trace.mock.calls) {
                expect(line.startsWith('[SrvResolution] correlation')).toBe(true);
                for (const secret of ['S3cr3t', 'user:', 'user:S3cr3t%40pw@', 'mongodb+srv://', 'mongodb://']) {
                    expect(line).not.toContain(secret);
                }
            }
        },
    );
});

describe('cancellation and shared deadline', (): void => {
    it('cancels a pending probe and propagates the exact reason, not ECANCELLED (R2)', async (): Promise<void> => {
        const controller = new AbortController();
        const f = fixture({ signal: controller.signal });
        const pending = deferred<SrvRecord[]>();
        const started = deferred<void>();
        f.probe.resolveSrv.mockImplementation((): Promise<SrvRecord[]> => { started.resolve(); return pending.promise; });
        f.probe.cancel.mockImplementation((): void => { pending.reject(probeError('ECANCELLED')); });
        const result = resolveSrvForDriver(f.input);
        await started.promise;
        const reason = new Error('caller cancellation');
        controller.abort(reason);
        await expect(result).rejects.toBe(reason);
        expect(f.probe.cancel).toHaveBeenCalledTimes(1);
        expect(f.reports[0]).toMatchObject({ outcome: 'cancelled', nodeErrorCode: 'none' });
        expect(f.fallback.resolveSrv).not.toHaveBeenCalled();
    });

    it('uses the package cancellation type for a non-Error reason', async (): Promise<void> => {
        const controller = new AbortController();
        controller.abort('stop');
        const f = fixture({ signal: controller.signal });
        await expect(resolveSrvForDriver(f.input)).rejects.toBeInstanceOf(SrvResolutionCancelledError);
        expect(f.reports).toHaveLength(1);
        expect(f.reports[0].outcome).toBe('cancelled');
        expect(f.probe.resolveSrv).not.toHaveBeenCalled();
    });

    it('keeps already-aborted Error reasons by identity', async (): Promise<void> => {
        const controller = new AbortController();
        const reason = new Error('already cancelled');
        controller.abort(reason);
        const f = fixture({ signal: controller.signal });
        await expect(resolveSrvForDriver(f.input)).rejects.toBe(reason);
        expect(f.reports).toHaveLength(1);
        expect(f.probe.resolveSrv).not.toHaveBeenCalled();
    });

    it.each(['srv', 'txt'])('aborts immediately while %s is pending, even if the fake ignores signal', async (which): Promise<void> => {
        const controller = new AbortController();
        const f = fixture({ signal: controller.signal });
        const started = deferred<void>();
        if (which === 'srv') {
            f.fallback.resolveSrv.mockImplementation((): Promise<FallbackSrvResult> => {
                started.resolve(); return new Promise((): void => {});
            });
        } else {
            f.fallback.resolveTxt.mockImplementation((): Promise<FallbackDnsResult<string[]>> => {
                started.resolve(); return new Promise((): void => {});
            });
        }
        const result = resolveSrvForDriver(f.input);
        await started.promise;
        const reason = new Error('cancel fallback');
        controller.abort(reason);
        await expect(result).rejects.toBe(reason);
        expect(f.reports[0]).toMatchObject({ path: 'fallback', outcome: 'cancelled' });
    });

    it.each(['probe', 'preflight', 'rewrite'])('checks cancellation between steps (%s)', async (step): Promise<void> => {
        const controller = new AbortController();
        const reason = new Error('between steps');
        const f = fixture({ signal: controller.signal });
        let input = f.input;
        if (step === 'probe') {
            f.probe.resolveSrv.mockImplementation(async (): Promise<SrvRecord[]> => {
                controller.abort(reason); return records;
            });
        } else if (step === 'preflight') {
            input = { ...input, createPreflightClient: (): void => controller.abort(reason) };
        } else {
            input = { ...input, logger: { trace: (line): void => {
                if (line.includes('rewrite targets=')) { controller.abort(reason); }
            } } };
        }
        await expect(resolveSrvForDriver(input)).rejects.toBe(reason);
        expect(f.reports[0].outcome).toBe('cancelled');
        if (step !== 'rewrite') { expect(f.fallback.resolveSrv).not.toHaveBeenCalled(); }
    });

    it('cancellation wins a raced fallback DNS failure', async (): Promise<void> => {
        const controller = new AbortController();
        const reason = new Error('raced cancellation');
        const f = fixture({ signal: controller.signal });
        f.fallback.resolveSrv.mockImplementation(async (): Promise<never> => {
            controller.abort(reason); throw dnsError('ETIMEOUT');
        });
        await expect(resolveSrvForDriver(f.input)).rejects.toBe(reason);
        expect(f.reports[0].outcome).toBe('cancelled');
    });

    it('cancellation wins a raced probe failure', async (): Promise<void> => {
        const controller = new AbortController();
        const reason = new Error('raced probe cancellation');
        const f = fixture({ signal: controller.signal });
        f.probe.resolveSrv.mockImplementation(async (): Promise<never> => {
            controller.abort(reason); throw probeError();
        });
        await expect(resolveSrvForDriver(f.input)).rejects.toBe(reason);
        expect(f.probe.cancel).toHaveBeenCalledTimes(1);
        expect(f.fallback.resolveSrv).not.toHaveBeenCalled();
        expect(f.reports[0].outcome).toBe('cancelled');
    });

    it('preserves framework cancellation objects without a signal', async (): Promise<void> => {
        const reason = Object.assign(new Error('cancelled'), { _isUserCancelledError: true });
        const f = fixture();
        f.fallback.resolveSrv.mockRejectedValue(reason);
        await expect(resolveSrvForDriver(f.input)).rejects.toBe(reason);
        expect(f.reports[0].outcome).toBe('cancelled');
    });

    it.each([undefined, 5000, 40000])('uses one absolute deadline bounded at 20s (%s, R4)', async (deadlineMs): Promise<void> => {
        const f = fixture({ deadlineMs });
        const clock = jest.spyOn(Date, 'now').mockReturnValue(100000);
        try {
            await resolveSrvForDriver(f.input);
            const srvOptions = f.fallback.resolveSrv.mock.calls[0][1];
            const txtOptions = f.fallback.resolveTxt.mock.calls[0][1];
            expect(srvOptions.deadlineAt).toBe(100000 + Math.min(deadlineMs ?? 20000, 20000));
            expect(txtOptions.deadlineAt).toBe(srvOptions.deadlineAt);
            expect(srvOptions.servers).toEqual(['192.168.1.1']);
        } finally { clock.mockRestore(); }
    });

    it('starts both DNS queries before either completes', async (): Promise<void> => {
        const f = fixture();
        const srv = deferred<FallbackSrvResult>();
        const txt = deferred<FallbackDnsResult<string[]>>();
        const started = deferred<void>();
        f.fallback.resolveSrv.mockReturnValue(srv.promise);
        f.fallback.resolveTxt.mockImplementation((): Promise<FallbackDnsResult<string[]>> => {
            expect(f.fallback.resolveSrv).toHaveBeenCalledTimes(1);
            started.resolve(); return txt.promise;
        });
        const result = resolveSrvForDriver(f.input);
        await started.promise;
        srv.resolve(srvReply);
        txt.resolve(txtReply);
        await expect(result).resolves.toMatchObject({ path: 'fallback' });
    });
});
