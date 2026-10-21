/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, it, vi } from 'vitest';

import dgram from 'node:dgram';
import net from 'node:net';

import { DnsStubServer } from './dnsStubServer.js';

describe('DNS stub server lifecycle', (): void => {
    const stubs: DnsStubServer[] = [];

    afterEach(async (): Promise<void> => {
        try {
            await Promise.all(stubs.map((stub): Promise<void> => stub.close()));
        } finally {
            stubs.length = 0;
            vi.restoreAllMocks();
        }
    });

    it('retries a TCP port conflict after closing the partially started stub', async (): Promise<void> => {
        const error = Object.assign(new Error('port in use'), { code: 'EADDRINUSE' });
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
    });

    it.each([
        ['EACCES', 1],
        ['EADDRINUSE', 3],
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

    it('preserves UDP bind errors without trying to close unbound sockets', async (): Promise<void> => {
        const error = Object.assign(new Error('bind denied'), { code: 'EACCES' });
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

        await expect(DnsStubServer.start((): void => {})).rejects.toBe(error);

        expect(bind).toHaveBeenCalledTimes(1);
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
