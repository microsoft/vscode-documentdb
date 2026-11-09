/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deserialize, serialize } from 'bson';
import * as connectionStringUrl from 'mongodb-connection-string-url';
import { randomInt } from 'node:crypto';

import { addressFact } from '../addressClass.js';
import { nodeNet, readFile } from '../io/nodeNet.js';
import { resolveNetworkOptions } from '../networkOptions.js';
import { SAFETY_LIMITS } from '../timeouts.js';
import {
    ConnectionTimeoutError,
    connectionDeadlineMs,
    connectionTimeoutFinding,
    establishWithin,
} from './connectionDeadline.js';
import { tlsConnectionOptions } from './tlsOptions.js';

import { type Socket } from 'node:net';
import { type BuiltInFindingCode } from '../findingCodes.js';
import {
    type Check,
    type CheckOutcome,
    type Finding,
    type FindingSeverity,
    type NetworkOptions,
    type RunContext,
} from '../types.js';

type InconclusiveReason = 'responseTo' | 'opCode' | 'truncated' | 'malformed' | 'tooLarge';
interface Handshake {
    readonly bytes: Buffer;
    readonly requestId: number;
    readonly kind: 'opQuery' | 'opMsg';
    readonly userKnown: boolean;
}
interface Reply {
    readonly document: Record<string, unknown>;
    readonly sentAt: number;
    readonly receivedAt: number;
}
type ParsedFrame = { readonly document: Record<string, unknown> } | { readonly failure: Finding<BuiltInFindingCode> };
type ReplyResult = Reply | { readonly failure: Finding<BuiltInFindingCode> };

function finding(
    code: BuiltInFindingCode,
    severity: FindingSeverity,
    data: Readonly<Record<string, unknown>>,
    text: string,
): Finding<BuiltInFindingCode> {
    return { code, severity, data, detail: { language: 'en', text } };
}

function inconclusive(reason: InconclusiveReason): Finding<BuiltInFindingCode> {
    return finding(
        'hello.inconclusive',
        'error',
        { reason },
        'The server reply could not be accepted as a complete MongoDB API handshake.',
    );
}

function errorCode(error: unknown): string {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : 'unknown';
}

function handshake(context: RunContext, options: NetworkOptions): Handshake {
    const uri = new connectionStringUrl.ConnectionString(context.input.connectionString);
    const userName = uri.username ? decodeURIComponent(uri.username) : undefined;
    const authSource =
        options.authSource ?? (uri.pathname.length > 1 ? decodeURIComponent(uri.pathname.slice(1)) : 'admin');
    const common = {
        compression: options.compressors ?? [],
        ...(userName && authSource ? { saslSupportedMechs: `${authSource}.${userName}` } : {}),
    };
    const opMsg = options.loadBalanced === true || options.serverApiVersion !== undefined;
    const document = opMsg
        ? { hello: 1, $db: 'admin', ...common, ...(options.loadBalanced ? { loadBalanced: true } : {}) }
        : { isMaster: 1, helloOk: true, ...common };
    const bson = serialize(document);
    let body: Buffer;
    if (opMsg) {
        body = Buffer.concat([Buffer.alloc(5), bson]);
    } else {
        const namespace = Buffer.from('admin.$cmd\0');
        const numbers = Buffer.alloc(8);
        numbers.writeInt32LE(-1, 4);
        body = Buffer.concat([Buffer.alloc(4), namespace, numbers, bson]);
    }
    const header = Buffer.alloc(16);
    const requestId = randomInt(1, 0x80000000);
    header.writeInt32LE(16 + body.length, 0);
    header.writeInt32LE(requestId, 4);
    header.writeInt32LE(opMsg ? 2013 : 2004, 12);
    return {
        bytes: Buffer.concat([header, body]),
        requestId,
        kind: opMsg ? 'opMsg' : 'opQuery',
        userKnown: !!userName,
    };
}

function validateHeader(header: Buffer, requestId: number): Finding<BuiltInFindingCode> | undefined {
    const length = header.readInt32LE(0);
    if (length < 16 || length > 48 * 1024 * 1024 || header.subarray(0, 5).toString('ascii') === 'HTTP/') {
        return finding(
            'hello.notWireProtocol',
            'error',
            {},
            'The server replied with bytes that are not the MongoDB API wire protocol; check the host and port.',
        );
    }
    if (length > SAFETY_LIMITS.maxWireReplyBytes) {
        return inconclusive('tooLarge');
    }
    if (header.readInt32LE(8) !== requestId) {
        return inconclusive('responseTo');
    }
    const opcode = header.readInt32LE(12);
    if (opcode !== 1 && opcode !== 2013) {
        return inconclusive('opCode');
    }
    if (length < (opcode === 1 ? 41 : 26)) {
        return inconclusive('truncated');
    }
    return undefined;
}

function parseFrame(frame: Buffer): ParsedFrame {
    let start: number;
    let end = frame.length;
    if (frame.readInt32LE(12) === 1) {
        if (frame.readInt32LE(32) !== 1) {
            return { failure: inconclusive('malformed') };
        }
        start = 36;
    } else {
        const flags = frame.readUInt32LE(16);
        if ((flags & 1) !== 0) {
            end -= 4;
        }
        // Unknown required flags and additional sections are outside this bounded handshake.
        if ((flags & 0x0000fffc) !== 0 || frame[20] !== 0) {
            return { failure: inconclusive('malformed') };
        }
        start = 21;
    }
    if (end - start < 5) {
        return { failure: inconclusive('truncated') };
    }
    const length = frame.readInt32LE(start);
    if (length < 5) {
        return { failure: inconclusive('malformed') };
    }
    if (start + length > end) {
        return { failure: inconclusive('truncated') };
    }
    if (start + length !== end) {
        return { failure: inconclusive('malformed') };
    }
    try {
        const document: Record<string, unknown> = deserialize(frame.subarray(start, end));
        return { document };
    } catch {
        return { failure: inconclusive('malformed') };
    }
}

function receiveReply(
    socket: Socket,
    request: Handshake,
    context: RunContext,
    signal: AbortSignal,
    noteBytes: () => void,
    tls: boolean,
): Promise<ReplyResult> {
    return new Promise((resolve, reject): void => {
        const header = Buffer.alloc(16);
        let headerBytes = 0;
        let frame: Buffer | undefined;
        let frameBytes = 0;
        let sentAt = 0;
        let settled = false;
        function detach(): void {
            socket.removeListener('data', onData);
            socket.removeListener('end', onClosed);
            socket.removeListener('close', onClosed);
            socket.removeListener('error', onClosed);
            signal.removeEventListener('abort', onAbort);
        }
        function finish(result: ReplyResult): void {
            if (settled) {
                return;
            }
            settled = true;
            detach();
            resolve(result);
        }
        function onAbort(): void {
            if (settled) {
                return;
            }
            settled = true;
            detach();
            socket.destroy();
            reject(
                signal.reason instanceof Error
                    ? signal.reason
                    : new Error('Operation aborted', { cause: signal.reason }),
            );
        }
        function onClosed(): void {
            finish({
                failure: finding(
                    'hello.closedWithoutReply',
                    'error',
                    { tls },
                    tls
                        ? 'The server closed the connection before a complete handshake reply arrived.'
                        : 'The server closed the connection before a complete handshake reply arrived; it probably requires TLS.',
                ),
            });
        }
        function onData(chunk: Buffer): void {
            noteBytes();
            let offset = 0;
            if (headerBytes < 16) {
                const count = Math.min(16 - headerBytes, chunk.length);
                chunk.copy(header, headerBytes, 0, count);
                headerBytes += count;
                offset += count;
                // Reject obviously non-wire prefixes even when the peer sends fewer than 16 bytes.
                if (headerBytes >= 4 && (header.readInt32LE(0) < 16 || header.readInt32LE(0) > 48 * 1024 * 1024)) {
                    finish({
                        failure: finding(
                            'hello.notWireProtocol',
                            'error',
                            {},
                            'The server replied with bytes that are not the MongoDB API wire protocol; check the host and port.',
                        ),
                    });
                    return;
                }
                if (headerBytes !== 16) {
                    return;
                }
                const failure = validateHeader(header, request.requestId);
                if (failure) {
                    finish({ failure });
                    return;
                }
                // Allocate only after validating the bounded header; ignore coalesced trailing bytes.
                frame = Buffer.alloc(header.readInt32LE(0));
                header.copy(frame);
                frameBytes = 16;
            }
            if (!frame) {
                return;
            }
            const count = Math.min(frame.length - frameBytes, chunk.length - offset);
            chunk.copy(frame, frameBytes, offset, offset + count);
            frameBytes += count;
            if (frameBytes === frame.length) {
                const parsed = parseFrame(frame);
                if ('failure' in parsed) {
                    finish(parsed);
                } else {
                    finish({ ...parsed, sentAt, receivedAt: context.io.clock.now() });
                }
            }
        }
        socket.on('data', onData);
        socket.once('end', onClosed);
        socket.once('close', onClosed);
        socket.once('error', onClosed);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) {
            onAbort();
            return;
        }
        if (socket.destroyed || socket.readableEnded) {
            onClosed();
            return;
        }
        sentAt = context.io.clock.now();
        socket.write(request.bytes);
    });
}

function strings(value: unknown): string[] {
    return Array.isArray(value)
        ? (value as unknown[]).filter((entry): entry is string => typeof entry === 'string')
        : [];
}

function success(
    reply: Reply,
    request: Handshake,
    context: RunContext,
    options: NetworkOptions,
): CheckOutcome<BuiltInFindingCode> {
    const doc = reply.document;
    if (doc.ok !== 1) {
        return {
            status: 'fail',
            facts: {},
            findings: [
                finding(
                    'hello.inconclusive',
                    'error',
                    {
                        reason: 'commandFailed',
                        ...(typeof doc.code === 'number' && Number.isFinite(doc.code) ? { code: doc.code } : {}),
                        ...(typeof doc.codeName === 'string' && /^[A-Za-z]+$/.test(doc.codeName)
                            ? { codeName: doc.codeName }
                            : {}),
                    },
                    'The server did not accept the unauthenticated handshake command.',
                ),
            ],
        };
    }
    const internal = doc.internal;
    const versions =
        internal && typeof internal === 'object' && 'documentdb_versions' in internal
            ? internal.documentdb_versions
            : undefined;
    const members = [...strings(doc.hosts), ...strings(doc.passives), ...strings(doc.arbiters)];
    const offered = options.compressors ?? [];
    const accepted = doc.compression === undefined ? null : strings(doc.compression);
    const mechanisms = strings(doc.saslSupportedMechs).slice(0, 16);
    const roundTripMs = reply.receivedAt - reply.sentAt;
    const serverTimeMs =
        doc.localTime instanceof Date && Number.isFinite(doc.localTime.getTime()) ? doc.localTime.getTime() : null;
    const uncertainty = serverTimeMs === null ? null : roundTripMs / 2;
    const offset = serverTimeMs === null ? null : serverTimeMs - (reply.sentAt + roundTripMs / 2);
    let topology = 'standalone';
    if (doc.msg === 'isdbgrid') {
        topology = versions !== undefined ? 'documentdbGateway' : 'shardedRouter';
    } else if (doc.serviceId !== undefined) {
        topology = 'loadBalanced';
    } else if (typeof doc.setName === 'string') {
        topology = 'replicaSet';
    }
    const facts: Record<string, unknown> = {
        handshake: request.kind,
        roundTripMs,
        topology,
        hosts: members.slice(0, 32),
        omittedHostCount: Math.max(0, members.length - 32),
        saslSupportedMechs: mechanisms,
        documentdbVersions: strings(versions)
            .slice(0, 8)
            .map((version): string => version.slice(0, 64)),
        compressorsOffered: [...offered],
        compressorsAccepted: accepted,
        serverTime: serverTimeMs === null ? null : new Date(serverTimeMs).toISOString(),
        clockOffsetMs: offset,
        clockUncertaintyMs: uncertainty,
    };
    const writable = typeof doc.isWritablePrimary === 'boolean' ? doc.isWritablePrimary : doc.ismaster;
    if (typeof writable === 'boolean') {
        facts.isWritablePrimary = writable;
    }
    if (doc.msg === 'isdbgrid') {
        facts.msg = 'isdbgrid';
    }
    for (const key of ['setName', 'me', 'primary'] as const) {
        if (typeof doc[key] === 'string') {
            facts[key] = doc[key];
        }
    }
    for (const key of ['minWireVersion', 'maxWireVersion', 'maxBsonObjectSize'] as const) {
        if (typeof doc[key] === 'number' && Number.isFinite(doc[key])) {
            facts[key] = doc[key];
        }
    }
    if (typeof doc.readOnly === 'boolean') {
        facts.readOnly = doc.readOnly;
    }
    const findings: Finding<BuiltInFindingCode>[] = [];
    const selected = offered.find((compressor): boolean => accepted?.includes(compressor) === true);
    if (
        selected !== undefined &&
        !(context.input.availableCompressors ?? ['zlib']).some((compressor): boolean => compressor === selected)
    ) {
        findings.push(
            finding(
                'hello.compressorUnavailable',
                'error',
                { compressor: selected },
                'The driver would sign in and then fail on the first command because the selected compressor is unavailable; remove it from compressors or put zlib first.',
            ),
        );
    }
    const mechanism = options.authMechanism;
    if (
        request.userKnown &&
        doc.saslSupportedMechs !== undefined &&
        (mechanism === 'SCRAM-SHA-1' || mechanism === 'SCRAM-SHA-256'
            ? !strings(doc.saslSupportedMechs).includes(mechanism)
            : mechanism === undefined &&
              !strings(doc.saslSupportedMechs).some(
                  (entry): boolean => entry === 'SCRAM-SHA-1' || entry === 'SCRAM-SHA-256',
              ))
    ) {
        findings.push(
            finding(
                'hello.mechanismNotOffered',
                'warning',
                { ...(mechanism === undefined ? {} : { mechanism }), offered: mechanisms },
                'The server did not offer a SCRAM mechanism compatible with the configured authentication mechanism.',
            ),
        );
    }
    if (offset !== null && uncertainty !== null && Math.abs(offset) > 5 * 60 * 1000 + uncertainty) {
        findings.push(
            finding(
                'hello.clockOffset',
                'info',
                { offsetMs: Math.round(offset), uncertaintyMs: Math.round(uncertainty) },
                'The server clock differs from the local clock by more than five minutes beyond the measurement uncertainty; check the local clock.',
            ),
        );
    }
    let status: CheckOutcome<BuiltInFindingCode>['status'] = 'pass';
    if (findings.some((entry): boolean => entry.severity === 'error')) {
        status = 'fail';
    } else if (findings.some((entry): boolean => entry.severity === 'warning')) {
        status = 'warning';
    }
    return { status, findings, facts };
}

export function createHelloCheck(): Check<RunContext, BuiltInFindingCode> {
    return {
        id: 'hello',
        scope: 'host',
        dependsOn: ['tcp', 'tls'],
        timeout: 'probe',
        run: async (context, signal): Promise<CheckOutcome<BuiltInFindingCode>> => {
            const startedAt = context.io.clock.now();
            const timeout = context.effectiveTimeout('probe').timeoutMs;
            const waitedMs = timeout === null ? null : Math.max(1, timeout - 250);
            const options = resolveNetworkOptions(context).values;
            const target = context.target;
            const connected = context.getResult('tcp', target)?.facts.connectedAddress;
            if (
                !target ||
                !connected ||
                typeof connected !== 'object' ||
                !('address' in connected) ||
                typeof connected.address !== 'string' ||
                !('family' in connected) ||
                (connected.family !== 4 && connected.family !== 6)
            ) {
                return { status: 'skipped', skippedBecause: { reason: 'inputUnavailable' }, findings: [], facts: {} };
            }
            const { host, port } = target;
            const address = connected.address;
            const family = connected.family;
            const addressClass = addressFact({ address, family }).class;
            signal.throwIfAborted();
            const controller = new AbortController();
            let rejectAbort: (reason: unknown) => void = (): void => {};
            const aborted = new Promise<never>((_, reject): void => {
                rejectAbort = reject;
            });
            const onAbort = (): void => {
                controller.abort(signal.reason);
                rejectAbort(signal.reason);
            };
            signal.addEventListener('abort', onAbort, { once: true });
            let timer: unknown;
            let socket: Socket | undefined;
            let receivedBytes = false;
            async function exchange(): Promise<CheckOutcome<BuiltInFindingCode>> {
                const io = context.io.net ?? nodeNet;
                try {
                    let open: (attemptSignal: AbortSignal) => Promise<Socket>;
                    if (options.tls === true) {
                        const ca =
                            options.tlsCAFile === undefined
                                ? undefined
                                : Buffer.from(await (context.io.readFile ?? readFile)(options.tlsCAFile));
                        const pem =
                            options.tlsCertificateKeyFile === undefined
                                ? undefined
                                : Buffer.from(await (context.io.readFile ?? readFile)(options.tlsCertificateKeyFile));
                        controller.signal.throwIfAborted();
                        open = (attemptSignal): Promise<Socket> =>
                            io.connectTls(tlsConnectionOptions(options, host, address, port, attemptSignal, ca, pem));
                    } else {
                        open = (attemptSignal): Promise<Socket> =>
                            io.connect({ host: address, port, family, signal: attemptSignal });
                    }
                    // The connection's connect timeout bounds establishing this socket, not the reply wait.
                    socket = await establishWithin(
                        context,
                        connectionDeadlineMs(context, options.connectTimeoutMS),
                        controller.signal,
                        open,
                    );
                    controller.signal.throwIfAborted();
                } catch (error) {
                    controller.signal.throwIfAborted();
                    if (error instanceof ConnectionTimeoutError) {
                        return {
                            status: 'fail',
                            findings: [connectionTimeoutFinding(context, 'hello', error)],
                            facts: { connectErrorCode: error.code },
                        };
                    }
                    return { status: 'fail', findings: [], facts: { connectErrorCode: errorCode(error) } };
                }
                const request = handshake(context, options);
                const reply = await receiveReply(
                    socket,
                    request,
                    context,
                    controller.signal,
                    (): void => {
                        receivedBytes = true;
                    },
                    options.tls === true,
                );
                return 'failure' in reply
                    ? { status: 'fail', findings: [reply.failure], facts: {} }
                    : success(reply, request, context, options);
            }
            try {
                const deadline =
                    waitedMs === null
                        ? undefined
                        : new Promise<CheckOutcome<BuiltInFindingCode>>((resolve): void => {
                              timer = context.io.clock.setTimeout(
                                  (): void => {
                                      resolve({
                                          status: 'fail',
                                          facts: {},
                                          findings: [
                                              receivedBytes
                                                  ? inconclusive('truncated')
                                                  : finding(
                                                        'hello.noReply',
                                                        'error',
                                                        {
                                                            waitedMs,
                                                            ...(addressClass === undefined ? {} : { addressClass }),
                                                        },
                                                        addressClass === 'loopback'
                                                            ? 'No handshake reply arrived from the local endpoint before the reply deadline; check the local database, container or tunnel.'
                                                            : 'The server sent no handshake reply before the reply deadline.',
                                                    ),
                                          ],
                                      });
                                      controller.abort();
                                  },
                                  Math.max(1, startedAt + waitedMs - context.io.clock.now()),
                              );
                          });
                const operation = exchange();
                return await Promise.race(deadline ? [operation, deadline, aborted] : [operation, aborted]);
            } finally {
                if (timer !== undefined) {
                    context.io.clock.clearTimeout(timer);
                }
                controller.abort();
                socket?.destroy();
                signal.removeEventListener('abort', onAbort);
            }
        },
    };
}
