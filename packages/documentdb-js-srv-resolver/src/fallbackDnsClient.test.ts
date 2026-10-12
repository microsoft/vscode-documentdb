/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dnsPacket from 'dns-packet';
import dgram from 'node:dgram';
import dns from 'node:dns';

import { FallbackDnsError, resolveSrvFallback, resolveTxtFallback } from './fallbackDnsClient.js';
import { DnsStubServer } from './test/dnsStubServer.js';

import { type FallbackDnsOptions } from './fallbackDnsClient.js';
import { type StubRequest } from './test/dnsStubServer.js';

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

    afterEach(async (): Promise<void> => {
        await Promise.all(stubs.map((stub): Promise<void> => stub.close()));
        stubs.length = 0;
        jest.restoreAllMocks();
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
        const trace = jest.fn<void, [string]>();
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

    it('ignores replies that do not match the query or come from another source', async (): Promise<void> => {
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
            server.later((): void => request.send(reply(request)), 10);
        });
        const result = await resolveSrvFallback(srvName, options([server]));
        expect(result.records.map((record): string => record.name)).toEqual([targetName]);
    });

    it('retries a truncated UDP reply over TCP and assembles split frames', async (): Promise<void> => {
        const server = await stub((request): void => {
            if (request.transport === 'udp') {
                request.send(reply(request, [], dnsPacket.TRUNCATED_RESPONSE));
            } else {
                request.send(compressedReply(request.query), true);
            }
        });
        const result = await resolveSrvFallback(srvName, options([server]));
        expect(result).toMatchObject({ transport: 'tcp', serversTried: 1 });
        expect(result.records[0].name).toBe(targetName);
        expect(server.queries.map((request): string => request.transport)).toEqual(['udp', 'tcp']);
    });

    it.each([
        [2, dns.SERVFAIL],
        [5, dns.REFUSED],
    ])('moves to the next server after rcode %i', async (rcode, code): Promise<void> => {
        const first = await stub((request): void => request.send(reply(request, [], rcode)));
        const second = await stub((request): void => request.send(reply(request)));
        const trace = jest.fn<void, [string]>();
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
        const first = await stub((): void => {});
        const second = await stub((request): void => request.send(reply(request)));
        const result = await resolveSrvFallback(srvName, options([first, second], { udpTimeoutMs: 25 }));
        expect(result.serversTried).toBe(2);
    });

    it('retries a server once after a UDP timeout', async (): Promise<void> => {
        const server = await stub((request): void => {
            if (server.queries.length === 2) {
                request.send(reply(request));
            }
        });
        const result = await resolveSrvFallback(srvName, options([server], { udpTimeoutMs: 25 }));

        expect(result.serversTried).toBe(1);
        expect(server.queries).toHaveLength(2);
        expect(server.queries[0].query.id).not.toBe(server.queries[1].query.id);
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
        const servers = await Promise.all([0, 1, 2].map((): Promise<DnsStubServer> => stub((): void => {})));
        const started = Date.now();
        await expect(
            resolveSrvFallback(srvName, options(servers, { deadlineAt: started + 300, udpTimeoutMs: 200 })),
        ).rejects.toMatchObject({ code: dns.TIMEOUT, serversTried: 2 });
        expect(Date.now() - started).toBeLessThan(450);
        expect(servers[2].queries).toHaveLength(0);
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
        jest.spyOn(dns, 'getServers').mockReturnValue(['not-an-address', server.address, '127.0.0.1:65536']);
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

    it('fails fast when a UDP server refuses the query', async (): Promise<void> => {
        const port = await new Promise<number>((resolve, reject): void => {
            const socket = dgram.createSocket('udp4');
            socket.once('error', reject);
            socket.bind(0, '127.0.0.1', (): void => {
                const address = socket.address();
                socket.close((): void => resolve(address.port));
            });
        });
        const started = Date.now();
        const outcome = resolveSrvFallback(srvName, {
            servers: [`127.0.0.1:${port}`],
            deadlineAt: started + 3000,
            udpTimeoutMs: 2000,
        });

        await expect(outcome).rejects.toMatchObject({ code: dns.CONNREFUSED, serversTried: 1 });
        expect(Date.now() - started).toBeLessThan(1000);
    });
});
