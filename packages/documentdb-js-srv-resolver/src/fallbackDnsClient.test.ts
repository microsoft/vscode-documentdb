/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as dnsPacket from 'dns-packet';
import dgram from 'node:dgram';
import dns from 'node:dns';
import net from 'node:net';

import { FallbackDnsError, resolveSrvFallback, resolveTxtFallback } from './fallbackDnsClient.js';
import { DnsStubServer } from './test/dnsStubServer.js';

import { type FallbackDnsOptions } from './fallbackDnsClient.js';
import { type StubRequest } from './test/dnsStubServer.js';

// ESM namespaces are read-only; one shared object lets `vi.spyOn(dns, ...)` reach the source's `import * as dns`.
vi.mock('node:dns', async (importOriginal) => {
    const shared: Record<string, unknown> = { ...(await importOriginal<Record<string, unknown>>()) };
    shared.default = shared;
    return shared;
});

const srvName = '_mongodb._tcp.x.global.mongocluster.cosmos.azure.com';
const targetName = 'fc-abc-000.global.mongocluster.cosmos.azure.com';

function srvAnswer(target = targetName): dnsPacket.SrvAnswer {
    return {
        type: 'SRV',
        name: srvName,
        class: 'IN',
        ttl: 60,
        data: { target, port: 10260, priority: 0, weight: 100 },
    };
}

function reply(request: StubRequest, answers: dnsPacket.Answer[] = [srvAnswer()], flags = 0): Buffer {
    return dnsPacket.encode({
        type: 'response',
        id: request.query.id,
        flags,
        questions: request.query.questions,
        answers,
    });
}

/** Hand-built reply whose SRV target is compressed into the question name, as home routers send it. */
function compressedReply(query: dnsPacket.Packet, targets = ['fc-abc-000']): Buffer {
    const question = dnsPacket.encode({ ...query, type: 'response', answers: [], flags: 0 });
    question.writeUInt16BE(targets.length, 6);
    const suffixOffset = 12 + 1 + '_mongodb'.length + 1 + '_tcp'.length + 1 + 'x'.length;
    const answers = targets.map((target): Buffer => {
        const label = Buffer.from(target);
        const answer = Buffer.alloc(12 + 6 + 1 + label.length + 2);
        answer.writeUInt16BE(0xc00c, 0);
        answer.writeUInt16BE(33, 2);
        answer.writeUInt16BE(1, 4);
        answer.writeUInt32BE(60, 6);
        answer.writeUInt16BE(6 + 1 + label.length + 2, 10);
        answer.writeUInt16BE(0, 12);
        answer.writeUInt16BE(100, 14);
        answer.writeUInt16BE(10260, 16);
        answer[18] = label.length;
        label.copy(answer, 19);
        answer.writeUInt16BE(0xc000 | suffixOffset, 19 + label.length);
        return answer;
    });
    return Buffer.concat([question, ...answers]);
}

describe('fallback DNS client', (): void => {
    const stubs: DnsStubServer[] = [];

    beforeEach((): void => {
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
        vi.spyOn(dns, 'getServers').mockImplementation((): string[] => {
            throw new Error('Tests must explicitly supply loopback DNS servers');
        });
    });

    afterEach(async (): Promise<void> => {
        try {
            await Promise.all(stubs.map((stub): Promise<void> => stub.close()));
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            stubs.length = 0;
            vi.restoreAllMocks();
            vi.useRealTimers();
        }
    });

    async function stub(handler: (request: StubRequest) => void): Promise<DnsStubServer> {
        const server = await DnsStubServer.start(handler);
        stubs.push(server);
        return server;
    }

    function options(servers: DnsStubServer[], overrides: Partial<FallbackDnsOptions> = {}): FallbackDnsOptions {
        return {
            servers: servers.map((server): string => server.address),
            deadlineAt: Date.now() + 1500,
            udpTimeoutMs: 100,
            tcpTimeoutMs: 150,
            ...overrides,
        };
    }

    it('decodes compressed SRV targets and traces the attempt', async (): Promise<void> => {
        const server = await stub((request): void => {
            request.send(compressedReply(request.query, ['fc-abc-000', 'fc-abc-001']));
        });
        const trace = vi.fn<(...args: [string]) => void>();
        const result = await resolveSrvFallback(srvName, options([server], { logger: { trace }, logPrefix: '[p]' }));
        expect(result).toEqual({
            records: [0, 1].map(
                (index): dns.SrvRecord => ({
                    name: `fc-abc-00${index}.global.mongocluster.cosmos.azure.com`,
                    priority: 0,
                    weight: 100,
                    port: 10260,
                }),
            ),
            server: server.address,
            transport: 'udp',
            serversTried: 1,
        });
        expect(trace.mock.calls[0][0]).toMatch(
            new RegExp(`^\\[p\\] fallback SRV server=${server.address} transport=udp id=0x[0-9a-f]{4} rcode=NOERROR`),
        );
    });

    it('ignores malformed replies and replies that do not match the query', async (): Promise<void> => {
        const server = await stub((request): void => {
            const wrongId = reply(request);
            wrongId.writeUInt16BE(((request.query.id ?? 0) + 1) % 65536, 0);
            request.send(wrongId);
            request.send(
                dnsPacket.encode({
                    type: 'response',
                    id: request.query.id,
                    questions: [{ name: 'wrong.example.com', type: 'SRV', class: 'IN' }],
                    answers: [srvAnswer('wrong.example.com')],
                }),
            );
            request.send(Buffer.from([0xff, 0xff, 0xff]));
            request.send(reply(request));
        });
        const result = await resolveSrvFallback(srvName, options([server]));
        expect(result.records.map((record): string => record.name)).toEqual([targetName]);
    });

    it('retries a truncated UDP reply over TCP and assembles split frames', async (): Promise<void> => {
        const server = await stub((request): void => {
            if (request.transport === 'udp') {
                request.send(reply(request, [], dnsPacket.TRUNCATED_RESPONSE));
            } else {
                request.send(compressedReply(request.query));
            }
        });
        const emit: (this: net.Socket, event: string | symbol, ...args: unknown[]) => boolean =
            net.Socket.prototype.emit;
        let fragments = 0;
        // TCP can coalesce writes, so split the client's data events rather than timing server writes.
        vi.spyOn(net.Socket.prototype, 'emit').mockImplementation(function (
            this: net.Socket,
            event: string | symbol,
            ...args: unknown[]
        ): boolean {
            if (event === 'data' && `127.0.0.1:${this.remotePort}` === server.address && Buffer.isBuffer(args[0])) {
                const bytes = args[0];
                for (let offset = 0; offset < bytes.length; offset++) {
                    fragments++;
                    emit.call(this, event, bytes.subarray(offset, offset + 1));
                }
                return true;
            }
            return emit.call(this, event, ...args) === true;
        });
        const result = await resolveSrvFallback(srvName, options([server]));
        expect(result).toMatchObject({ transport: 'tcp', serversTried: 1 });
        expect(result.records[0].name).toBe(targetName);
        expect(server.queries.map((request): string => request.transport)).toEqual(['udp', 'tcp']);
        expect(fragments).toBeGreaterThan(2);
    });

    it.each([
        [2, dns.SERVFAIL],
        [5, dns.REFUSED],
    ])('moves to the next server after rcode %i', async (rcode, code): Promise<void> => {
        const first = await stub((request): void => request.send(reply(request, [], rcode)));
        const second = await stub((request): void => request.send(reply(request)));
        const trace = vi.fn<(...args: [string]) => void>();
        const result = await resolveSrvFallback(srvName, options([first, second], { logger: { trace } }));
        expect(result).toMatchObject({ server: second.address, serversTried: 2 });
        expect(trace.mock.calls[0][0]).toContain(`error=${code}`);
    });

    it.each([
        [3, dns.NOTFOUND],
        [0, dns.NODATA],
    ])('stops on authoritative rcode %i', async (rcode, code): Promise<void> => {
        const first = await stub((request): void => request.send(reply(request, [], rcode)));
        const second = await stub((request): void => request.send(reply(request)));
        await expect(resolveSrvFallback(srvName, options([first, second]))).rejects.toMatchObject({
            code,
            syscall: 'querySrv',
            serversTried: 1,
        });
        expect(second.queries).toHaveLength(0);
    });

    it('tries the next server after a silent server times out', async (): Promise<void> => {
        const first = await stub((): void => {
            vi.advanceTimersByTime(25);
        });
        const second = await stub((request): void => request.send(reply(request)));
        const result = await resolveSrvFallback(srvName, options([first, second], { udpTimeoutMs: 25 }));
        expect(result.serversTried).toBe(2);
    });

    it('retries a server once after a UDP timeout', async (): Promise<void> => {
        const server = await stub((request): void => {
            if (server.queries.length === 1) {
                vi.advanceTimersByTime(25);
                return;
            }
            request.send(reply(request));
        });
        const result = await resolveSrvFallback(srvName, options([server], { udpTimeoutMs: 25 }));

        expect(result.serversTried).toBe(1);
        expect(server.queries).toHaveLength(2);
    });

    it('does not retry a server after SERVFAIL', async (): Promise<void> => {
        const server = await stub((request): void => request.send(reply(request, [], 2)));

        await expect(resolveSrvFallback(srvName, options([server]))).rejects.toMatchObject({ code: dns.SERVFAIL });
        expect(server.queries).toHaveLength(1);
    });

    it('returns TXT chunks as UTF-8 strings per record', async (): Promise<void> => {
        const server = await stub((request): void =>
            request.send(
                reply(request, [
                    { type: 'TXT', name: srvName, data: [Buffer.from('authSource='), Buffer.from('admin')] },
                    srvAnswer(),
                ]),
            ),
        );
        const result = await resolveTxtFallback(srvName, options([server]));
        expect(result.records).toEqual([['authSource=', 'admin']]);
    });

    it('bounds all servers by one shared deadline', async (): Promise<void> => {
        const first = await stub((): void => {
            vi.advanceTimersByTime(200);
        });
        const second = await stub((): void => {
            vi.advanceTimersByTime(100);
        });
        const third = await stub((): void => {});
        const servers = [first, second, third];
        const started = Date.now();
        await expect(
            resolveSrvFallback(srvName, options(servers, { deadlineAt: started + 300, udpTimeoutMs: 200 })),
        ).rejects.toMatchObject({ code: dns.TIMEOUT, serversTried: 2 });
        expect(Date.now() - started).toBe(300);
        expect(first.queries).toHaveLength(1);
        expect(second.queries).toHaveLength(1);
        expect(third.queries).toHaveLength(0);
    });

    it('rejects with the abort reason and does not try further servers', async (): Promise<void> => {
        const controller = new AbortController();
        const reason = new Error('cancelled');
        const first = await stub((): void => controller.abort(reason));
        const second = await stub((request): void => request.send(reply(request)));
        await expect(resolveSrvFallback(srvName, options([first, second], { signal: controller.signal }))).rejects.toBe(
            reason,
        );
        expect(second.queries).toHaveLength(0);
    });

    it('uses the system servers by default and skips unparseable entries', async (): Promise<void> => {
        const server = await stub((request): void => request.send(reply(request)));
        vi.spyOn(dns, 'getServers').mockReturnValue(['not-an-address', server.address, '127.0.0.1:65536']);
        const result = await resolveSrvFallback(srvName, { deadlineAt: Date.now() + 500 });
        expect(result).toMatchObject({ server: server.address, serversTried: 1 });
        const [{ query }] = server.queries;
        expect(query.flag_rd).toBe(true);
        expect(query.questions).toEqual([{ name: srvName, type: 'SRV', class: 'IN' }]);
    });

    it('fails with ECONNREFUSED when there is no usable server', async (): Promise<void> => {
        const outcome = resolveTxtFallback(srvName, { deadlineAt: Date.now() + 100, servers: ['bad'] });
        await expect(outcome).rejects.toBeInstanceOf(FallbackDnsError);
        await expect(outcome).rejects.toMatchObject({ code: dns.CONNREFUSED, syscall: 'queryTxt', serversTried: 0 });
    });

    it.each(['ECONNREFUSED', 'ECONNRESET'])('fails fast when a UDP socket reports %s', async (code): Promise<void> => {
        const connect = vi.spyOn(dgram.Socket.prototype, 'connect');
        const close = vi.spyOn(dgram.Socket.prototype, 'close');
        // Closed-port ICMP errors are not reliably delivered on every OS or restricted runner.
        const send = vi.spyOn(dgram.Socket.prototype, 'send').mockImplementation(function (this: dgram.Socket): void {
            queueMicrotask((): void => {
                this.emit('error', Object.assign(new Error(code), { code }));
            });
        });
        const outcome = resolveSrvFallback(srvName, {
            servers: ['127.0.0.1:53'],
            deadlineAt: Date.now() + 3000,
            udpTimeoutMs: 2000,
        });

        await expect(outcome).rejects.toMatchObject({ code: dns.CONNREFUSED, serversTried: 1 });
        expect(connect).toHaveBeenCalledExactlyOnceWith(53, '127.0.0.1', expect.any(Function));
        expect(send).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});
