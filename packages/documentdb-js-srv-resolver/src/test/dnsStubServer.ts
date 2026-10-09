/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dnsPacket from 'dns-packet';
import dgram from 'node:dgram';
import net from 'node:net';

import { type DnsTransport } from '../fallbackDnsClient';

export interface StubRequest {
    readonly query: dnsPacket.DecodedPacket;
    readonly transport: DnsTransport;
    send(bytes: Buffer, split?: boolean): void;
}

export class DnsStubServer {
    public readonly queries: StubRequest[] = [];
    public readonly tcpSockets = new Set<net.Socket>();
    public address = '';
    private readonly udp = dgram.createSocket('udp4');
    private readonly tcp = net.createServer();
    private readonly timers = new Set<NodeJS.Timeout>();
    private closed = false;

    private constructor(private readonly handler: (request: StubRequest) => void) {
        this.udp.on('message', (bytes: Buffer, remote: dgram.RemoteInfo): void => {
            this.dispatch(bytes, 'udp', (response): void => {
                if (!this.closed) {
                    this.udp.send(response, remote.port, remote.address);
                }
            });
        });
        this.tcp.on('connection', (socket: net.Socket): void => {
            this.tcpSockets.add(socket);
            socket.on('close', (): void => {
                this.tcpSockets.delete(socket);
            });
            socket.on('error', (): void => {
                socket.destroy();
            });
            let received = Buffer.alloc(0);
            socket.on('data', (chunk: Buffer): void => {
                received = Buffer.concat([received, chunk]);
                while (received.length >= 2) {
                    const length = received.readUInt16BE(0);
                    if (received.length < length + 2) {
                        return;
                    }
                    const bytes = received.subarray(2, length + 2);
                    received = received.subarray(length + 2);
                    this.dispatch(bytes, 'tcp', (response, split): void => {
                        const prefix = Buffer.alloc(2);
                        prefix.writeUInt16BE(response.length);
                        const framed = Buffer.concat([prefix, response]);
                        if (!split) {
                            socket.write(framed);
                            return;
                        }
                        socket.write(framed.subarray(0, 1));
                        this.later((): void => {
                            socket.write(framed.subarray(1, 5));
                        }, 5);
                        this.later((): void => {
                            socket.write(framed.subarray(5));
                        }, 10);
                    });
                }
            });
        });
    }

    public static async start(handler: (request: StubRequest) => void): Promise<DnsStubServer> {
        const stub = new DnsStubServer(handler);
        await new Promise<void>((resolve, reject): void => {
            stub.udp.once('error', reject);
            stub.udp.bind(0, '127.0.0.1', (): void => {
                stub.udp.removeListener('error', reject);
                resolve();
            });
        });
        const port = stub.udp.address().port;
        await new Promise<void>((resolve, reject): void => {
            stub.tcp.once('error', reject);
            stub.tcp.listen(port, '127.0.0.1', (): void => {
                stub.tcp.removeListener('error', reject);
                resolve();
            });
        });
        stub.address = `127.0.0.1:${port}`;
        return stub;
    }

    public later(callback: () => void, delayMs: number): void {
        const timer = setTimeout((): void => {
            this.timers.delete(timer);
            if (!this.closed) {
                callback();
            }
        }, delayMs);
        this.timers.add(timer);
    }

    public async close(): Promise<void> {
        this.closed = true;
        for (const timer of this.timers) {
            clearTimeout(timer);
        }
        for (const socket of this.tcpSockets) {
            socket.destroy();
        }
        await Promise.all([
            new Promise<void>((resolve): void => {
                this.udp.close((): void => resolve());
            }),
            new Promise<void>((resolve): void => {
                this.tcp.close((): void => resolve());
            }),
        ]);
    }

    private dispatch(bytes: Buffer, transport: DnsTransport, send: (response: Buffer, split?: boolean) => void): void {
        const request: StubRequest = { query: dnsPacket.decode(bytes), transport, send };
        this.queries.push(request);
        this.handler(request);
    }
}
