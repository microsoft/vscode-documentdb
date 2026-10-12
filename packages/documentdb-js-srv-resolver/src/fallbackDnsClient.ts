/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dnsPacket from 'dns-packet';
import * as crypto from 'node:crypto';
import * as dgram from 'node:dgram';
import * as dns from 'node:dns';
import * as net from 'node:net';

import { DNS_DEFAULT_PORT, FALLBACK_TCP_TIMEOUT_MS, FALLBACK_UDP_TIMEOUT_MS } from './constants.js';
import { cancellationError, noopLogger, throwIfCancelled } from './types.js';

import { type SrvRecord } from 'node:dns';
import { type SrvResolverLogger } from './types.js';

export type DnsTransport = 'udp' | 'tcp';

export interface DnsServerAddress {
    readonly host: string;
    readonly port: number;
    readonly family: 4 | 6;
    readonly display: string;
}

/** Returns undefined for invalid entries, without resolving hostnames through another resolver. */
function parseDnsServer(server: string): DnsServerAddress | undefined {
    let host = server;
    let port = DNS_DEFAULT_PORT;
    if (server.startsWith('[')) {
        const match = /^\[([^\]]+)\](?::([0-9]+))?$/.exec(server);
        if (!match) {
            return undefined;
        }
        host = match[1];
        port = match[2] === undefined ? port : Number(match[2]);
    } else if (net.isIP(server) === 0) {
        const match = /^([^:]+):([0-9]+)$/.exec(server);
        if (!match) {
            return undefined;
        }
        host = match[1];
        port = Number(match[2]);
    }
    const family = net.isIP(host);
    if ((family !== 4 && family !== 6) || !Number.isInteger(port) || port < 1 || port > 65535) {
        return undefined;
    }
    return { host, port, family, display: `${family === 6 ? `[${host}]` : host}:${port}` };
}

export interface FallbackDnsOptions {
    readonly deadlineAt: number;
    readonly signal?: AbortSignal;
    readonly servers?: readonly string[];
    readonly logger?: SrvResolverLogger;
    readonly logPrefix?: string;
    readonly udpTimeoutMs?: number;
    readonly tcpTimeoutMs?: number;
}

export interface FallbackDnsResult<T> {
    readonly records: T[];
    readonly server: string;
    readonly transport: DnsTransport;
    readonly serversTried: number;
}

export class FallbackDnsError extends Error {
    constructor(
        public readonly code: string,
        public readonly syscall: 'querySrv' | 'queryTxt',
        public readonly hostname: string,
        public readonly serversTried: number,
    ) {
        super(`${syscall} ${code} ${hostname}`);
        this.name = 'FallbackDnsError';
    }
}

type QueryType = 'SRV' | 'TXT';

interface Reply {
    readonly packet: dnsPacket.DecodedPacket;
    readonly bytes: Buffer;
}

interface AttemptReply extends Reply {
    readonly errorCode?: string;
}

class AttemptError extends Error {
    constructor(public readonly code: string) {
        super(code);
    }
}

/** Targets are returned as dns-packet decodes them: without a trailing dot, with no further stripping. */
export async function resolveSrvFallback(
    name: string,
    options: FallbackDnsOptions,
): Promise<FallbackDnsResult<SrvRecord>> {
    return resolveFallback(name, 'SRV', options, (answers): SrvRecord[] =>
        answers.flatMap((answer): SrvRecord[] =>
            answer.type === 'SRV'
                ? [
                      {
                          name: answer.data.target,
                          port: answer.data.port,
                          priority: answer.data.priority ?? 0,
                          weight: answer.data.weight ?? 0,
                      },
                  ]
                : [],
        ),
    );
}

export async function resolveTxtFallback(
    name: string,
    options: FallbackDnsOptions,
): Promise<FallbackDnsResult<string[]>> {
    return resolveFallback(name, 'TXT', options, (answers): string[][] =>
        answers.flatMap((answer): string[][] => {
            if (answer.type !== 'TXT') {
                return [];
            }
            const chunks = Array.isArray(answer.data) ? answer.data : [answer.data];
            return [chunks.map((chunk): string => (Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk))];
        }),
    );
}

async function resolveFallback<T>(
    name: string,
    type: QueryType,
    options: FallbackDnsOptions,
    recordsFromAnswers: (answers: readonly dnsPacket.Answer[]) => T[],
): Promise<FallbackDnsResult<T>> {
    throwIfCancelled(options.signal);
    const servers: DnsServerAddress[] = [];
    for (const entry of options.servers ?? dns.getServers()) {
        const server = parseDnsServer(entry);
        if (server) {
            servers.push(server);
        } else {
            (options.logger ?? noopLogger).trace(
                `${options.logPrefix ?? '[SrvResolution]'} fallback skipping unparseable DNS server entry`,
            );
        }
    }
    let serversTried = 0;
    let lastCode: string = dns.CONNREFUSED;
    const failure = (code: string): FallbackDnsError =>
        new FallbackDnsError(code, type === 'SRV' ? 'querySrv' : 'queryTxt', name, serversTried);

    for (const server of servers) {
        throwIfCancelled(options.signal);
        if (Date.now() >= options.deadlineAt) {
            throw failure(dns.TIMEOUT);
        }
        serversTried++;
        const id = crypto.randomInt(0, 65536);
        const question: dnsPacket.Question = { name, type, class: 'IN' };
        const query = dnsPacket.encode({
            type: 'query',
            id,
            flags: dnsPacket.RECURSION_DESIRED,
            questions: [question],
        });
        let transport: DnsTransport = 'udp';
        let reply: AttemptReply;
        try {
            reply = await runAttempt(server, transport, id, question, query, options);
            if (reply.packet.flag_tc) {
                transport = 'tcp';
                reply = await runAttempt(server, transport, id, question, query, options);
            }
        } catch (error) {
            throwIfCancelled(options.signal);
            lastCode = socketErrorCode(error);
            continue;
        }
        throwIfCancelled(options.signal);
        lastCode = reply.errorCode ?? dns.BADRESP;
        if (reply.errorCode === dns.NODATA || reply.errorCode === dns.NOTFOUND) {
            throw failure(reply.errorCode);
        }
        if (reply.errorCode) {
            continue;
        }
        return {
            records: recordsFromAnswers(reply.packet.answers ?? []),
            server: server.display,
            transport,
            serversTried,
        };
    }
    throwIfCancelled(options.signal);
    throw failure(servers.length > 0 && Date.now() >= options.deadlineAt ? dns.TIMEOUT : lastCode);
}

function responseError(reply: Reply, type: QueryType, transport: DnsTransport): string | undefined {
    if (reply.packet.flag_tc) {
        return transport === 'udp' ? undefined : dns.BADRESP;
    }
    // The first six wire rcodes map to Node's dns constants. Unknown rcodes are EBADRESP.
    switch (reply.bytes[3] & 0x0f) {
        case 0:
            return reply.packet.answers?.some((answer): boolean => answer.type === type) ? undefined : dns.NODATA;
        case 1:
            return dns.FORMERR;
        case 2:
            return dns.SERVFAIL;
        case 3:
            return dns.NOTFOUND;
        case 4:
            return dns.NOTIMP;
        case 5:
            return dns.REFUSED;
        default:
            return dns.BADRESP;
    }
}

function socketErrorCode(error: unknown): string {
    if (error instanceof AttemptError) {
        return error.code;
    }
    // All other transport failures are connection failures, not authoritative DNS answers.
    if (error instanceof Error && 'code' in error && error.code === 'ETIMEDOUT') {
        return dns.TIMEOUT;
    }
    return dns.CONNREFUSED;
}

async function runAttempt(
    server: DnsServerAddress,
    transport: DnsTransport,
    id: number,
    question: dnsPacket.Question,
    query: Buffer,
    options: FallbackDnsOptions,
): Promise<AttemptReply> {
    throwIfCancelled(options.signal);
    const startedAt = Date.now();
    const perAttemptTimeout =
        transport === 'udp'
            ? (options.udpTimeoutMs ?? FALLBACK_UDP_TIMEOUT_MS)
            : (options.tcpTimeoutMs ?? FALLBACK_TCP_TIMEOUT_MS);
    const timeoutMs = Math.min(perAttemptTimeout, options.deadlineAt - startedAt);
    let reply: Reply | undefined;
    let errorCode: string | undefined;
    let cancelled = false;
    try {
        if (timeoutMs <= 0) {
            throw new AttemptError(dns.TIMEOUT);
        }
        reply = await exchange(server, transport, id, question, query, startedAt + timeoutMs, options);
        errorCode = responseError(reply, question.type as QueryType, transport);
        return { ...reply, errorCode };
    } catch (error) {
        cancelled = options.signal?.aborted ?? false;
        errorCode = cancelled ? undefined : socketErrorCode(error);
        throw error;
    } finally {
        const rcodeNumber = reply ? reply.bytes[3] & 0x0f : undefined;
        const rcode =
            rcodeNumber === undefined
                ? undefined
                : (['NOERROR', 'FORMERR', 'SERVFAIL', 'NXDOMAIN', 'NOTIMP', 'REFUSED'][rcodeNumber] ??
                  `RCODE_${rcodeNumber}`);
        const fields = [
            `${options.logPrefix ?? '[SrvResolution]'} fallback ${question.type}`,
            `server=${server.display}`,
            `transport=${transport}`,
            `id=0x${id.toString(16).padStart(4, '0')}`,
        ];
        if (reply) {
            const answers = (reply.packet.answers ?? []).filter((answer): boolean => answer.type === question.type);
            fields.push(
                `rcode=${rcode}`,
                `tc=${reply.packet.flag_tc}`,
                `answers=${answers.length}`,
                `bytes=${reply.bytes.length}`,
            );
        }
        if (errorCode) {
            fields.push(`error=${errorCode}`);
        }
        if (cancelled) {
            fields.push('cancelled=true');
        }
        fields.push(`durationMs=${Date.now() - startedAt}`);
        (options.logger ?? noopLogger).trace(fields.join(' '));
    }
}

function normalizedAddress(host: string): string {
    if (net.isIP(host) === 6) {
        // UDP source addresses may use a different IPv6 spelling or omit the interface scope.
        return new URL(`http://[${host.split('%')[0]}]/`).hostname;
    }
    return host;
}

function matchingReply(bytes: Buffer, id: number, question: dnsPacket.Question): Reply | undefined {
    const packet = dnsPacket.decode(bytes);
    const echoed = packet.questions?.[0];
    if (
        packet.id !== id ||
        !packet.flag_qr ||
        packet.questions?.length !== 1 ||
        !echoed ||
        echoed.name.toLowerCase() !== question.name.replace(/\.$/, '').toLowerCase() ||
        echoed.type !== question.type ||
        (echoed.class ?? 'IN') !== question.class
    ) {
        return undefined;
    }
    return { packet, bytes };
}

function exchange(
    server: DnsServerAddress,
    transport: DnsTransport,
    id: number,
    question: dnsPacket.Question,
    query: Buffer,
    attemptDeadlineAt: number,
    options: FallbackDnsOptions,
): Promise<Reply> {
    return new Promise((resolve, reject): void => {
        const udp = transport === 'udp' ? dgram.createSocket(server.family === 4 ? 'udp4' : 'udp6') : undefined;
        const tcp = transport === 'tcp' ? new net.Socket() : undefined;
        let settled = false;
        let received = Buffer.alloc(0);
        const finish = (error?: unknown, reply?: Reply): void => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', onAbort);
            udp?.removeAllListeners('message');
            udp?.removeAllListeners('listening');
            if (udp) {
                try {
                    udp.close();
                } catch {
                    // A synchronous bind/send failure can leave the socket not yet running.
                }
            }
            tcp?.destroy();
            if (reply) {
                resolve(reply);
            } else {
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Preserve socket setup failures unchanged, including non-Error throws.
                reject(error);
            }
        };
        const onAbort = (): void => {
            if (options.signal) {
                finish(cancellationError(options.signal));
            }
        };
        const timer = setTimeout(
            (): void => finish(new AttemptError(dns.TIMEOUT)),
            Math.max(0, attemptDeadlineAt - Date.now()),
        );
        options.signal?.addEventListener('abort', onAbort, { once: true });
        if (options.signal?.aborted) {
            onAbort();
            return;
        }
        const accept = (bytes: Buffer): void => {
            if (settled) {
                return;
            }
            try {
                const reply = matchingReply(bytes, id, question);
                if (reply) {
                    finish(undefined, reply);
                }
            } catch {
                if (transport === 'tcp') {
                    finish(new AttemptError(dns.BADRESP));
                }
                // Malformed UDP datagrams are ignored just like mismatched replies.
            }
        };
        udp?.on('error', (error: Error): void => finish(error));
        tcp?.on('error', (error: Error): void => finish(error));
        try {
            if (udp) {
                udp.on('message', (bytes: Buffer, source: dgram.RemoteInfo): void => {
                    if (
                        source.port === server.port &&
                        normalizedAddress(source.address) === normalizedAddress(server.host)
                    ) {
                        accept(bytes);
                    }
                });
                udp.once('listening', (): void => {
                    if (!settled) {
                        udp.send(query, server.port, server.host, (error): void => {
                            if (error) {
                                finish(error);
                            }
                        });
                    }
                });
                udp.bind(0);
            } else if (tcp) {
                tcp.on('data', (chunk: Buffer): void => {
                    received = Buffer.concat([received, chunk]);
                    while (!settled && received.length >= 2) {
                        const length = received.readUInt16BE(0);
                        if (length === 0) {
                            finish(new AttemptError(dns.BADRESP));
                            return;
                        }
                        if (received.length < length + 2) {
                            return;
                        }
                        const bytes = received.subarray(2, length + 2);
                        received = received.subarray(length + 2);
                        accept(bytes);
                    }
                });
                tcp.on('end', (): void => finish(new AttemptError(dns.BADRESP)));
                tcp.on('close', (): void => finish(new AttemptError(dns.CONNREFUSED)));
                tcp.connect(server.port, server.host, (): void => {
                    const prefix = Buffer.alloc(2);
                    prefix.writeUInt16BE(query.length);
                    tcp.write(Buffer.concat([prefix, query]));
                });
            }
        } catch (error) {
            finish(error);
        }
    });
}
