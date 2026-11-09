/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as net from 'node:net';
import { Duplex } from 'node:stream';
import * as tls from 'node:tls';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBuiltInChecks, createHelloCheck, runDiagnostics, SAFETY_LIMITS } from '../index.js';
import { nodeNet } from '../io/nodeNet.js';
import { createCertificate } from '../test/certificates.js';
import { replyFrame, wireResponder, writeReply } from '../test/wireResponder.js';

import {
    type BuiltInFindingCode,
    type CheckOutcome,
    type DiagnosticsClock,
    type DiagnosticsInput,
    type DnsIo,
    type NetIo,
    type NetworkOptions,
    type RunContext,
} from '../index.js';
import { type WireRequest } from '../test/wireResponder.js';

type Respond = (request: WireRequest, socket: Duplex) => void;
const sockets: Duplex[] = [];
const servers: net.Server[] = [];
const clock: DiagnosticsClock = {
    now: (): number => Date.now(),
    setTimeout: (callback, ms): unknown => setTimeout(callback, ms),
    clearTimeout: (handle): void => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
};

interface ProbeOptions {
    readonly port?: number;
    readonly input?: DiagnosticsInput;
    readonly network?: NetworkOptions;
    readonly net?: NetIo;
    readonly clock?: DiagnosticsClock;
    readonly timeout?: number | null;
    readonly readFile?: (path: string) => Promise<Uint8Array>;
    readonly connectedAddress?: { readonly address: string; readonly family: 4 | 6 };
}

function context(options: ProbeOptions = {}): RunContext {
    const target = { host: 'db.test', port: options.port ?? 27017, source: 'uri' as const };
    return {
        runId: 'hello-test',
        target,
        targets: [target],
        input: {
            connectionString: 'mongodb://db.test:27017',
            ...options.input,
            ...(options.network ? { networkOptionLayers: [{ origin: 'setting', options: options.network }] } : {}),
        },
        io: { clock: options.clock ?? clock, net: options.net, readFile: options.readFile },
        setTargets: (): void => {},
        addCleanup: (): void => {},
        effectiveTimeout: (): { timeoutMs: number | null; source: 'check' } => ({
            timeoutMs: options.timeout === undefined ? 1000 : options.timeout,
            source: 'check',
        }),
        getResult: (id): ReturnType<RunContext['getResult']> =>
            id === 'tcp'
                ? {
                      checkId: 'tcp',
                      status: 'pass',
                      durationMs: 0,
                      findings: [],
                      facts: { connectedAddress: options.connectedAddress ?? { address: '127.0.0.1', family: 4 } },
                  }
                : undefined,
    };
}

function runHello(
    options: ProbeOptions = {},
    signal = new AbortController().signal,
): Promise<CheckOutcome<BuiltInFindingCode>> {
    return createHelloCheck().run(context(options), signal);
}

function fakeResponder(respond: Respond): { io: NetIo; requests: WireRequest[] } {
    const requests: WireRequest[] = [];
    const io: NetIo = {
        connect: async (): Promise<net.Socket> => {
            const client = new Duplex({
                read(): void {},
                write(chunk: Buffer, _encoding, callback): void {
                    server.push(chunk);
                    callback();
                },
            });
            const server = new Duplex({
                read(): void {},
                write(chunk: Buffer, _encoding, callback): void {
                    client.push(chunk);
                    callback();
                },
                final(callback): void {
                    client.push(null);
                    callback();
                },
            });
            sockets.push(client, server);
            wireResponder(server, respond, requests);
            return client as unknown as net.Socket;
        },
        connectTls: async (): Promise<never> => {
            throw new Error('Unexpected TLS connection');
        },
    };
    return { io, requests };
}

async function responder(
    respond: Respond,
    certificate?: { cert: string; key: string },
): Promise<{ port: number; requests: WireRequest[] }> {
    const requests: WireRequest[] = [];
    const onConnection = (socket: net.Socket): void => {
        wireResponder(socket, respond, requests);
    };
    const server = certificate ? tls.createServer(certificate, onConnection) : net.createServer(onConnection);
    servers.push(server);
    server.on('connection', (socket): void => {
        sockets.push(socket);
        socket.on('error', (): void => {});
    });
    if (server instanceof tls.Server) {
        server.on('secureConnection', (socket): void => {
            sockets.push(socket);
        });
        server.on('tlsClientError', (): void => {});
    }
    await new Promise<void>((resolve, reject): void => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', (): void => {
            server.removeListener('error', reject);
            resolve();
        });
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Expected loopback address');
    }
    return { port: address.port, requests };
}

function respondWith(document: Record<string, unknown>, opcode: 1 | 2013 = 1): Respond {
    return (request, socket): void => {
        socket.write(replyFrame(request.requestId, document, opcode));
    };
}

async function probe(
    document: Record<string, unknown>,
    options: Omit<ProbeOptions, 'net'> = {},
): Promise<CheckOutcome<BuiltInFindingCode>> {
    return runHello({ ...options, net: fakeResponder(respondWith(document)).io });
}

afterEach(async (): Promise<void> => {
    sockets.splice(0).forEach((socket): void => {
        socket.destroy();
    });
    await Promise.all(
        servers.splice(0).map(async (server): Promise<void> => {
            if (server.listening) {
                await new Promise<void>((resolve): void => {
                    server.close((): void => resolve());
                });
            }
        }),
    );
    vi.useRealTimers();
});

describe('unauthenticated MongoDB API handshake', (): void => {
    it('sends the legacy OP_QUERY handshake and allowlists replica set facts', async (): Promise<void> => {
        const document = {
            ok: 1,
            ismaster: true,
            setName: 'rs0',
            hosts: ['db.test:27017'],
            passives: ['passive:27017'],
            arbiters: ['arbiter:27017'],
            me: 'db.test:27017',
            primary: 'db.test:27017',
            minWireVersion: 0,
            maxWireVersion: 25,
            maxBsonObjectSize: 16777216,
            readOnly: false,
            secretField: 'private-reply-value',
            unexpected: { nested: 'nested-secret' },
        };
        const { port, requests } = await responder(respondWith(document));
        const result = await runHello({ port });
        expect(result).toMatchObject({
            status: 'pass',
            findings: [],
            facts: {
                handshake: 'opQuery',
                topology: 'replicaSet',
                isWritablePrimary: true,
                setName: 'rs0',
                hosts: ['db.test:27017', 'passive:27017', 'arbiter:27017'],
                omittedHostCount: 0,
                me: 'db.test:27017',
                primary: 'db.test:27017',
                minWireVersion: 0,
                maxWireVersion: 25,
                maxBsonObjectSize: 16777216,
                readOnly: false,
                compressorsOffered: [],
                compressorsAccepted: null,
                roundTripMs: expect.any(Number) as unknown,
                serverTime: null,
                clockOffsetMs: null,
                clockUncertaintyMs: null,
            },
        });
        expect(requests[0]).toMatchObject({
            opcode: 2004,
            flags: 0,
            namespace: 'admin.$cmd',
            numberToSkip: 0,
            numberToReturn: -1,
            document: { isMaster: 1, helloOk: true, compression: [] },
        });
        expect(requests[0].requestId).toBeGreaterThan(0);
        expect(requests[0].requestId).toBeLessThan(0x80000000);
        expect(Object.keys(requests[0].document)).toEqual(['isMaster', 'helloOk', 'compression']);
        for (const secret of ['secretField', 'private-reply-value', 'unexpected', 'nested-secret']) {
            expect(JSON.stringify(result)).not.toContain(secret);
        }
    });

    it.each([{ loadBalanced: true }, { serverApiVersion: '1' }])(
        'uses OP_MSG for %j',
        async (network): Promise<void> => {
            const { io, requests } = fakeResponder(respondWith({ ok: 1, serviceId: 'not-exposed' }, 2013));
            const result = await runHello({ net: io, network });
            expect(result).toMatchObject({ status: 'pass', facts: { handshake: 'opMsg', topology: 'loadBalanced' } });
            expect(requests[0]).toMatchObject({
                opcode: 2013,
                flags: 0,
                kind: 0,
                document: {
                    hello: 1,
                    $db: 'admin',
                    compression: [],
                    ...('loadBalanced' in network ? { loadBalanced: true } : {}),
                },
            });
            expect(requests[0].document).not.toHaveProperty('isMaster');
            expect(JSON.stringify(result)).not.toContain('not-exposed');
        },
    );

    it.each([
        ['mongodb://user%40name:password@db.test/db?compressors=snappy,zlib', undefined, 'db.user@name'],
        [
            'mongodb://user:password@db.test/db?authSource=uriSource&compressors=snappy,zlib',
            { authSource: 'effective' },
            'effective.user',
        ],
        ['mongodb://user:password@db.test?compressors=snappy,zlib', undefined, 'admin.user'],
        ['mongodb://db.test?compressors=snappy,zlib', undefined, undefined],
    ] as const)(
        'offers compression and only the known user for %s',
        async (connectionString, network, mechs): Promise<void> => {
            const { io, requests } = fakeResponder(respondWith({ ok: 1 }));
            const result = await runHello({ net: io, input: { connectionString }, network });
            expect(requests[0].document.compression).toEqual(['snappy', 'zlib']);
            if (mechs) {
                expect(requests[0].document.saslSupportedMechs).toBe(mechs);
            } else {
                expect(requests[0].document).not.toHaveProperty('saslSupportedMechs');
            }
            expect(requests[0].document).not.toHaveProperty('speculativeAuthenticate');
            expect(JSON.stringify(requests)).not.toContain('password');
            expect(JSON.stringify(result)).not.toContain('user@name');
        },
    );

    it('uses the effective compressor order from option layers', async (): Promise<void> => {
        const { io, requests } = fakeResponder(respondWith({ ok: 1 }));
        await runHello({
            net: io,
            input: { connectionString: 'mongodb://db.test?compressors=snappy,zlib' },
            network: { compressors: ['zlib', 'snappy'] },
        });
        expect(requests[0].document.compression).toEqual(['zlib', 'snappy']);
    });

    it.each([1, 2013] as const)('accepts one-byte fragmented opcode %s replies', async (opcode): Promise<void> => {
        const { port } = await responder((request, socket): void => {
            void writeReply(socket, replyFrame(request.requestId, { ok: 1, isWritablePrimary: true }, opcode), {
                fragment: true,
            });
        });
        expect(await runHello({ port })).toMatchObject({ status: 'pass', facts: { isWritablePrimary: true } });
    });

    it('accepts a coalesced frame and ignores bytes beyond it', async (): Promise<void> => {
        const { port } = await responder((request, socket): void => {
            void writeReply(socket, replyFrame(request.requestId, { ok: 1 }), {
                trailing: Buffer.from('HTTP/1.1 trailing bytes'),
            });
        });
        expect(await runHello({ port })).toMatchObject({ status: 'pass', findings: [] });
    });

    it('accepts OP_MSG with a checksum trailer', async (): Promise<void> => {
        const { io } = fakeResponder((request, socket): void => {
            socket.write(replyFrame(request.requestId, { ok: 1 }, 2013, true));
        });
        expect(await runHello({ net: io })).toMatchObject({ status: 'pass' });
    });

    it.each(['responseTo', 'opCode', 'truncated', 'malformed', 'tooLarge'] as const)(
        'rejects %s before accepting a reply',
        async (reason): Promise<void> => {
            const { io } = fakeResponder((request, socket): void => {
                const frame = replyFrame(request.requestId, { ok: 1 });
                switch (reason) {
                    case 'responseTo':
                        frame.writeInt32LE(0, 8);
                        break;
                    case 'opCode':
                        frame.writeInt32LE(999, 12);
                        break;
                    case 'truncated':
                        frame.writeInt32LE(frame.length, 36);
                        break;
                    case 'malformed':
                        frame[40] = 255;
                        break;
                    case 'tooLarge':
                        frame.writeInt32LE(SAFETY_LIMITS.maxWireReplyBytes + 1, 0);
                        break;
                }
                // No body is sent for oversized frames: header validation must finish immediately.
                socket.write(reason === 'tooLarge' ? frame.subarray(0, 16) : frame);
            });
            expect(await runHello({ net: io })).toMatchObject({
                status: 'fail',
                findings: [{ code: 'hello.inconclusive', data: { reason } }],
            });
            expect(sockets[0].destroyed).toBe(true);
        },
    );

    it.each([1, 2013] as const)('rejects extra documents or sections in opcode %s', async (opcode): Promise<void> => {
        const { io } = fakeResponder((request, socket): void => {
            const first = replyFrame(request.requestId, { ok: 1 }, opcode);
            const second = replyFrame(request.requestId, { ok: 1 }, opcode).subarray(opcode === 1 ? 36 : 20);
            const combined = Buffer.concat([first, second]);
            combined.writeInt32LE(combined.length, 0);
            socket.write(combined);
        });
        expect(await runHello({ net: io })).toMatchObject({
            status: 'fail',
            findings: [{ code: 'hello.inconclusive', data: { reason: 'malformed' } }],
        });
    });

    it.each([1, 2013] as const)(
        'rejects an opcode %s header too short for its minimal body',
        async (opcode): Promise<void> => {
            const { io } = fakeResponder((request, socket): void => {
                const header = replyFrame(request.requestId, { ok: 1 }, opcode).subarray(0, 16);
                header.writeInt32LE(opcode === 1 ? 40 : 25, 0);
                socket.write(header);
            });
            expect(await runHello({ net: io })).toMatchObject({
                findings: [{ code: 'hello.inconclusive', data: { reason: 'truncated' } }],
            });
        },
    );

    it.each([1, 2013] as const)('rejects malformed BSON in opcode %s', async (opcode): Promise<void> => {
        const { io } = fakeResponder((request, socket): void => {
            const frame = replyFrame(request.requestId, { ok: 1 }, opcode);
            frame[frame.length - 1] = 1;
            socket.write(frame);
        });
        expect(await runHello({ net: io })).toMatchObject({
            findings: [{ code: 'hello.inconclusive', data: { reason: 'malformed' } }],
        });
    });

    it('rejects an OP_REPLY claiming more than one document', async (): Promise<void> => {
        const { io } = fakeResponder((request, socket): void => {
            const frame = replyFrame(request.requestId, { ok: 1 });
            frame.writeInt32LE(2, 32);
            socket.write(frame);
        });
        expect(await runHello({ net: io })).toMatchObject({
            findings: [{ code: 'hello.inconclusive', data: { reason: 'malformed' } }],
        });
    });

    it.each([Buffer.from('HTTP/1.1 400'), Buffer.from([15, 0, 0, 0]), Buffer.from([1, 0, 0, 4])])(
        'rejects non-wire prefix %j',
        async (bytes): Promise<void> => {
            expect(
                await runHello({
                    net: fakeResponder((_request, socket): void => {
                        socket.end(bytes);
                    }).io,
                }),
            ).toMatchObject({
                status: 'fail',
                findings: [{ code: 'hello.notWireProtocol' }],
            });
        },
    );

    it.each([false, true])(
        'reports close before a complete reply (partial=%s) and suggests TLS',
        async (partial): Promise<void> => {
            const { port } = await responder((request, socket): void => {
                socket.end(partial ? replyFrame(request.requestId, { ok: 1 }).subarray(0, 20) : undefined);
            });
            const result = await runHello({ port });
            expect(result).toMatchObject({
                status: 'fail',
                findings: [{ code: 'hello.closedWithoutReply', data: { tls: false } }],
            });
            expect(result.findings[0].detail.text).toContain('probably requires TLS');
        },
    );

    it.each([1000, 200])(
        'uses the internal reply deadline for a %s ms effective timeout',
        async (timeout): Promise<void> => {
            vi.useFakeTimers();
            const { io } = fakeResponder((): void => {});
            const pending = runHello({ net: io, timeout });
            const waitedMs = Math.max(1, timeout - 250);
            await vi.advanceTimersByTimeAsync(waitedMs - 1);
            expect(sockets[0].destroyed).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            expect(await pending).toMatchObject({
                status: 'fail',
                findings: [{ code: 'hello.noReply', data: { waitedMs } }],
            });
            expect(sockets[0].destroyed).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it.each([
        { address: '127.0.0.1', family: 4 as const, addressClass: 'loopback' },
        { address: '0:0:0:0:0:0:0:1', family: 6 as const, addressClass: 'loopback' },
        { address: '::ffff:127.0.0.1', family: 6 as const, addressClass: 'loopback' },
        { address: '203.0.113.4', family: 4 as const, addressClass: 'public' },
        { address: '10.0.0.4', family: 4 as const, addressClass: 'private' },
        { address: 'fe80::1', family: 6 as const, addressClass: 'linkLocal' },
        { address: 'unknown', family: 4 as const, addressClass: undefined },
    ])('classifies no reply from connected address $address, not the host label', async ({ address, family, addressClass }): Promise<void> => {
        vi.useFakeTimers();
        const pending = runHello({
            connectedAddress: { address, family },
            net: fakeResponder((): void => {}).io,
        });
        await vi.advanceTimersByTimeAsync(750);
        const result = await pending;
        expect(result.findings[0]).toMatchObject({ code: 'hello.noReply', data: { waitedMs: 750 } });
        if (addressClass === undefined) {
            expect(result.findings[0].data).not.toHaveProperty('addressClass');
        } else {
            expect(result.findings[0].data?.addressClass).toBe(addressClass);
        }
        if (addressClass === 'loopback') {
            expect(result.findings[0].detail.text).toContain('local database, container or tunnel');
            expect(result.findings[0].detail.text).not.toMatch(/firewall|allowlist|VPN|server/i);
        }
    });

    it('measures the deadline from check start, including connection time', async (): Promise<void> => {
        vi.useFakeTimers();
        const { io } = fakeResponder((): void => {});
        const delayed: NetIo = {
            ...io,
            connect: async (options): Promise<net.Socket> => {
                await new Promise<void>((resolve): void => {
                    setTimeout(resolve, 500);
                });
                return io.connect(options);
            },
        };
        const pending = runHello({ net: delayed });
        await vi.advanceTimersByTimeAsync(750);
        expect(await pending).toMatchObject({ findings: [{ code: 'hello.noReply', data: { waitedMs: 750 } }] });
    });

    it('classifies a partial reply still pending at the internal deadline as truncated', async (): Promise<void> => {
        vi.useFakeTimers();
        const pending = runHello({
            net: fakeResponder((request, socket): void => {
                socket.write(replyFrame(request.requestId, { ok: 1 }).subarray(0, 20));
            }).io,
        });
        await vi.advanceTimersByTimeAsync(750);
        expect(await pending).toMatchObject({
            findings: [{ code: 'hello.inconclusive', data: { reason: 'truncated' } }],
        });
    });

    it('keeps the default probe pending at five seconds and reports no reply at 9750 ms', async (): Promise<void> => {
        vi.useFakeTimers();
        let settled = false;
        const pending = runHello({ net: fakeResponder((): void => {}).io, timeout: 10000 });
        void pending.then((): void => {
            settled = true;
        });
        await vi.advanceTimersByTimeAsync(5000);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(4749);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(await pending).toMatchObject({ findings: [{ code: 'hello.noReply', data: { waitedMs: 9750 } }] });
    });

    it('cancels without waiting for injected connection I/O and destroys its late socket', async (): Promise<void> => {
        vi.useFakeTimers();
        let complete: ((socket: net.Socket) => void) | undefined;
        const io: NetIo = {
            ...nodeNet,
            connect: (): Promise<net.Socket> =>
                new Promise((resolve): void => {
                    complete = resolve;
                }),
        };
        const controller = new AbortController();
        const pending = runHello({ net: io }, controller.signal);
        const reason = new Error('cancel');
        const rejected = expect(pending).rejects.toBe(reason);
        controller.abort(reason);
        await rejected;
        expect(vi.getTimerCount()).toBe(0);
        const late = new net.Socket();
        complete?.(late);
        await vi.advanceTimersByTimeAsync(0);
        expect(late.destroyed).toBe(true);
    });

    it('does not install an internal deadline with a null timeout, and cleans up on cancellation', async (): Promise<void> => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const pending = runHello({ net: fakeResponder((): void => {}).io, timeout: null }, controller.signal);
        const error = new Error('cancel');
        const rejected = expect(pending).rejects.toBe(error);
        await vi.advanceTimersByTimeAsync(20000);
        expect(vi.getTimerCount()).toBe(0);
        expect(sockets[0].destroyed).toBe(false);
        controller.abort(error);
        await rejected;
        expect(sockets[0].destroyed).toBe(true);
    });

    it.each([
        { ok: 0, code: 13, codeName: 'Unauthorized', errmsg: 'secret-command-error' },
        { ok: 0, code: 13, codeName: 'Invalid-name-secret' },
    ])('allowlists command failure codes from %j', async (document): Promise<void> => {
        const result = await probe(document);
        expect(result).toMatchObject({
            status: 'fail',
            findings: [
                {
                    code: 'hello.inconclusive',
                    data: {
                        reason: 'commandFailed',
                        code: 13,
                        ...(document.codeName === 'Unauthorized' ? { codeName: 'Unauthorized' } : {}),
                    },
                },
            ],
        });
        if (document.codeName !== 'Unauthorized') {
            expect(result.findings[0].data).not.toHaveProperty('codeName');
        }
        expect(JSON.stringify(result)).not.toContain('secret');
    });

    it('returns connection error codes without duplicating TCP/TLS findings or error text', async (): Promise<void> => {
        const io: NetIo = {
            ...nodeNet,
            connect: async (): Promise<never> => {
                throw Object.assign(new Error('secret error'), { code: 'ECONNREFUSED' });
            },
        };
        expect(await runHello({ net: io })).toEqual({
            status: 'fail',
            findings: [],
            facts: { connectErrorCode: 'ECONNREFUSED' },
        });
    });

    it('destroys a socket whose injected connection completes after the internal deadline', async (): Promise<void> => {
        vi.useFakeTimers();
        let complete: ((socket: net.Socket) => void) | undefined;
        const io: NetIo = {
            ...nodeNet,
            connect: (): Promise<net.Socket> =>
                new Promise((resolve): void => {
                    complete = resolve;
                }),
        };
        const pending = runHello({ net: io });
        await vi.advanceTimersByTimeAsync(750);
        expect(await pending).toMatchObject({ findings: [{ code: 'hello.noReply' }] });
        const late = new net.Socket();
        complete?.(late);
        await vi.advanceTimersByTimeAsync(0);
        expect(late.destroyed).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('handshake facts and evidence', (): void => {
    it('classifies a DocumentDB gateway without compression negotiation', async (): Promise<void> => {
        const result = await probe(
            {
                ok: 1,
                msg: 'isdbgrid',
                isWritablePrimary: true,
                internal: { documentdb_versions: ['0.107.0'], secret: 'private-value' },
            },
            {
                input: { connectionString: 'mongodb://db.test?compressors=snappy' },
            },
        );
        expect(result).toMatchObject({
            status: 'pass',
            findings: [],
            facts: {
                topology: 'documentdbGateway',
                documentdbVersions: ['0.107.0'],
                compressorsOffered: ['snappy'],
                compressorsAccepted: null,
            },
        });
        expect(JSON.stringify(result)).not.toContain('private-value');
    });

    it.each([
        [{ msg: 'isdbgrid' }, 'shardedRouter'],
        [{ serviceId: 'service' }, 'loadBalanced'],
        [{ setName: 'rs' }, 'replicaSet'],
        [{}, 'standalone'],
    ] as const)('classifies topology %j as %s', async (document, topology): Promise<void> => {
        expect(await probe({ ok: 1, ...document })).toMatchObject({ status: 'pass', facts: { topology } });
    });

    it.each([
        ['snappy,zlib', ['snappy', 'zlib'], ['zlib'], true],
        ['zlib,snappy', ['snappy', 'zlib'], ['zlib'], false],
        ['snappy,zlib', [], undefined, false],
        ['snappy,zlib', ['snappy', 'zlib'], ['snappy', 'zlib'], false],
        ['snappy,zlib', undefined, undefined, false],
    ] as const)(
        'negotiates %s against %j with availability %j',
        async (compressors, accepted, available, fails): Promise<void> => {
            const result = await probe(
                { ok: 1, ...(accepted === undefined ? {} : { compression: accepted }) },
                {
                    input: {
                        connectionString: `mongodb://db.test?compressors=${compressors}`,
                        availableCompressors: available,
                    },
                },
            );
            expect(result.status).toBe(fails ? 'fail' : 'pass');
            expect(result.findings).toEqual(
                fails
                    ? [
                          expect.objectContaining({
                              code: 'hello.compressorUnavailable',
                              severity: 'error',
                              data: { compressor: 'snappy' },
                          }),
                      ]
                    : [],
            );
            expect(result.facts.compressorsAccepted).toEqual(accepted ?? null);
        },
    );

    it.each([
        [300050, false],
        [300051, true],
        [-300050, false],
        [-300051, true],
    ] as const)(
        'computes an offset of %s ms with half-round-trip uncertainty',
        async (offsetMs, reports): Promise<void> => {
            let now = 1000000;
            const measuredClock: DiagnosticsClock = { ...clock, now: (): number => now };
            const { io } = fakeResponder((request, socket): void => {
                now += 100;
                socket.write(replyFrame(request.requestId, { ok: 1, localTime: new Date(1000000 + 50 + offsetMs) }));
            });
            const result = await runHello({ net: io, clock: measuredClock });
            expect(result).toMatchObject({
                status: 'pass',
                facts: {
                    roundTripMs: 100,
                    clockOffsetMs: offsetMs,
                    clockUncertaintyMs: 50,
                    serverTime: new Date(1000000 + 50 + offsetMs).toISOString(),
                },
            });
            expect(result.findings).toEqual(
                reports
                    ? [
                          expect.objectContaining({
                              code: 'hello.clockOffset',
                              severity: 'info',
                              data: { offsetMs, uncertaintyMs: 50 },
                          }),
                      ]
                    : [],
            );
        },
    );

    it('rounds clock finding data without rounding the measured facts', async (): Promise<void> => {
        let now = 1000000;
        const { io } = fakeResponder((request, socket): void => {
            now += 101;
            socket.write(replyFrame(request.requestId, { ok: 1, localTime: new Date(1300102) }));
        });
        const result = await runHello({ net: io, clock: { ...clock, now: (): number => now } });
        expect(result).toMatchObject({
            status: 'pass',
            facts: { clockOffsetMs: 300051.5, clockUncertaintyMs: 50.5 },
            findings: [{ code: 'hello.clockOffset', data: { offsetMs: 300052, uncertaintyMs: 51 } }],
        });
    });

    it.each([undefined, 'not-a-date', 1234, { value: 'secret' }])(
        'leaves clock facts null for localTime %j',
        async (localTime): Promise<void> => {
            expect(await probe({ ok: 1, ...(localTime === undefined ? {} : { localTime }) })).toMatchObject({
                status: 'pass',
                findings: [],
                facts: { serverTime: null, clockOffsetMs: null, clockUncertaintyMs: null },
            });
        },
    );

    it.each([
        ['SCRAM-SHA-256', ['SCRAM-SHA-1'], true, true],
        ['SCRAM-SHA-1', ['SCRAM-SHA-256'], true, true],
        ['SCRAM-SHA-256', ['SCRAM-SHA-256'], true, false],
        [undefined, [], true, true],
        [undefined, ['SCRAM-SHA-1'], true, false],
        [undefined, ['SCRAM-SHA-256'], true, false],
        ['MONGODB-OIDC', [], true, false],
        ['MONGODB-X509', [], true, false],
        ['SCRAM-SHA-1', [], false, false],
        ['SCRAM-SHA-1', undefined, true, false],
    ] as const)(
        'evaluates mechanism %s offered %j with user=%s',
        async (authMechanism, offered, user, warns): Promise<void> => {
            const result = await probe(
                { ok: 1, ...(offered === undefined ? {} : { saslSupportedMechs: offered }) },
                {
                    input: { connectionString: `mongodb://${user ? 'user:secret-password@' : ''}db.test` },
                    network: { authMechanism },
                },
            );
            expect(result.status).toBe(warns ? 'warning' : 'pass');
            expect(result.findings).toEqual(
                warns
                    ? [
                          expect.objectContaining({
                              code: 'hello.mechanismNotOffered',
                              severity: 'warning',
                              data: { ...(authMechanism === undefined ? {} : { mechanism: authMechanism }), offered },
                          }),
                      ]
                    : [],
            );
            expect(JSON.stringify(result)).not.toContain('secret-password');
        },
    );

    it('caps known array fields and ignores non-string values and unknown nested data', async (): Promise<void> => {
        const result = await probe({
            ok: 1,
            hosts: [...Array.from({ length: 34 }, (_, index): string => `member-${index}`), { secret: 'never-output' }],
            saslSupportedMechs: [...Array<string>(20).fill('mechanism'), 42],
            internal: { documentdb_versions: [...Array<string>(10).fill('v'.repeat(100)), { secret: 'never-output' }] },
            setName: { secret: 'never-output' },
            readOnly: { secret: 'never-output' },
            maxWireVersion: { secret: 'never-output' },
            secretField: 'x',
            unexpected: { nested: 'never-output' },
        });
        expect(result.facts.hosts).toHaveLength(32);
        expect(result.facts.omittedHostCount).toBe(2);
        expect(result.facts.saslSupportedMechs).toHaveLength(16);
        expect(result.facts.documentdbVersions).toEqual(Array<string>(8).fill('v'.repeat(64)));
        expect(result.facts).not.toHaveProperty('setName');
        expect(result.facts).not.toHaveProperty('readOnly');
        expect(result.facts).not.toHaveProperty('maxWireVersion');
        expect(JSON.stringify(result)).not.toContain('secretField');
        expect(JSON.stringify(result)).not.toContain('never-output');
    });

    it('uses the verified TLS options and original SNI while connecting by address', async (): Promise<void> => {
        const now = Date.now();
        const certificate = createCertificate({
            subjectCN: 'db.test',
            dnsNames: ['db.test'],
            notBefore: new Date(now - 86400000),
            notAfter: new Date(now + 86400000),
        });
        const { port } = await responder(respondWith({ ok: 1, isWritablePrimary: true }), certificate);
        const connectTls = vi.fn<NetIo['connectTls']>(nodeNet.connectTls);
        const result = await runHello({
            port,
            net: { ...nodeNet, connectTls },
            network: { tls: true, tlsCAFile: 'ca.pem' },
            readFile: async (): Promise<Uint8Array> => Buffer.from(certificate.cert),
        });
        expect(result).toMatchObject({ status: 'pass', facts: { isWritablePrimary: true } });
        expect(connectTls.mock.calls[0][0]).toMatchObject({
            host: '127.0.0.1',
            servername: 'db.test',
            port,
            rejectUnauthorized: true,
            ca: Buffer.from(certificate.cert),
        });
    });

    it('reports a TLS peer closing without suggesting that TLS is missing', async (): Promise<void> => {
        const now = Date.now();
        const certificate = createCertificate({
            subjectCN: 'db.test',
            dnsNames: ['db.test'],
            notBefore: new Date(now - 86400000),
            notAfter: new Date(now + 86400000),
        });
        const { port } = await responder((_request, socket): void => {
            socket.end();
        }, certificate);
        const result = await runHello({ port, network: { tls: true, tlsAllowInvalidCertificates: true } });
        expect(result).toMatchObject({
            status: 'fail',
            findings: [{ code: 'hello.closedWithoutReply', data: { tls: true } }],
        });
        expect(result.findings[0].detail.text).not.toContain('probably requires TLS');
    });
});

describe('built-in check pipeline', (): void => {
    it('runs the complete plaintext host chain in order using injected DNS and network I/O', async (): Promise<void> => {
        const dns: DnsIo = {
            lookup: async (): Promise<{ address: string; family: 4 }[]> => [{ address: '127.0.0.1', family: 4 }],
            resolve4: async (): Promise<string[]> => ['127.0.0.1'],
            resolve6: async (): Promise<string[]> => [],
            resolveCname: async (): Promise<string[]> => [],
            getServers: (): string[] => [],
            resolveSrv: async (): Promise<never> => {
                throw new Error('Unexpected SRV');
            },
            resolveTxt: async (): Promise<never> => {
                throw new Error('Unexpected TXT');
            },
            resolveSrvFallback: async (): Promise<never> => {
                throw new Error('Unexpected SRV fallback');
            },
            resolveTxtFallback: async (): Promise<never> => {
                throw new Error('Unexpected TXT fallback');
            },
        };
        const { io, requests } = fakeResponder(respondWith({ ok: 1, isWritablePrimary: true }));
        const checks = createBuiltInChecks();
        expect(checks[6]).toMatchObject({ id: 'hello', scope: 'host', dependsOn: ['tcp', 'tls'], timeout: 'probe' });
        const run = await runDiagnostics({
            input: { connectionString: 'mongodb://db.test:27017' },
            checks,
            io: { dns, net: io },
        });
        expect(run.results.map((result): string => result.checkId)).toEqual([
            'environment',
            'connectionString',
            'srv',
            'dns',
            'tcp',
            'tls',
            'hello',
        ]);
        expect(run.results[2]).toMatchObject({ status: 'skipped', skippedBecause: { reason: 'notApplicable' } });
        expect(run.results[5]).toMatchObject({ status: 'skipped', skippedBecause: { reason: 'notApplicable' } });
        expect(run.results[6]).toMatchObject({ status: 'pass', facts: { handshake: 'opQuery' } });
        expect(requests).toHaveLength(1);
        expect(
            sockets.filter((_, index): boolean => index % 2 === 0).every((socket): boolean => socket.destroyed),
        ).toBe(true);
    });
});

describe('S2: the connection connect timeout bounds establishing the hello socket', (): void => {
    function hangingNet(): { io: NetIo; socket: net.Socket } {
        const socket = new net.Socket();
        const hang = ({ signal }: { signal: AbortSignal }): Promise<never> =>
            new Promise<never>((_, reject): void => {
                signal.addEventListener(
                    'abort',
                    (): void => {
                        socket.destroy();
                        reject(new Error('Operation aborted', { cause: signal.reason }));
                    },
                    { once: true },
                );
            });
        return { io: { connect: hang, connectTls: hang }, socket };
    }

    it.each([
        ['default', 10000, false],
        ['unbounded', null, false],
        ['default', 10000, true],
        ['unbounded', null, true],
    ] as const)(
        'ends a hanging %s-profile connect (probe timeout %s, TLS %s) with a connection-sourced timeout',
        async (_profile, timeout, useTls): Promise<void> => {
            vi.useFakeTimers();
            const { io, socket } = hangingNet();
            const pending = runHello({ net: io, timeout, network: { connectTimeoutMS: 5, tls: useTls } });
            await vi.advanceTimersByTimeAsync(5);
            expect(await pending).toMatchObject({
                status: 'fail',
                findings: [
                    {
                        code: 'check.timeout',
                        data: { operation: 'hello', timeoutMs: 5, source: 'connection', target: 'db.test:27017' },
                    },
                ],
                facts: { connectErrorCode: 'ETIMEDOUT' },
            });
            expect(socket.destroyed).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it('does not apply the connect timeout to the reply wait once the socket is established', async (): Promise<void> => {
        vi.useFakeTimers();
        const pending = runHello({
            net: fakeResponder((): void => {}).io,
            timeout: 1000,
            network: { connectTimeoutMS: 5 },
        });
        await vi.advanceTimersByTimeAsync(750);
        expect(await pending).toMatchObject({ findings: [{ code: 'hello.noReply', data: { waitedMs: 750 } }] });
    });
});
