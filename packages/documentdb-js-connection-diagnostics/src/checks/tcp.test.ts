/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createConnectionStringCheck, createDnsCheck, createTcpCheck, runTroubleshooter } from '../index.js';

import {
    type BuiltInFindingCode,
    type Check,
    type CheckOutcome,
    type CheckResult,
    type NetIo,
    type NetworkOptions,
    type RunContext,
    type TroubleshooterClock,
} from '../index.js';

const servers: net.Server[] = [];
const sockets: net.Socket[] = [];

async function listen(): Promise<{ server: net.Server; port: number }> {
    const server = net.createServer((socket): void => {
        sockets.push(socket);
    });
    servers.push(server);
    await new Promise<void>((resolve, reject): void => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', (): void => {
            server.removeListener('error', reject);
            resolve();
        });
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Expected TCP address');
    }
    return { server, port: address.port };
}

async function close(server: net.Server): Promise<void> {
    if (server.listening) {
        await new Promise<void>((resolve): void => {
            server.close((): void => resolve());
        });
    }
}

afterEach(async (): Promise<void> => {
    sockets.splice(0).forEach((socket): void => {
        socket.destroy();
    });
    await Promise.all(servers.splice(0).map(close));
    vi.useRealTimers();
});

function socketError(code: string): Error & { code: string } {
    return Object.assign(new Error('secret connection text'), { code });
}

function fakeNet(connect: NetIo['connect']): NetIo {
    return {
        connect,
        connectTls: async (): Promise<never> => {
            throw new Error('Unexpected TLS');
        },
    };
}

const clock: TroubleshooterClock = {
    now: (): number => Date.now(),
    setTimeout: (callback, ms): unknown => setTimeout(callback, ms),
    clearTimeout: (handle): void => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
};

async function runTcp(
    options: {
        port?: number;
        host?: string;
        net?: NetIo;
        network?: NetworkOptions;
        addresses?: readonly { address: string; family: 4 | 6 }[];
        probeTimeoutMs?: number;
    } = {},
): Promise<CheckResult<BuiltInFindingCode>> {
    const dns: Check<RunContext, BuiltInFindingCode> = options.addresses
        ? {
              id: 'dns',
              scope: 'host',
              run: async (): Promise<CheckOutcome<BuiltInFindingCode>> => ({
                  status: 'warning',
                  findings: [],
                  facts: { osAddresses: options.addresses },
              }),
          }
        : createDnsCheck();
    const run = await runTroubleshooter({
        input: {
            connectionString: `mongodb://${options.host ?? '127.0.0.1'}:${options.port ?? 27017}`,
            networkOptionLayers: [{ origin: 'setting', options: options.network ?? {} }],
        },
        checks: [createConnectionStringCheck(), dns, createTcpCheck()],
        io: { net: options.net, clock },
        timeouts: { probeTimeoutMs: options.probeTimeoutMs ?? 1000 },
    });
    return run.results[2];
}

describe('per-host TCP probe', (): void => {
    it('connects to a real loopback listener with latency and closes its socket', async (): Promise<void> => {
        const { port } = await listen();
        const result = await runTcp({ port });
        expect(result).toMatchObject({
            status: 'pass',
            findings: [],
            facts: {
                attempts: [
                    { address: '127.0.0.1', family: 4, outcome: 'connected', latencyMs: expect.any(Number) as unknown },
                ],
                connectedAddress: { address: '127.0.0.1', family: 4 },
            },
        });
    });

    it('reports a refused connection on a closed loopback port', async (): Promise<void> => {
        const { server, port } = await listen();
        await close(server);
        expect(await runTcp({ port })).toMatchObject({
            status: 'fail',
            findings: [{ code: 'tcp.refused', severity: 'error' }],
            facts: { connectedAddress: null, attempts: [{ errorCode: 'ECONNREFUSED', outcome: 'failed' }] },
        });
    });

    it.each([
        ['ETIMEDOUT', 'tcp.timeout'],
        ['EHOSTUNREACH', 'tcp.unreachable'],
        ['ENETUNREACH', 'tcp.unreachable'],
        ['ECONNRESET', 'tcp.reset'],
    ])('maps %s without copying error text', async (code, findingCode): Promise<void> => {
        const result = await runTcp({
            net: fakeNet(async (): Promise<never> => {
                throw socketError(code);
            }),
        });
        expect(result).toMatchObject({
            status: 'fail',
            findings: [{ code: findingCode, severity: 'error' }],
            facts: { attempts: [{ errorCode: code }] },
        });
        expect(JSON.stringify(result)).not.toContain('secret');
    });

    it('retains failed IPv6 evidence but passes when IPv4 succeeds and destroys the socket', async (): Promise<void> => {
        const socket = new net.Socket();
        const connect = vi.fn<NetIo['connect']>(async (options): Promise<net.Socket> => {
            if (options.family === 6) {
                throw socketError('ENETUNREACH');
            }
            return socket;
        });
        const result = await runTcp({
            host: 'db.test',
            addresses: [
                { address: '::1', family: 6 },
                { address: '127.0.0.1', family: 4 },
            ],
            net: fakeNet(connect),
        });
        expect(result).toMatchObject({
            status: 'pass',
            findings: [],
            facts: {
                attempts: [
                    { address: '::1', family: 6, outcome: 'failed', errorCode: 'ENETUNREACH' },
                    { address: '127.0.0.1', family: 4, outcome: 'connected' },
                ],
                connectedAddress: { address: '127.0.0.1', family: 4 },
            },
        });
        expect(connect.mock.calls[0][0].signal).toBe(connect.mock.calls[1][0].signal);
        expect(socket.destroyed).toBe(true);
    });

    it('deduplicates failed codes and fails unknown codes without inventing findings', async (): Promise<void> => {
        const result = await runTcp({
            host: 'db.test',
            addresses: [
                { address: '::1', family: 6 },
                { address: '127.0.0.1', family: 4 },
            ],
            net: fakeNet(async (): Promise<never> => {
                throw socketError('ECONNREFUSED');
            }),
        });
        expect(result.findings).toHaveLength(1);
        const unknown = await runTcp({
            net: fakeNet(async (): Promise<never> => {
                throw socketError('private-code');
            }),
        });
        expect(unknown).toMatchObject({
            status: 'fail',
            findings: [],
            facts: { attempts: [{ errorCode: 'unknown' }] },
        });
        expect(JSON.stringify(unknown)).not.toContain('private-code');
    });

    it('never connects directly when a proxy is configured', async (): Promise<void> => {
        const connect = vi.fn<NetIo['connect']>();
        expect(await runTcp({ network: { proxyHost: 'proxy.test' }, net: fakeNet(connect) })).toMatchObject({
            status: 'skipped',
            skippedBecause: { reason: 'inputUnavailable' },
            facts: { reason: 'proxyConfigured' },
        });
        expect(connect).not.toHaveBeenCalled();
    });

    it('uses the shorter connection timeout per address, with connection-source evidence', async (): Promise<void> => {
        vi.useFakeTimers();
        const socket = new net.Socket();
        const io = fakeNet(
            ({ signal }): Promise<net.Socket> =>
                new Promise((_, reject): void => {
                    signal.addEventListener(
                        'abort',
                        (): void => {
                            socket.destroy();
                            reject(
                                signal.reason instanceof Error
                                    ? signal.reason
                                    : new Error('Operation aborted', { cause: signal.reason }),
                            );
                        },
                        { once: true },
                    );
                }),
        );
        const pending = runTcp({ network: { connectTimeoutMS: 20 }, net: io });
        await vi.advanceTimersByTimeAsync(20);
        const result = await pending;
        expect(result).toMatchObject({
            status: 'fail',
            findings: [{ code: 'tcp.timeout', data: { errorCode: 'ETIMEDOUT', source: 'connection' } }],
            facts: { attempts: [{ errorCode: 'ETIMEDOUT', latencyMs: 20 }] },
        });
        expect(socket.destroyed).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('lets the runner end a never-answering socket with check.timeout and destroys it', async (): Promise<void> => {
        vi.useFakeTimers();
        const socket = new net.Socket();
        const io = fakeNet(
            ({ signal }): Promise<net.Socket> =>
                new Promise((_, reject): void => {
                    signal.addEventListener(
                        'abort',
                        (): void => {
                            socket.destroy();
                            reject(
                                signal.reason instanceof Error
                                    ? signal.reason
                                    : new Error('Operation aborted', { cause: signal.reason }),
                            );
                        },
                        { once: true },
                    );
                }),
        );
        const pending = runTcp({ net: io, probeTimeoutMs: 50, network: { connectTimeoutMS: 100 } });
        await vi.advanceTimersByTimeAsync(50);
        expect(await pending).toMatchObject({
            status: 'fail',
            findings: [{ code: 'check.timeout', data: { source: 'check', timeoutMs: 50 } }],
        });
        expect(socket.destroyed).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });
});
