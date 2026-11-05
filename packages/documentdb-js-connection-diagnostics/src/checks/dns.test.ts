/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as dns } from 'node:dns';
import { describe, expect, it, vi } from 'vitest';

import { createConnectionStringCheck, createDnsCheck, runDiagnostics } from '../index.js';
import { nodeDns } from '../io/nodeDns.js';

import { type FallbackDnsResult } from '@documentdb-js/srv-resolver';
import { type LookupAddress, type LookupAllOptions, type SrvRecord } from 'node:dns';
import { type BuiltInFindingCode, type CheckResult, type DnsIo, type DiagnosticsRun } from '../index.js';

interface LookupAllIo {
    lookup(host: string, options: LookupAllOptions): Promise<LookupAddress[]>;
}

function dnsError(code: string): Error & { code: string } {
    return Object.assign(new Error('private-error-message-with-password'), { code });
}

function dnsIo(overrides: Partial<DnsIo> = {}): DnsIo {
    return {
        lookup: vi.fn(
            async (): Promise<{ address: string; family: 4 | 6 }[]> => [{ address: '203.0.113.4', family: 4 }],
        ),
        resolve4: vi.fn(async (): Promise<string[]> => ['203.0.113.4']),
        resolve6: vi.fn(async (): Promise<string[]> => []),
        resolveCname: vi.fn(async (): Promise<string[]> => []),
        resolveSrv: vi.fn(async (): Promise<SrvRecord[]> => {
            throw new Error('Unexpected SRV query');
        }),
        resolveTxt: vi.fn(async (): Promise<string[][]> => {
            throw new Error('Unexpected TXT query');
        }),
        getServers: vi.fn((): string[] => []),
        resolveSrvFallback: vi.fn(async (): Promise<FallbackDnsResult<SrvRecord>> => {
            throw new Error('Unexpected fallback query');
        }),
        resolveTxtFallback: vi.fn(async (): Promise<FallbackDnsResult<string[]>> => {
            throw new Error('Unexpected fallback query');
        }),
        ...overrides,
    };
}

async function runDns(
    dns: DnsIo,
    connectionString = 'mongodb://a.example:27017',
): Promise<DiagnosticsRun<BuiltInFindingCode>> {
    return runDiagnostics({
        input: { connectionString },
        checks: [createConnectionStringCheck(), createDnsCheck()],
        io: { dns },
    });
}

function dnsResult(run: DiagnosticsRun<BuiltInFindingCode>): CheckResult<BuiltInFindingCode> {
    return run.results[1];
}

function addressIo(address: string, family: 4 | 6): DnsIo {
    return dnsIo({
        lookup: vi.fn(async (): Promise<{ address: string; family: 4 | 6 }[]> => [{ address, family }]),
        resolve4: vi.fn(async (): Promise<string[]> => (family === 4 ? [address] : [])),
        resolve6: vi.fn(async (): Promise<string[]> => (family === 6 ? [address] : [])),
    });
}

describe('per-host DNS check', (): void => {
    it.each(['127.0.0.1', '[::1]'])('skips IP literal %s without I/O', async (host): Promise<void> => {
        const io = dnsIo();
        const result = dnsResult(await runDns(io, `mongodb://${host}:27017`));
        expect(result).toMatchObject({ status: 'skipped', skippedBecause: { reason: 'notApplicable' } });
        expect(io.lookup).not.toHaveBeenCalled();
        expect(io.resolve4).not.toHaveBeenCalled();
        expect(io.resolve6).not.toHaveBeenCalled();
        expect(io.resolveCname).not.toHaveBeenCalled();
    });

    it.each([
        ['ENOTFOUND', 'dns.notFound'],
        ['EAI_AGAIN', 'dns.temporaryFailure'],
    ])('maps OS %s to %s even when c-ares succeeds', async (code, findingCode): Promise<void> => {
        const result = dnsResult(
            await runDns(
                dnsIo({
                    lookup: vi.fn(async (): Promise<[]> => {
                        throw dnsError(code);
                    }),
                }),
            ),
        );
        expect(result).toMatchObject({
            status: 'fail',
            findings: [{ code: findingCode, severity: 'error' }],
            facts: { osErrorCode: code },
        });
        expect(result.findings.some((entry): boolean => entry.code === 'dns.resolversDisagree')).toBe(false);
        expect(JSON.stringify(result)).not.toContain('private-error-message-with-password');
    });

    it('fails other OS errors without inventing a finding', async (): Promise<void> => {
        const result = dnsResult(
            await runDns(
                dnsIo({
                    lookup: vi.fn(async (): Promise<[]> => {
                        throw dnsError('EACCES');
                    }),
                }),
            ),
        );
        expect(result).toMatchObject({ status: 'fail', findings: [], facts: { osErrorCode: 'EACCES' } });
    });

    it('sanitizes non-E codes without storing error text', async (): Promise<void> => {
        const result = dnsResult(
            await runDns(
                dnsIo({
                    lookup: vi.fn(async (): Promise<[]> => {
                        throw dnsError('private-code');
                    }),
                }),
            ),
        );
        expect(result.facts.osErrorCode).toBe('unknown');
        expect(JSON.stringify(result)).not.toContain('private-code');
        expect(JSON.stringify(result)).not.toContain('private-error-message-with-password');
    });

    it('warns when c-ares returns a different address set', async (): Promise<void> => {
        const result = dnsResult(
            await runDns(dnsIo({ resolve4: vi.fn(async (): Promise<string[]> => ['203.0.113.5']) })),
        );
        expect(result).toMatchObject({
            status: 'warning',
            findings: [
                {
                    code: 'dns.resolversDisagree',
                    severity: 'warning',
                    data: { osAddressCount: 1, caresAddressCount: 1 },
                },
            ],
        });
    });

    it('warns on a c-ares failure while retaining successful address-family evidence', async (): Promise<void> => {
        const result = dnsResult(
            await runDns(
                dnsIo({
                    resolve6: vi.fn(async (): Promise<string[]> => {
                        throw dnsError('ESERVFAIL');
                    }),
                }),
            ),
        );
        expect(result).toMatchObject({
            status: 'warning',
            findings: [
                {
                    code: 'dns.resolversDisagree',
                    severity: 'warning',
                    data: { osAddressCount: 1, caresAddressCount: 1, caresErrorCode: 'ESERVFAIL' },
                },
            ],
            facts: {
                caresAddresses: [{ address: '203.0.113.4', family: 4, class: 'public' }],
                caresErrorCode: 'ESERVFAIL',
            },
        });
    });

    it('does not report resolver disagreement when both resolvers fail', async (): Promise<void> => {
        const result = dnsResult(
            await runDns(
                dnsIo({
                    lookup: vi.fn(async (): Promise<[]> => {
                        throw dnsError('ENOTFOUND');
                    }),
                    resolve4: vi.fn(async (): Promise<string[]> => {
                        throw dnsError('ENOTFOUND');
                    }),
                    resolve6: vi.fn(async (): Promise<string[]> => {
                        throw dnsError('ENOTFOUND');
                    }),
                }),
            ),
        );
        expect(result).toMatchObject({
            status: 'fail',
            findings: [{ code: 'dns.notFound' }],
            facts: { caresErrorCode: 'ENOTFOUND' },
        });
    });

    it('passes when both resolvers agree', async (): Promise<void> => {
        const result = dnsResult(await runDns(dnsIo()));
        expect(result).toMatchObject({
            status: 'pass',
            findings: [],
            facts: {
                osAddresses: [{ address: '203.0.113.4', family: 4, class: 'public' }],
                caresAddresses: [{ address: '203.0.113.4', family: 4, class: 'public' }],
                osErrorCode: null,
                caresErrorCode: null,
                cnameChain: [],
                omittedAddressCount: { os: 0, cares: 0 },
            },
        });
    });

    it('compares sets rather than order, duplicates or IPv6 spelling', async (): Promise<void> => {
        const io = dnsIo({
            lookup: vi.fn(
                async (): Promise<{ address: string; family: 4 | 6 }[]> => [
                    { address: '2001:0db8:0:0:0:0:0:1', family: 6 },
                    { address: '203.0.113.4', family: 4 },
                    { address: '203.0.113.4', family: 4 },
                ],
            ),
            resolve6: vi.fn(async (): Promise<string[]> => ['2001:db8::1']),
        });
        expect(dnsResult(await runDns(io))).toMatchObject({ status: 'pass', findings: [] });
    });

    it.each(['ENODATA', 'ENOTFOUND'])(
        'accepts a missing IPv6 family (%s) when IPv4 resolves',
        async (code): Promise<void> => {
            const io = dnsIo({
                resolve6: vi.fn(async (): Promise<string[]> => {
                    throw dnsError(code);
                }),
            });
            expect(dnsResult(await runDns(io))).toMatchObject({ status: 'pass', facts: { caresErrorCode: null } });
        },
    );

    it('starts OS, both address families and the CNAME chain concurrently with one signal', async (): Promise<void> => {
        let release!: () => void;
        const pending = new Promise<void>((resolve): void => {
            release = resolve;
        });
        const io = dnsIo({
            lookup: vi.fn(async (): Promise<{ address: string; family: 4 | 6 }[]> => {
                await pending;
                return [{ address: '203.0.113.4', family: 4 }];
            }),
            resolve4: vi.fn(async (): Promise<string[]> => {
                await pending;
                return ['203.0.113.4'];
            }),
            resolve6: vi.fn(async (): Promise<string[]> => {
                await pending;
                return [];
            }),
            resolveCname: vi.fn(async (): Promise<string[]> => {
                await pending;
                return [];
            }),
        });
        const promise = runDns(io);
        for (let index = 0; index < 40; index++) {
            await Promise.resolve();
        }
        expect(io.lookup).toHaveBeenCalledWith('a.example');
        const signal = vi.mocked(io.resolve4).mock.calls[0][1];
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(io.resolve6).toHaveBeenCalledWith('a.example', signal);
        expect(io.resolveCname).toHaveBeenCalledWith('a.example', signal);
        release();
        expect(dnsResult(await promise).status).toBe('pass');
    });

    it.each([
        { address: '127.23.45.67', family: 4 as const, classification: 'loopback' },
        { address: '::1', family: 6 as const, classification: 'loopback' },
        { address: '10.0.0.4', family: 4 as const, classification: 'private' },
        { address: '172.31.255.255', family: 4 as const, classification: 'private' },
        { address: '192.168.10.1', family: 4 as const, classification: 'private' },
        { address: '100.64.0.1', family: 4 as const, classification: 'private' },
        { address: '100.127.255.255', family: 4 as const, classification: 'private' },
        { address: '100.128.0.1', family: 4 as const, classification: 'public' },
        { address: 'fc00::1', family: 6 as const, classification: 'private' },
        { address: 'fdff::1', family: 6 as const, classification: 'private' },
        { address: '169.254.10.1', family: 4 as const, classification: 'linkLocal' },
        { address: 'fe80::1', family: 6 as const, classification: 'linkLocal' },
        { address: 'febf::1', family: 6 as const, classification: 'linkLocal' },
        { address: 'fec0::1', family: 6 as const, classification: 'public' },
        { address: '::ffff:127.0.0.1', family: 6 as const, classification: 'loopback' },
        { address: '::ffff:a00:4', family: 6 as const, classification: 'private' },
        { address: '::ffff:169.254.1.1', family: 6 as const, classification: 'linkLocal' },
        { address: '::ffff:203.0.113.4', family: 6 as const, classification: 'public' },
    ])('classifies $address as $classification', async ({ address, family, classification }): Promise<void> => {
        const result = dnsResult(await runDns(addressIo(address, family)));
        expect(result.facts.osAddresses).toEqual([{ address, family, class: classification }]);
        expect(result.facts.caresAddresses).toEqual([{ address, family, class: classification }]);
        if (classification === 'loopback') {
            expect(result.findings).toMatchObject([{ code: 'dns.loopback', severity: 'info' }]);
        } else {
            expect(result.findings).toEqual([]);
        }
        expect(result.status).toBe('pass');
    });

    it.each([
        ['10.0.0.4', 'dns.privateEndpoint', 'pass', 'info'],
        ['203.0.113.4', 'dns.privateEndpointPublicAddress', 'pass', 'info'],
    ])(
        'detects an Azure private-link alias resolving to %s',
        async (address, code, status, severity): Promise<void> => {
            const io = addressIo(address, 4);
            io.resolveCname = vi.fn(
                async (host): Promise<string[]> =>
                    host === 'a.example' ? ['x.privatelink.mongocluster.cosmos.azure.com'] : [],
            );
            const result = dnsResult(await runDns(io));
            expect(result).toMatchObject({
                status,
                findings: [{ code, severity }],
                facts: {
                    cnameChain: ['x.privatelink.mongocluster.cosmos.azure.com'],
                },
            });
        },
    );

    it('requires an exact privatelink label', async (): Promise<void> => {
        const io = addressIo('10.0.0.4', 4);
        io.resolveCname = vi.fn(
            async (host): Promise<string[]> => (host === 'a.example' ? ['notprivatelink.example'] : []),
        );
        expect(dnsResult(await runDns(io)).findings).toEqual([]);
    });

    it('does not report an all-public private endpoint when an address is link-local', async (): Promise<void> => {
        const io = addressIo('169.254.1.1', 4);
        io.resolveCname = vi.fn(
            async (host): Promise<string[]> => (host === 'a.example' ? ['a.privatelink.example'] : []),
        );
        expect(dnsResult(await runDns(io)).findings).toEqual([]);
    });

    it('follows at most eight CNAME hops', async (): Promise<void> => {
        let count = 0;
        const io = dnsIo({ resolveCname: vi.fn(async (): Promise<string[]> => [`hop${++count}.example`]) });
        const result = dnsResult(await runDns(io));
        expect(io.resolveCname).toHaveBeenCalledTimes(8);
        expect(result.facts.cnameChain).toEqual(
            Array.from({ length: 8 }, (_, index): string => `hop${index + 1}.example`),
        );
    });

    it('stops CNAME cycles', async (): Promise<void> => {
        const io = dnsIo({
            resolveCname: vi.fn(async (host): Promise<string[]> => [host === 'a.example' ? 'b.example' : 'a.example']),
        });
        expect(dnsResult(await runDns(io)).facts.cnameChain).toEqual(['b.example']);
        expect(io.resolveCname).toHaveBeenCalledTimes(2);
    });

    it.each(['ENODATA', 'ENOTFOUND'])('ends the CNAME chain on %s without a warning', async (code): Promise<void> => {
        const io = dnsIo({
            resolveCname: vi.fn(async (): Promise<string[]> => {
                throw dnsError(code);
            }),
        });
        expect(dnsResult(await runDns(io))).toMatchObject({
            status: 'pass',
            facts: { cnameChain: [], caresErrorCode: null },
        });
    });

    it('retains the partial CNAME chain and warns about other CNAME failures', async (): Promise<void> => {
        const io = dnsIo({
            resolveCname: vi.fn(async (host): Promise<string[]> => {
                if (host === 'a.example') {
                    return ['b.example'];
                }
                throw dnsError('ESERVFAIL');
            }),
        });
        expect(dnsResult(await runDns(io))).toMatchObject({
            status: 'warning',
            facts: { cnameChain: ['b.example'], caresErrorCode: 'ESERVFAIL' },
        });
    });

    it('caps each resolver address list at eight and counts omissions', async (): Promise<void> => {
        const addresses = Array.from({ length: 10 }, (_, index): string => `203.0.113.${index + 1}`);
        const io = dnsIo({
            lookup: vi.fn(
                async (): Promise<{ address: string; family: 4 | 6 }[]> =>
                    addresses.map((address): { address: string; family: 4 | 6 } => ({ address, family: 4 })),
            ),
            resolve4: vi.fn(async (): Promise<string[]> => addresses),
        });
        const result = dnsResult(await runDns(io));
        expect(result.status).toBe('pass');
        expect(result.facts.osAddresses).toHaveLength(8);
        expect(result.facts.caresAddresses).toHaveLength(8);
        expect(result.facts.omittedAddressCount).toEqual({ os: 2, cares: 2 });
    });

    it('uses the complete sets for comparison before capping facts', async (): Promise<void> => {
        const addresses = Array.from({ length: 9 }, (_, index): string => `203.0.113.${index + 1}`);
        const io = dnsIo({
            lookup: vi.fn(
                async (): Promise<{ address: string; family: 4 | 6 }[]> =>
                    addresses.map((address): { address: string; family: 4 | 6 } => ({ address, family: 4 })),
            ),
            resolve4: vi.fn(async (): Promise<string[]> => [...addresses.slice(0, 8), '203.0.113.99']),
        });
        expect(dnsResult(await runDns(io))).toMatchObject({
            status: 'warning',
            findings: [{ code: 'dns.resolversDisagree' }],
        });
    });

    it('produces an ordered result for each URI target including IP skips', async (): Promise<void> => {
        const io = dnsIo();
        const run = await runDns(io, 'mongodb://a.example:27017,10.0.0.1:27017');
        expect(run.results.slice(1)).toMatchObject([
            { checkId: 'dns', target: 'a.example:27017', status: 'pass' },
            {
                checkId: 'dns',
                target: '10.0.0.1:27017',
                status: 'skipped',
                skippedBecause: { reason: 'notApplicable' },
            },
        ]);
        expect(io.lookup).toHaveBeenCalledExactlyOnceWith('a.example');
    });
});

describe('Node DNS adapter without network I/O', (): void => {
    it('uses the OS lookup with all addresses enabled', async (): Promise<void> => {
        const source: LookupAllIo = dns;
        const lookup = vi.spyOn(source, 'lookup').mockResolvedValue([
            { address: '203.0.113.4', family: 4 },
            { address: '2001:db8::1', family: 6 },
        ]);
        try {
            expect(await nodeDns.lookup('a.example')).toEqual([
                { address: '203.0.113.4', family: 4 },
                { address: '2001:db8::1', family: 6 },
            ]);
            expect(lookup).toHaveBeenCalledWith('a.example', { all: true });
        } finally {
            lookup.mockRestore();
        }
    });

    it('gives every c-ares query a fresh resolver and cancels all of them on abort', async (): Promise<void> => {
        const pending = new Promise<never>((): void => {});
        const resolve4 = vi.spyOn(dns.Resolver.prototype, 'resolve4').mockImplementation((): Promise<never> => pending);
        const resolve6 = vi.spyOn(dns.Resolver.prototype, 'resolve6').mockImplementation((): Promise<never> => pending);
        const resolveCname = vi
            .spyOn(dns.Resolver.prototype, 'resolveCname')
            .mockImplementation((): Promise<never> => pending);
        const resolveSrv = vi
            .spyOn(dns.Resolver.prototype, 'resolveSrv')
            .mockImplementation((): Promise<never> => pending);
        const resolveTxt = vi
            .spyOn(dns.Resolver.prototype, 'resolveTxt')
            .mockImplementation((): Promise<never> => pending);
        const cancel = vi.spyOn(dns.Resolver.prototype, 'cancel').mockImplementation((): void => {});
        try {
            const controller = new AbortController();
            void nodeDns.resolve4('a.example', controller.signal);
            void nodeDns.resolve6('a.example', controller.signal);
            void nodeDns.resolveCname('a.example', controller.signal);
            void nodeDns.resolveSrv('_mongodb._tcp.a.example', controller.signal);
            void nodeDns.resolveTxt('a.example', controller.signal);
            const resolvers = [
                resolve4.mock.contexts[0],
                resolve6.mock.contexts[0],
                resolveCname.mock.contexts[0],
                resolveSrv.mock.contexts[0],
                resolveTxt.mock.contexts[0],
            ];
            expect(new Set(resolvers).size).toBe(5);
            controller.abort();
            expect(cancel).toHaveBeenCalledTimes(5);
            expect(new Set(cancel.mock.contexts)).toEqual(new Set(resolvers));
            await expect(nodeDns.resolve4('a.example', controller.signal)).rejects.toMatchObject({
                name: 'AbortError',
            });
            expect(resolve4).toHaveBeenCalledTimes(1);
        } finally {
            resolve4.mockRestore();
            resolve6.mockRestore();
            resolveCname.mockRestore();
            resolveSrv.mockRestore();
            resolveTxt.mockRestore();
            cancel.mockRestore();
        }
    });

    it('detaches the abort handler after a c-ares query settles', async (): Promise<void> => {
        const resolveCname = vi.spyOn(dns.Resolver.prototype, 'resolveCname').mockResolvedValue(['b.example']);
        const cancel = vi.spyOn(dns.Resolver.prototype, 'cancel').mockImplementation((): void => {});
        try {
            const controller = new AbortController();
            expect(await nodeDns.resolveCname('a.example', controller.signal)).toEqual(['b.example']);
            controller.abort();
            expect(cancel).not.toHaveBeenCalled();
        } finally {
            resolveCname.mockRestore();
            cancel.mockRestore();
        }
    });
});
