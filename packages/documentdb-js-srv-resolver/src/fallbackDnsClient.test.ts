/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dnsPacket from 'dns-packet';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import dns from 'node:dns';
import net from 'node:net';

import {
    FallbackDnsError,
    hasCompressedSrvTarget,
    parseDnsServers,
    resolveSrvFallback,
    resolveTxtFallback,
} from './fallbackDnsClient';
import { DnsStubServer } from './test/dnsStubServer';
import { SrvResolutionCancelledError } from './types';

import { type FallbackDnsOptions } from './fallbackDnsClient';
import { type StubRequest } from './test/dnsStubServer';

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

/** Hand-built wire replay: owner points to QNAME; target is a label plus QNAME's global.* suffix. */
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
    const openUdp = new Set<dgram.Socket>();
    const openTcp = new Set<net.Socket>();
    const originalCreateSocket = dgram.createSocket;
    const OriginalSocket = net.Socket;

    beforeEach((): void => {
        jest.spyOn(dgram, 'createSocket').mockImplementation(
            (
                options: dgram.SocketOptions | dgram.SocketType,
                listener?: Parameters<typeof dgram.createSocket>[1],
            ): dgram.Socket => {
                const socket =
                    typeof options === 'string'
                        ? originalCreateSocket(options, listener)
                        : originalCreateSocket(options, listener);
                openUdp.add(socket);
                socket.once('close', (): void => {
                    openUdp.delete(socket);
                });
                return socket;
            },
        );
        jest.spyOn(net, 'Socket').mockImplementation((options?: net.SocketConstructorOpts): net.Socket => {
            const socket = new OriginalSocket(options);
            openTcp.add(socket);
            socket.once('close', (): void => {
                openTcp.delete(socket);
            });
            return socket;
        });
    });

    afterEach(async (): Promise<void> => {
        await Promise.all(stubs.map((stub): Promise<void> => stub.close()));
        stubs.length = 0;
        await new Promise<void>((resolve): void => {
            setImmediate(resolve);
        });
        const udpCount = openUdp.size;
        const liveTcpCount = [...openTcp].filter((socket): boolean => !socket.destroyed).length;
        const tcpClosed = Promise.all(
            [...openTcp].map(
                (socket): Promise<void> =>
                    new Promise<void>((resolve): void => {
                        socket.once('close', (): void => resolve());
                    }),
            ),
        );
        for (const socket of openUdp) {
            socket.close();
        }
        for (const socket of openTcp) {
            socket.destroy();
        }
        await tcpClosed;
        const tcpCount = openTcp.size;
        openUdp.clear();
        openTcp.clear();
        jest.restoreAllMocks();
        expect(udpCount).toBe(0);
        expect(liveTcpCount).toBe(0);
        expect(tcpCount).toBe(0);
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

    it('decodes compressed SRV targets and traces each attempt with the injected prefix', async (): Promise<void> => {
        const server = await stub((request): void => {
            request.send(compressedReply(request.query, ['fc-abc-000', 'fc-abc-001', 'fc-abc-002']));
        });
        const trace = jest.fn<void, [string]>();
        const result = await resolveSrvFallback(
            srvName,
            options([server], {
                logger: { trace },
                logPrefix: '[SrvResolution] test-connection',
            }),
        );
        expect(result.records).toEqual(
            [0, 1, 2].map(
                (index): dns.SrvRecord => ({
                    name: `fc-abc-00${index}.global.mongocluster.cosmos.azure.com`,
                    priority: 0,
                    weight: 100,
                    port: 10260,
                }),
            ),
        );
        expect(result).toMatchObject({
            targetCompressed: true,
            server: server.address,
            transport: 'udp',
            serversTried: 1,
        });
        expect(result.replyBytes).toBeGreaterThan(100);
        expect(result.attempts).toHaveLength(1);
        expect(trace).toHaveBeenCalledTimes(1);
        expect(trace.mock.calls[0][0]).toMatch(
            new RegExp(
                `^\\[SrvResolution\\] test-connection fallback SRV server=${server.address} transport=udp id=0x[0-9a-f]{4} rcode=NOERROR tc=false answers=3 bytes=\\d+ targetCompressed=true durationMs=\\d+$`,
            ),
        );
    });

    it('returns uncompressed targets without a trailing dot and ignores CNAME/additional records', async (): Promise<void> => {
        const server = await stub((request): void => {
            request.send(
                dnsPacket.encode({
                    type: 'response',
                    id: request.query.id,
                    questions: request.query.questions,
                    answers: [{ type: 'CNAME', name: srvName, data: targetName }, srvAnswer(`${targetName}.`)],
                    additionals: [srvAnswer('ignored.example.com')],
                }),
            );
        });
        const result = await resolveSrvFallback(`${srvName}.`, options([server]));
        expect(result.targetCompressed).toBe(false);
        expect(result.records).toEqual([{ name: targetName, port: 10260, priority: 0, weight: 100 }]);
        expect(result.attempts[0].answers).toBe(1);
    });

    it('retries truncated UDP via TCP on the same server and assembles split length/body chunks', async (): Promise<void> => {
        const server = await stub((request): void => {
            if (request.transport === 'udp') {
                request.send(reply(request, [], dnsPacket.TRUNCATED_RESPONSE));
            } else {
                request.send(compressedReply(request.query), true);
            }
        });
        const result = await resolveSrvFallback(srvName, options([server]));
        expect(result).toMatchObject({ transport: 'tcp', targetCompressed: true, serversTried: 1 });
        expect(result.records[0].name).toBe(targetName);
        expect(result.attempts.map((attempt): string => attempt.transport)).toEqual(['udp', 'tcp']);
        expect(result.attempts[0]).toMatchObject({ tc: true, answers: 0 });
        expect(result.attempts[0].errorCode).toBeUndefined();
        expect(server.queries).toHaveLength(2);
        expect(server.queries[1].query.id).toBe(server.queries[0].query.id);
        expect(server.queries[1].query.questions).toEqual(server.queries[0].query.questions);
    });

    it('ignores wrong IDs, questions, QR, classes, types, malformed bytes and source ports', async (): Promise<void> => {
        const rogue = await stub((): void => {});
        const server = await stub((request): void => {
            const response = reply(request);
            const wrongId = Buffer.from(response);
            wrongId.writeUInt16BE(((request.query.id ?? 0) + 1) % 65536, 0);
            request.send(wrongId);
            for (const question of [
                { name: 'wrong.example.com', type: 'SRV' as const, class: 'IN' as const },
                { name: srvName, type: 'TXT' as const, class: 'IN' as const },
                { name: srvName, type: 'SRV' as const, class: 'CH' as const },
            ]) {
                request.send(
                    dnsPacket.encode({
                        type: 'response',
                        id: request.query.id,
                        questions: [question],
                        answers: [srvAnswer('wrong.example.com')],
                    }),
                );
            }
            request.send(
                dnsPacket.encode({
                    type: 'query',
                    id: request.query.id,
                    questions: request.query.questions,
                    answers: [srvAnswer('wrong.example.com')],
                }),
            );
            request.send(Buffer.from([0xff, 0xff, 0xff]));
            const client = [...openUdp].find((socket): boolean => {
                const address = socket.address();
                return (
                    address.port !== Number(server.address.split(':')[1]) &&
                    address.port !== Number(rogue.address.split(':')[1])
                );
            });
            expect(client).toBeDefined();
            const rogueSocket = [...openUdp].find(
                (socket): boolean => socket.address().port === Number(rogue.address.split(':')[1]),
            );
            rogueSocket?.send(reply(request, [srvAnswer('wrong.example.com')]), client?.address().port, '127.0.0.1');
            server.later((): void => {
                request.send(
                    dnsPacket.encode({
                        type: 'response',
                        id: request.query.id,
                        questions: [{ name: srvName.toUpperCase(), type: 'SRV', class: 'IN' }],
                        answers: [srvAnswer()],
                    }),
                );
            }, 10);
        });
        const result = await resolveSrvFallback(srvName, options([server]));
        expect(result.records[0].name).toBe(targetName);
        expect(result.attempts).toHaveLength(1);
    });

    it.each([
        [2, dns.SERVFAIL],
        [5, dns.REFUSED],
        [1, dns.FORMERR],
        [4, dns.NOTIMP],
        [9, dns.BADRESP],
    ])('moves past rcode %i with Node code %s', async (rcode, code): Promise<void> => {
        const first = await stub((request): void => request.send(reply(request, [], rcode)));
        const second = await stub((request): void => request.send(reply(request)));
        const trace = jest.fn<void, [string]>();
        const result = await resolveSrvFallback(srvName, options([first, second], { logger: { trace } }));
        expect(result.serversTried).toBe(2);
        expect(result.server).toBe(second.address);
        expect(result.attempts[0].errorCode).toBe(code);
        expect(trace.mock.calls[0][0]).toContain(`error=${code}`);
        expect(first.queries).toHaveLength(1);
        expect(second.queries).toHaveLength(1);
    });

    it.each([
        ['SRV', 3, dns.NOTFOUND],
        ['SRV', 0, dns.NODATA],
        ['TXT', 3, dns.NOTFOUND],
        ['TXT', 0, dns.NODATA],
    ] as const)('stops on authoritative %s rcode %i (%s)', async (type, rcode, code): Promise<void> => {
        const first = await stub((request): void => request.send(reply(request, [], rcode)));
        const second = await stub((request): void => request.send(reply(request)));
        const hostname = type === 'SRV' ? srvName : 'x.global.mongocluster.cosmos.azure.com';
        const resolve = type === 'SRV' ? resolveSrvFallback : resolveTxtFallback;
        const outcome = resolve(hostname, options([first, second]));
        await expect(outcome).rejects.toBeInstanceOf(FallbackDnsError);
        await expect(outcome).rejects.toMatchObject({
            code,
            syscall: type === 'SRV' ? 'querySrv' : 'queryTxt',
            hostname,
            serversTried: 1,
            message: `${type === 'SRV' ? 'querySrv' : 'queryTxt'} ${code} ${hostname}`,
            attempts: [expect.objectContaining({ server: first.address, errorCode: code })],
        });
        expect(second.queries).toHaveLength(0);
    });

    it('returns the last server failure', async (): Promise<void> => {
        const first = await stub((request): void => request.send(reply(request, [], 2)));
        const second = await stub((request): void => request.send(reply(request, [], 5)));
        await expect(resolveSrvFallback(srvName, options([first, second]))).rejects.toMatchObject({
            code: dns.REFUSED,
            serversTried: 2,
            attempts: [
                expect.objectContaining({ errorCode: dns.SERVFAIL }),
                expect.objectContaining({ errorCode: dns.REFUSED }),
            ],
        });
    });

    it('tries the next server after a silent UDP attempt times out', async (): Promise<void> => {
        const first = await stub((): void => {});
        const second = await stub((request): void => request.send(reply(request)));
        const result = await resolveSrvFallback(srvName, options([first, second], { udpTimeoutMs: 25 }));
        expect(result.serversTried).toBe(2);
        expect(result.attempts[0].errorCode).toBe(dns.TIMEOUT);
        expect(result.records[0].name).toBe(targetName);
    });

    it('maps a UDP send socket error to ECONNREFUSED and continues', async (): Promise<void> => {
        const first = await stub((): void => {});
        const second = await stub((request): void => request.send(reply(request)));
        const send = dgram.Socket.prototype.send;
        jest.spyOn(dgram.Socket.prototype, 'send')
            .mockImplementationOnce(function (this: dgram.Socket): void {
                this.emit('error', Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }));
            })
            .mockImplementation(send);
        const result = await resolveSrvFallback(srvName, options([first, second]));
        expect(result.attempts[0].errorCode).toBe(dns.CONNREFUSED);
        expect(result.serversTried).toBe(2);
    });

    it('moves to the next server after a TCP connect failure', async (): Promise<void> => {
        const first = await stub((request): void => request.send(reply(request, [], dnsPacket.TRUNCATED_RESPONSE)));
        const second = await stub((request): void => request.send(reply(request)));
        const connect = OriginalSocket.prototype.connect;
        jest.spyOn(OriginalSocket.prototype, 'connect')
            .mockImplementationOnce(function (this: net.Socket): net.Socket {
                this.emit('error', Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }));
                return this;
            })
            .mockImplementation(connect);
        const result = await resolveSrvFallback(srvName, options([first, second]));
        expect(result.serversTried).toBe(2);
        expect(result.attempts.map((attempt): string | undefined => attempt.errorCode)).toEqual([
            undefined,
            dns.CONNREFUSED,
            undefined,
        ]);
    });

    it('returns TXT chunks as UTF-8 strings, preserving the per-record chunk lists', async (): Promise<void> => {
        const server = await stub((request): void =>
            request.send(
                reply(request, [
                    { type: 'TXT', name: srvName, data: [Buffer.from('authSource='), Buffer.from('admin')] },
                    { type: 'TXT', name: srvName, data: [Buffer.from('réplicaSet=globaldb')] },
                    srvAnswer(),
                ]),
            ),
        );
        const trace = jest.fn<void, [string]>();
        const result = await resolveTxtFallback(srvName, options([server], { logger: { trace } }));
        expect(result.records).toEqual([['authSource=', 'admin'], ['réplicaSet=globaldb']]);
        expect(result.records.map((chunks): string => chunks.join(''))).toEqual([
            'authSource=admin',
            'réplicaSet=globaldb',
        ]);
        expect(trace.mock.calls[0][0]).toContain('fallback TXT');
        expect(trace.mock.calls[0][0]).not.toContain('targetCompressed');
        expect(trace.mock.calls[0][0]).not.toContain('authSource');
        expect(result).not.toHaveProperty('targetCompressed');
    });

    it('shares one absolute deadline across concurrent SRV/TXT and all sequential servers', async (): Promise<void> => {
        const servers = await Promise.all([0, 1, 2].map((): Promise<DnsStubServer> => stub((): void => {})));
        const started = Date.now();
        const sharedOptions = options(servers, { deadlineAt: started + 300, udpTimeoutMs: 200 });
        const results = await Promise.allSettled([
            resolveSrvFallback(srvName, sharedOptions),
            resolveTxtFallback(srvName, sharedOptions),
        ]);
        const elapsed = Date.now() - started;
        expect(elapsed).toBeGreaterThanOrEqual(280);
        expect(elapsed).toBeLessThan(450);
        for (const result of results) {
            expect(result.status).toBe('rejected');
            if (result.status === 'rejected') {
                const reason: unknown = result.reason;
                expect(reason).toBeInstanceOf(FallbackDnsError);
                expect(reason).toMatchObject({ code: dns.TIMEOUT, serversTried: 2 });
            }
        }
        expect(servers[2].queries).toHaveLength(0);
    });

    it('also bounds a silent TCP retry by the remaining shared deadline', async (): Promise<void> => {
        const first = await stub((request): void => {
            if (request.transport === 'udp') {
                request.send(reply(request, [], dnsPacket.TRUNCATED_RESPONSE));
            }
        });
        const second = await stub((request): void => request.send(reply(request)));
        const start = Date.now();
        await expect(
            resolveSrvFallback(
                srvName,
                options([first, second], {
                    deadlineAt: start + 60,
                    tcpTimeoutMs: 500,
                }),
            ),
        ).rejects.toMatchObject({ code: dns.TIMEOUT, serversTried: 1 });
        expect(Date.now() - start).toBeLessThan(200);
        expect(second.queries).toHaveLength(0);
    });

    it('moves to the next server after the per-attempt TCP timeout without resetting the deadline', async (): Promise<void> => {
        const first = await stub((request): void => {
            if (request.transport === 'udp') {
                request.send(reply(request, [], dnsPacket.TRUNCATED_RESPONSE));
            }
        });
        const second = await stub((request): void => request.send(reply(request)));
        const result = await resolveSrvFallback(srvName, options([first, second], { tcpTimeoutMs: 25 }));
        expect(result).toMatchObject({ server: second.address, transport: 'udp', serversTried: 2 });
        expect(result.attempts.map((attempt): string | undefined => attempt.errorCode)).toEqual([
            undefined,
            dns.TIMEOUT,
            undefined,
        ]);
    });

    it('treats answers of other types and additional-only answers as ENODATA', async (): Promise<void> => {
        const server = await stub((request): void => {
            request.send(
                dnsPacket.encode({
                    type: 'response',
                    id: request.query.id,
                    questions: request.query.questions,
                    answers: [{ type: 'CNAME', name: srvName, data: targetName }],
                    additionals: [srvAnswer(), { type: 'TXT', name: srvName, data: ['ignored'] }],
                }),
            );
        });
        for (const resolve of [resolveSrvFallback, resolveTxtFallback]) {
            await expect(resolve(srvName, options([server]))).rejects.toMatchObject({ code: dns.NODATA });
        }
    });

    it.each(['udp', 'tcp'] as const)(
        'closes %s immediately on abort and preserves an Error reason',
        async (transport): Promise<void> => {
            const controller = new AbortController();
            const reason = new Error('x');
            const first = await stub((request): void => {
                if (transport === 'tcp' && request.transport === 'udp') {
                    request.send(reply(request, [], dnsPacket.TRUNCATED_RESPONSE));
                    return;
                }
                controller.abort(reason);
                first.later((): void => request.send(reply(request)), 5);
            });
            const second = await stub((request): void => request.send(reply(request)));
            const trace = jest.fn<void, [string]>();
            await expect(
                resolveSrvFallback(
                    srvName,
                    options([first, second], {
                        signal: controller.signal,
                        logger: { trace },
                    }),
                ),
            ).rejects.toBe(reason);
            await new Promise<void>((resolve): void => {
                setImmediate(resolve);
            });
            expect(openUdp.size).toBe(2);
            expect([...openTcp].every((socket): boolean => socket.destroyed)).toBe(true);
            expect(second.queries).toHaveLength(0);
            expect(trace.mock.calls.at(-1)?.[0]).toContain('cancelled=true');
            expect(trace.mock.calls.at(-1)?.[0]).not.toContain('error=');
        },
    );

    it('uses SrvResolutionCancelledError for a non-Error cancellation reason', async (): Promise<void> => {
        const controller = new AbortController();
        const server = await stub((): void => {
            controller.abort('cancelled');
        });
        await expect(
            resolveTxtFallback(
                srvName,
                options([server], {
                    signal: controller.signal,
                }),
            ),
        ).rejects.toBeInstanceOf(SrvResolutionCancelledError);
    });

    it('uses SrvResolutionCancelledError for a default abort reason in the Jest realm', async (): Promise<void> => {
        const controller = new AbortController();
        const server = await stub((): void => {
            controller.abort();
        });
        const outcome = resolveSrvFallback(srvName, options([server], { signal: controller.signal }));
        await expect(outcome).rejects.toBeInstanceOf(SrvResolutionCancelledError);
        await new Promise<void>((resolve): void => {
            setImmediate(resolve);
        });
        expect(openUdp.size).toBe(1);
    });

    it('rejects a pre-aborted caller with its exact reason before opening any socket', async (): Promise<void> => {
        const controller = new AbortController();
        const reason = new Error('already cancelled');
        controller.abort(reason);
        await expect(
            resolveSrvFallback(srvName, {
                deadlineAt: Date.now() + 100,
                servers: [],
                signal: controller.signal,
            }),
        ).rejects.toBe(reason);
        expect(openUdp.size).toBe(0);
    });

    it('fails without opening a socket when the deadline has already expired', async (): Promise<void> => {
        await expect(
            resolveSrvFallback(srvName, {
                deadlineAt: Date.now() - 1,
                servers: ['127.0.0.1:5353'],
            }),
        ).rejects.toMatchObject({ code: dns.TIMEOUT, serversTried: 0, attempts: [] });
        expect(openUdp.size).toBe(0);
    });

    it('fails with ECONNREFUSED for an empty server list', async (): Promise<void> => {
        await expect(
            resolveSrvFallback(srvName, {
                deadlineAt: Date.now() + 100,
                servers: [],
            }),
        ).rejects.toMatchObject({ code: dns.CONNREFUSED, serversTried: 0, attempts: [] });
    });

    it('skips invalid system server entries, traces each skip and queries the next valid server', async (): Promise<void> => {
        const server = await stub((request): void => request.send(reply(request)));
        const invalidEntries = ['not-an-address', '[::1]:invalid'];
        jest.spyOn(dns, 'getServers').mockReturnValue([invalidEntries[0], server.address, invalidEntries[1]]);
        const trace = jest.fn<void, [string]>();
        const result = await resolveSrvFallback(srvName, {
            deadlineAt: Date.now() + 500,
            logger: { trace },
            logPrefix: '[SrvResolution] mixed-servers',
        });
        expect(result).toMatchObject({ server: server.address, serversTried: 1 });
        expect(result.records[0].name).toBe(targetName);
        expect(result.attempts).toHaveLength(1);
        expect(server.queries).toHaveLength(1);
        expect(trace.mock.calls.slice(0, 2)).toEqual([
            ['[SrvResolution] mixed-servers fallback skipping unparseable DNS server entry'],
            ['[SrvResolution] mixed-servers fallback skipping unparseable DNS server entry'],
        ]);
        expect(trace).toHaveBeenCalledTimes(3);
        for (const entry of invalidEntries) {
            expect(trace.mock.calls.flat().join('\n')).not.toContain(entry);
        }
    });

    it.each(['SRV', 'TXT'] as const)(
        'fails %s with ECONNREFUSED when every server entry is invalid',
        async (type): Promise<void> => {
            const trace = jest.fn<void, [string]>();
            const resolve = type === 'SRV' ? resolveSrvFallback : resolveTxtFallback;
            await expect(
                resolve(srvName, {
                    deadlineAt: Date.now() + 500,
                    servers: ['not-an-address', '127.0.0.1:65536'],
                    logger: { trace },
                }),
            ).rejects.toMatchObject({ code: dns.CONNREFUSED, serversTried: 0, attempts: [] });
            expect(trace.mock.calls).toEqual([
                ['[SrvResolution] fallback skipping unparseable DNS server entry'],
                ['[SrvResolution] fallback skipping unparseable DNS server entry'],
            ]);
            expect(openUdp.size).toBe(0);
            expect(openTcp.size).toBe(0);
        },
    );

    it('uses only system servers by default, RD=1, one IN question, no OPT and random 16-bit IDs', async (): Promise<void> => {
        const server = await stub((request): void => request.send(reply(request)));
        const getServers = jest.spyOn(dns, 'getServers').mockReturnValue([server.address]);
        const randomInt = jest.spyOn(crypto, 'randomInt');
        for (let i = 0; i < 6; i++) {
            await resolveSrvFallback(srvName, { deadlineAt: Date.now() + 500 });
        }
        expect(getServers).toHaveBeenCalledTimes(6);
        expect(randomInt).toHaveBeenCalledWith(0, 65536);
        expect(new Set(server.queries.map((request): number | undefined => request.query.id)).size).toBeGreaterThan(1);
        for (const { query } of server.queries) {
            expect(query.flag_rd).toBe(true);
            expect(query.flag_qr).toBe(false);
            expect(query.questions).toEqual([{ name: srvName, type: 'SRV', class: 'IN' }]);
            expect(query.additionals).toEqual([]);
            expect(query.authorities).toEqual([]);
            expect(query.answers).toEqual([]);
        }
    });

    it('rejects a malformed TCP frame as EBADRESP', async (): Promise<void> => {
        const server = await stub((request): void => {
            request.send(
                request.transport === 'udp' ? reply(request, [], dnsPacket.TRUNCATED_RESPONSE) : Buffer.from([0xff]),
            );
        });
        await expect(resolveSrvFallback(srvName, options([server]))).rejects.toMatchObject({
            code: dns.BADRESP,
            attempts: [
                expect.objectContaining({ transport: 'udp', tc: true }),
                expect.objectContaining({ transport: 'tcp', errorCode: dns.BADRESP }),
            ],
        });
    });
});

describe('DNS server parsing', (): void => {
    it('supports IPv4, bare IPv6 and bracketed IPv6 ports', (): void => {
        expect(parseDnsServers(['[::1]:5353', '::1', '2001:db8::1', '1.2.3.4:5353', '1.2.3.4'])).toEqual([
            { host: '::1', port: 5353, family: 6, display: '[::1]:5353' },
            { host: '::1', port: 53, family: 6, display: '[::1]:53' },
            { host: '2001:db8::1', port: 53, family: 6, display: '[2001:db8::1]:53' },
            { host: '1.2.3.4', port: 5353, family: 4, display: '1.2.3.4:5353' },
            { host: '1.2.3.4', port: 53, family: 4, display: '1.2.3.4:53' },
        ]);
    });

    it.each(['example.com', '127.0.0.1:0', '127.0.0.1:65536', '[::1]:-1', '[::1', '127.0.0.1:nope'])(
        'skips invalid server %s instead of invoking hostname resolution',
        (server): void => {
            expect(parseDnsServers([server])).toEqual([]);
        },
    );

    it('preserves valid server order while skipping invalid entries', (): void => {
        expect(parseDnsServers(['bad-entry', '1.2.3.4:5353', '[::1', '::1'])).toEqual([
            { host: '1.2.3.4', port: 5353, family: 4, display: '1.2.3.4:5353' },
            { host: '::1', port: 53, family: 6, display: '[::1]:53' },
        ]);
    });

    it('preserves IPv6 interface-name and numeric zone IDs accepted by net.isIP', (): void => {
        expect(parseDnsServers(['fe80::1%eth0', '[fe80::1%2]:53'])).toEqual([
            { host: 'fe80::1%eth0', port: 53, family: 6, display: '[fe80::1%eth0]:53' },
            { host: 'fe80::1%2', port: 53, family: 6, display: '[fe80::1%2]:53' },
        ]);
    });
});

describe('raw SRV compression probe', (): void => {
    const query: dnsPacket.Packet = {
        type: 'query',
        id: 0x1a2b,
        questions: [{ name: srvName, type: 'SRV', class: 'IN' }],
    };

    it('detects a compressed target in any SRV answer', (): void => {
        const compressed = compressedReply(query, ['fc-abc-000', 'fc-abc-001']);
        expect(hasCompressedSrvTarget(new Uint8Array(compressed))).toBe(true);
        expect(
            hasCompressedSrvTarget(
                dnsPacket.encode({
                    ...query,
                    type: 'response',
                    answers: [srvAnswer()],
                }),
            ),
        ).toBe(false);
    });

    it('does not confuse compressed owner names with compressed targets', (): void => {
        const compressed = compressedReply(query);
        const uncompressed = dnsPacket.encode({ ...query, type: 'response', answers: [srvAnswer()] });
        const questionLength = dnsPacket.encode({ ...query, type: 'response', answers: [] }).length;
        const ownerLength = questionLength - 12 - 4;
        expect(
            hasCompressedSrvTarget(
                Buffer.concat([
                    uncompressed.subarray(0, questionLength),
                    compressed.subarray(questionLength, questionLength + 2),
                    uncompressed.subarray(questionLength + ownerLength),
                ]),
            ),
        ).toBe(false);
    });

    it('returns false for truncated replies, invalid label bits, pointers, lengths and cycles', (): void => {
        const valid = compressedReply(query);
        for (let length = 0; length < valid.length; length++) {
            expect(hasCompressedSrvTarget(valid.subarray(0, length))).toBe(false);
        }
        for (const mutation of [
            (bytes: Buffer): void => {
                bytes.writeUInt16BE(0xffff, bytes.length - 2);
            },
            (bytes: Buffer): void => {
                bytes.writeUInt16BE(0xc000 | (bytes.length - 2), bytes.length - 2);
            },
            (bytes: Buffer): void => {
                bytes[12] = 0x80;
            },
            (bytes: Buffer): void => {
                bytes[12] = 0x3f;
            },
            (bytes: Buffer): void => {
                bytes.writeUInt16BE(65535, 6);
            },
        ]) {
            const bytes = Buffer.from(valid);
            mutation(bytes);
            expect(hasCompressedSrvTarget(bytes)).toBe(false);
        }
    });
});
