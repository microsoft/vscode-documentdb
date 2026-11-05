/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';

import { createConnectionStringCheck, createSrvCheck, runDiagnostics } from '../index.js';

import { type FallbackDnsOptions, type FallbackDnsResult, type SrvFallbackMode } from '@documentdb-js/srv-resolver';
import { type SrvRecord } from 'node:dns';
import {
    type BuiltInFindingCode,
    type Check,
    type CheckOutcome,
    type CheckResult,
    type DnsIo,
    type RunContext,
    type DiagnosticsRun,
} from '../index.js';

const records: SrvRecord[] = [
    { name: 'b.example.test', port: 27018, priority: 1, weight: 5 },
    { name: 'a.example.test', port: 27017, priority: 0, weight: 10 },
];

function dnsError(code: string): Error & { code: string } {
    return Object.assign(new Error('private-error-message-with-password'), { code });
}

function fallback<T>(values: T[]): FallbackDnsResult<T> {
    return { records: values, server: '192.0.2.53', transport: 'udp', serversTried: 1 };
}

function dnsIo(overrides: Partial<DnsIo> = {}): DnsIo {
    return {
        lookup: vi.fn(async (): Promise<[]> => []),
        resolve4: vi.fn(async (): Promise<string[]> => []),
        resolve6: vi.fn(async (): Promise<string[]> => []),
        resolveCname: vi.fn(async (): Promise<string[]> => []),
        resolveSrv: vi.fn(async (): Promise<SrvRecord[]> => records),
        resolveTxt: vi.fn(async (): Promise<string[][]> => []),
        getServers: vi.fn((): string[] => ['192.0.2.53']),
        resolveSrvFallback: vi.fn(async (): Promise<FallbackDnsResult<SrvRecord>> => fallback(records)),
        resolveTxtFallback: vi.fn(async (): Promise<FallbackDnsResult<string[]>> => fallback([])),
        ...overrides,
    };
}

async function runSrv(
    dns: DnsIo,
    srvFallbackMode?: SrvFallbackMode,
    connectionString = 'mongodb+srv://cluster.example.test/',
): Promise<DiagnosticsRun<BuiltInFindingCode>> {
    return runDiagnostics({
        input: { connectionString, srvFallbackMode },
        checks: [createConnectionStringCheck(), createSrvCheck()],
        io: { dns },
    });
}

function srvResult(run: DiagnosticsRun<BuiltInFindingCode>): CheckResult<BuiltInFindingCode> {
    return run.results[1];
}

describe('SRV/TXT check', (): void => {
    it('does not resolve a non-SRV connection', async (): Promise<void> => {
        const io = dnsIo();
        const result = srvResult(await runSrv(io, undefined, 'mongodb://a.example.test'));
        expect(result).toMatchObject({ status: 'skipped', skippedBecause: { reason: 'notApplicable' } });
        expect(io.resolveSrv).not.toHaveBeenCalled();
        expect(io.getServers).not.toHaveBeenCalled();
    });

    it('keeps target order and merges accepted TXT options with explicit URI precedence', async (): Promise<void> => {
        const io = dnsIo({
            resolveTxt: vi.fn(
                async (): Promise<string[][]> => [['authSource=dns-auth&replica', 'Set=dns-set&loadBalanced=true']],
            ),
        });
        const run = await runSrv(
            io,
            undefined,
            'mongodb+srv://user:private-password@cluster.example.test/?authSource=uri-auth',
        );
        expect(run.targets).toEqual([
            { host: 'b.example.test', port: 27018, source: 'srv' },
            { host: 'a.example.test', port: 27017, source: 'srv' },
        ]);
        const result = srvResult(run);
        expect(result).toMatchObject({
            status: 'pass',
            findings: [],
            facts: {
                srvQueryName: '_mongodb._tcp.cluster.example.test',
                resolutionPath: 'node',
                nodeErrorCode: null,
                fallbackOutcome: 'notAttempted',
                records,
                txtApplied: ['replicaSet', 'loadBalanced'],
                tlsImplied: true,
                txtOptions: [
                    { name: 'authSource', value: 'dns-auth' },
                    { name: 'replicaSet', value: 'dns-set' },
                    { name: 'loadBalanced', value: 'true' },
                ],
            },
        });
        expect(io.resolveSrv).toHaveBeenCalledWith('_mongodb._tcp.cluster.example.test', expect.any(AbortSignal));
        expect(io.resolveTxt).toHaveBeenCalledWith('cluster.example.test', expect.any(AbortSignal));
        expect(io.resolveSrvFallback).not.toHaveBeenCalled();
        expect(JSON.stringify(result)).not.toContain('private-password');
        expect(JSON.stringify(result)).not.toContain('mongodb+srv://');
    });

    it.each(['ENOTFOUND', 'ENODATA'])('maps Node %s to srv.notFound', async (code): Promise<void> => {
        const io = dnsIo({
            resolveSrv: vi.fn(async (): Promise<SrvRecord[]> => {
                throw dnsError(code);
            }),
        });
        const result = srvResult(await runSrv(io));
        expect(result).toMatchObject({
            status: 'fail',
            findings: [{ code: 'srv.notFound', severity: 'error' }],
            facts: { nodeErrorCode: code },
        });
        expect(io.resolveSrvFallback).not.toHaveBeenCalled();
    });

    it.each(['EBADRESP', 'EFORMERR', 'ECONNREFUSED'])(
        'recovers eligible Node %s with auto fallback',
        async (code): Promise<void> => {
            const io = dnsIo({
                resolveSrv: vi.fn(async (): Promise<SrvRecord[]> => {
                    throw dnsError(code);
                }),
            });
            const run = await runSrv(io);
            const result = srvResult(run);
            expect(result).toMatchObject({
                status: 'pass',
                findings: [
                    {
                        code: 'srv.compressedReplyRejected',
                        severity: 'info',
                        data: { nodeErrorCode: code, fallbackOutcome: 'succeeded' },
                    },
                ],
                facts: { resolutionPath: 'fallback', fallbackOutcome: 'succeeded', fallbackTransport: 'udp' },
            });
            expect(run.targets).toHaveLength(2);
            expect(io.resolveSrvFallback).toHaveBeenCalledWith(
                '_mongodb._tcp.cluster.example.test',
                expect.objectContaining({ servers: ['192.0.2.53'] }),
            );
            const srvOptions = vi.mocked(io.resolveSrvFallback).mock.calls[0][1];
            const txtOptions = vi.mocked(io.resolveTxtFallback).mock.calls[0][1];
            expect(txtOptions).toBe(srvOptions);
            expect(srvOptions.signal).toBe(vi.mocked(io.resolveSrv).mock.calls[0][1]);
        },
    );

    it('reports the disabled fallback as an error without calling it', async (): Promise<void> => {
        const io = dnsIo({
            resolveSrv: vi.fn(async (): Promise<SrvRecord[]> => {
                throw dnsError('EBADRESP');
            }),
        });
        const result = srvResult(await runSrv(io, 'off'));
        expect(result).toMatchObject({
            status: 'fail',
            findings: [
                {
                    code: 'srv.compressedReplyRejected',
                    severity: 'error',
                    data: { nodeErrorCode: 'EBADRESP', fallbackOutcome: 'disabled' },
                },
            ],
        });
        expect(io.resolveSrvFallback).not.toHaveBeenCalled();
        expect(io.resolveTxtFallback).not.toHaveBeenCalled();
    });

    it('reports a failed fallback and sanitizes its error code', async (): Promise<void> => {
        const io = dnsIo({
            resolveSrv: vi.fn(async (): Promise<SrvRecord[]> => {
                throw dnsError('EBADRESP');
            }),
            resolveSrvFallback: vi.fn(async (): Promise<FallbackDnsResult<SrvRecord>> => {
                throw dnsError('private-code');
            }),
        });
        const result = srvResult(await runSrv(io));
        expect(result).toMatchObject({
            status: 'fail',
            findings: [
                {
                    code: 'srv.compressedReplyRejected',
                    severity: 'error',
                    data: { nodeErrorCode: 'EBADRESP', fallbackOutcome: 'failed' },
                },
            ],
            facts: { fallbackErrorCode: 'unknown', fallbackOutcome: 'failed' },
        });
        expect(JSON.stringify(result)).not.toContain('private-error-message-with-password');
        expect(JSON.stringify(result)).not.toContain('private-code');
    });

    it('maps fallback ENOTFOUND to srv.notFound', async (): Promise<void> => {
        const result = srvResult(
            await runSrv(
                dnsIo({
                    resolveSrvFallback: vi.fn(async (): Promise<FallbackDnsResult<SrvRecord>> => {
                        throw dnsError('ENOTFOUND');
                    }),
                }),
                'force',
            ),
        );
        expect(result).toMatchObject({ status: 'fail', findings: [{ code: 'srv.notFound', severity: 'error' }] });
    });

    it('force uses fallback even after a successful Node probe', async (): Promise<void> => {
        const io = dnsIo({
            resolveSrvFallback: vi.fn(async (): Promise<FallbackDnsResult<SrvRecord>> => fallback([records[1]])),
        });
        const run = await runSrv(io, 'force');
        expect(io.resolveSrv).toHaveBeenCalledOnce();
        expect(io.resolveSrvFallback).toHaveBeenCalledOnce();
        expect(io.resolveTxtFallback).toHaveBeenCalledOnce();
        expect(run.targets).toEqual([{ host: 'a.example.test', port: 27017, source: 'srv' }]);
        expect(srvResult(run)).toMatchObject({
            status: 'pass',
            findings: [],
            facts: { resolutionPath: 'fallback', nodeErrorCode: null },
        });
    });

    it.each([
        { srvRecords: [], txt: [], code: 'srv.notFound' },
        { srvRecords: [{ ...records[0], name: 'outside.other.test' }], txt: [], code: 'srv.targetOutsideDomain' },
        { srvRecords: records, txt: [['unsupportedOption=private-txt-value']], code: 'srv.txtUnsupportedOption' },
        { srvRecords: records, txt: [['authSource=first'], ['replicaSet=second']], code: 'srv.txtUnsupportedOption' },
    ])('maps rewrite validation to $code', async ({ srvRecords, txt, code }): Promise<void> => {
        const run = await runSrv(
            dnsIo({
                resolveSrv: vi.fn(async (): Promise<SrvRecord[]> => srvRecords),
                resolveTxt: vi.fn(async (): Promise<string[][]> => txt),
            }),
        );
        const result = srvResult(run);
        expect(result).toMatchObject({ status: 'fail', findings: [{ code, severity: 'error' }] });
        expect(run.targets).toEqual([]);
        expect(JSON.stringify(result)).not.toContain('private-txt-value');
    });

    it('does not copy arbitrary Node error codes or error messages into the result', async (): Promise<void> => {
        const result = srvResult(
            await runSrv(
                dnsIo({
                    resolveSrv: vi.fn(async (): Promise<SrvRecord[]> => {
                        throw dnsError('sensitive-code');
                    }),
                }),
            ),
        );
        expect(result).toMatchObject({ status: 'fail', findings: [], facts: { nodeErrorCode: 'unknown' } });
        expect(JSON.stringify(result)).not.toContain('sensitive-code');
        expect(JSON.stringify(result)).not.toContain('private-error-message-with-password');
    });

    it('caps record and DNS-server facts at 32 with omitted counts', async (): Promise<void> => {
        const many = Array.from(
            { length: 40 },
            (_, index): SrvRecord => ({ ...records[0], name: `host${index}.example.test` }),
        );
        const result = srvResult(
            await runSrv(
                dnsIo({
                    resolveSrv: vi.fn(async (): Promise<SrvRecord[]> => many),
                    getServers: vi.fn((): string[] =>
                        Array.from({ length: 40 }, (_, index): string => `192.0.2.${index + 1}`),
                    ),
                }),
            ),
        );
        expect(result.facts.records).toEqual(many.slice(0, 32));
        expect(result.facts.dnsServers).toHaveLength(32);
        expect(result.facts).toMatchObject({ omittedRecordCount: 8, omittedDnsServerCount: 8 });
    });

    it.each(['node', 'fallback'])('treats missing TXT records on %s as no options', async (path): Promise<void> => {
        const io = dnsIo({
            resolveTxt: vi.fn(async (): Promise<string[][]> => {
                throw dnsError('ENODATA');
            }),
            resolveTxtFallback: vi.fn(async (): Promise<FallbackDnsResult<string[]>> => {
                throw dnsError('ENOTFOUND');
            }),
        });
        expect(srvResult(await runSrv(io, path === 'fallback' ? 'force' : 'off'))).toMatchObject({
            status: 'pass',
            facts: { txtOptions: [], txtApplied: [] },
        });
    });

    it('fails unsupported TXT resolution errors without leaking their messages', async (): Promise<void> => {
        const result = srvResult(
            await runSrv(
                dnsIo({
                    resolveTxt: vi.fn(async (): Promise<string[][]> => {
                        throw dnsError('ESERVFAIL');
                    }),
                }),
            ),
        );
        expect(result.status).toBe('fail');
        expect(JSON.stringify(result)).not.toContain('private-error-message-with-password');
    });

    it('records an invalid rewrite without duplicating connection-string findings', async (): Promise<void> => {
        const prerequisite: Check<RunContext, BuiltInFindingCode> = {
            id: 'connectionString',
            scope: 'run',
            run: async (): Promise<CheckOutcome<BuiltInFindingCode>> => ({ status: 'pass', findings: [], facts: {} }),
        };
        const run = await runDiagnostics({
            input: { connectionString: 'mongodb+srv://' },
            checks: [prerequisite, createSrvCheck()],
            io: { dns: dnsIo() },
        });
        expect(srvResult(run)).toMatchObject({ status: 'fail', findings: [], facts: { rewriteError: 'invalidUri' } });
    });

    it.each([null, 100])(
        'uses the effective check deadline (%s) for both fallback queries',
        async (timeoutMs): Promise<void> => {
            vi.useFakeTimers();
            vi.setSystemTime(1000);
            try {
                const io = dnsIo();
                const run = await runDiagnostics({
                    input: { connectionString: 'mongodb+srv://cluster.example.test', srvFallbackMode: 'force' },
                    checks: [createConnectionStringCheck(), createSrvCheck()],
                    timeouts: { runTimeoutMs: null, srvTimeoutMs: timeoutMs },
                    io: { dns: io },
                });
                expect(srvResult(run).status).toBe('pass');
                const options: FallbackDnsOptions = vi.mocked(io.resolveSrvFallback).mock.calls[0][1];
                expect(options.deadlineAt).toBe(timeoutMs === null ? Infinity : 1100);
            } finally {
                vi.useRealTimers();
            }
        },
    );

    it('times out a never-resolving DNS fake through the runner', async (): Promise<void> => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        try {
            const io = dnsIo({ resolveSrv: vi.fn((): Promise<SrvRecord[]> => new Promise((): void => {})) });
            const promise = runDiagnostics({
                input: { connectionString: 'mongodb+srv://cluster.example.test' },
                checks: [createConnectionStringCheck(), createSrvCheck()],
                timeouts: { srvTimeoutMs: 25 },
                io: { dns: io },
            });
            await vi.advanceTimersByTimeAsync(25);
            expect(srvResult(await promise)).toMatchObject({ status: 'fail', findings: [{ code: 'check.timeout' }] });
            expect(vi.mocked(io.resolveSrv).mock.calls[0][1].aborted).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});
