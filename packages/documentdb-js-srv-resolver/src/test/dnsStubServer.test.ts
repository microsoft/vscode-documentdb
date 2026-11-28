/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import dgram from 'node:dgram';
import net from 'node:net';

import { DnsStubServer } from './dnsStubServer.js';

function isBindCallback(value: unknown): value is () => void {
    return typeof value === 'function';
}

describe('DNS stub server lifecycle', (): void => {
    const stubs: DnsStubServer[] = [];

    beforeEach((): void => {
        // Isolate lifecycle checks from paired-port allocation; fallbackDnsClient.test.ts covers real DNS traffic.
        const bind = dgram.Socket.prototype.bind;
        const listen = net.Server.prototype.listen;
        vi.spyOn(dgram.Socket.prototype, 'bind').mockImplementation(function (
            this: dgram.Socket,
            ...args: unknown[]
        ): dgram.Socket {
            const callback = args[2];
            if (!isBindCallback(callback)) {
                throw new Error('Expected a UDP bind callback');
            }
            bind.call(this, { port: 0, address: '127.0.0.1' }, callback);
            return this;
        });
        vi.spyOn(net.Server.prototype, 'listen').mockImplementation(function (
            this: net.Server,
            ...args: unknown[]
        ): net.Server {
            const callback = args[2];
            if (!isBindCallback(callback)) {
                throw new Error('Expected a TCP listen callback');
            }
            listen.call(this, { port: 0, host: '127.0.0.1' }, callback);
            return this;
        });
    });

    afterEach(async (): Promise<void> => {
        try {
            await Promise.all(stubs.map((stub): Promise<void> => stub.close()));
        } finally {
            stubs.length = 0;
            vi.restoreAllMocks();
        }
    });

    it.each(['EADDRINUSE', 'EACCES'])(
        'retries TCP %s after closing the partially started stub',
        async (code): Promise<void> => {
            const error = Object.assign(new Error(code), { code });
            const close = vi.spyOn(dgram.Socket.prototype, 'close');
            const listen = vi.spyOn(net.Server.prototype, 'listen').mockImplementationOnce(function (
                this: net.Server,
            ): net.Server {
                queueMicrotask((): void => {
                    this.emit('error', error);
                });
                return this;
            });

            const server = await DnsStubServer.start((): void => {});
            stubs.push(server);

            expect(server.address).toMatch(/^127\.0\.0\.1:\d+$/);
            expect(listen).toHaveBeenCalledTimes(2);
            expect(close).toHaveBeenCalledTimes(1);
        },
    );

    it.each([
        ['EACCES', 10],
        ['EADDRINUSE', 10],
        ['EINVAL', 1],
    ])('cleans up and reports %s after %i attempts', async (code, attempts): Promise<void> => {
        const error = Object.assign(new Error(code), { code });
        const close = vi.spyOn(dgram.Socket.prototype, 'close');
        const listen = vi.spyOn(net.Server.prototype, 'listen').mockImplementation(function (
            this: net.Server,
        ): net.Server {
            queueMicrotask((): void => {
                this.emit('error', error);
            });
            return this;
        });

        await expect(DnsStubServer.start((): void => {})).rejects.toBe(error);

        expect(listen).toHaveBeenCalledTimes(attempts);
        expect(close).toHaveBeenCalledTimes(attempts);
    });

    it.each(['EADDRINUSE', 'EACCES'])(
        'retries UDP %s without trying to close an unbound socket',
        async (code): Promise<void> => {
            const error = Object.assign(new Error(code), { code });
            const bind = vi.spyOn(dgram.Socket.prototype, 'bind').mockImplementationOnce(function (
                this: dgram.Socket,
            ): dgram.Socket {
                queueMicrotask((): void => {
                    this.emit('error', error);
                });
                return this;
            });
            const close = vi.spyOn(dgram.Socket.prototype, 'close');
            const listen = vi.spyOn(net.Server.prototype, 'listen');

            const server = await DnsStubServer.start((): void => {});
            stubs.push(server);

            expect(bind).toHaveBeenCalledTimes(2);
            expect(close).not.toHaveBeenCalled();
            expect(listen).toHaveBeenCalledTimes(1);
        },
    );

    it.each([
        ['EACCES', 10],
        ['EADDRINUSE', 10],
        ['EINVAL', 1],
    ])('preserves UDP %s after %i attempts without closing unbound sockets', async (code, attempts): Promise<void> => {
        const error = Object.assign(new Error(code), { code });
        const bind = vi.spyOn(dgram.Socket.prototype, 'bind').mockImplementation(function (
            this: dgram.Socket,
        ): dgram.Socket {
            queueMicrotask((): void => {
                this.emit('error', error);
            });
            return this;
        });
        const close = vi.spyOn(dgram.Socket.prototype, 'close');
        const listen = vi.spyOn(net.Server.prototype, 'listen');

        await expect(DnsStubServer.start((): void => {})).rejects.toBe(error);

        expect(bind).toHaveBeenCalledTimes(attempts);
        expect(close).not.toHaveBeenCalled();
        expect(listen).not.toHaveBeenCalled();
    });

    it('can close an already closed stub', async (): Promise<void> => {
        const server = await DnsStubServer.start((): void => {});
        stubs.push(server);
        const closeUdp = vi.spyOn(dgram.Socket.prototype, 'close');
        const closeTcp = vi.spyOn(net.Server.prototype, 'close');

        await server.close();
        await server.close();

        expect(closeUdp).toHaveBeenCalledTimes(1);
        expect(closeTcp).toHaveBeenCalledTimes(1);
    });
});
