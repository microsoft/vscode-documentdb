/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFileSync } from 'child_process';
import dns from 'dns';
import { EventEmitter } from 'events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { BSON, MongoClient, type MongoClientOptions } from 'mongodb';
import { type LookupFunction, type Socket } from 'net';
import { join } from 'path';
import tls, { type ConnectionOptions, type PeerCertificate, type TLSSocket } from 'tls';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntraDestinationRejectedError } from './oidcAllowedHosts';
import { buildOidcClientConfiguration } from './oidcClientOptions';

const SEED = 'cluster.mongocluster.cosmos.azure.com';
const REJECTED = 'sink.cloudapp.azure.com';
// The driver's SRV parent-domain check rejects unrelated domains itself. A trailing-dot
// record passes that check but is outside both our policy and the narrowed ALLOWED_HOSTS.
const POLLED = 'node.mongocluster.cosmos.azure.com.';
const DUMMY_TOKEN = 'offline-dummy-token-';
const changed = new EventEmitter();

interface Certificates {
    ca: Buffer;
    key: Buffer;
    cert: Buffer;
    wrongNameCert: Buffer;
}

interface Attempt {
    host: string;
    socket: TLSSocket;
    suppliedSession: Buffer | undefined;
    checks: number;
    checkedHost?: string;
    certificate?: PeerCertificate;
    reused?: boolean;
    checkError?: Error;
    tickets: Buffer[];
}

interface Command {
    document: Record<string, unknown>;
    socket: TLSSocket;
}

interface Endpoint {
    server: tls.Server;
    port: number;
    sockets: Set<Socket>;
    chunks: Buffer[];
    commands: Command[];
    payloads: Record<string, unknown>[];
    hello: () => Record<string, unknown>;
    reauthenticate: boolean;
}

let fixtureDirectory: string;
let certificates: Certificates;
let attempts: Attempt[];
let clients: MongoClient[];
let endpoints: Endpoint[];
let lookups: string[];

const lookup: LookupFunction = (hostname, options, callback): void => {
    lookups.push(hostname);
    // Never consult OS DNS, including on an unexpected driver destination.
    if (![SEED, REJECTED, POLLED, ...positiveHosts].includes(hostname)) {
        callback(new Error(`Unexpected offline hostname: ${hostname}`), '', 4);
        return;
    }
    callback(null, options.all ? [{ address: '127.0.0.1', family: 4 }] : '127.0.0.1', 4);
};

const positiveHosts = [
    SEED,
    'global.cluster.mongocluster.cosmos.azure.us',
    'fc-cluster-000.privatelink.mongocluster.cosmos.azure.cn',
    'cluster.trusted.example',
];

/** Event-driven waits: the deadline only fails a stuck test, never establishes non-delivery. */
async function until(predicate: () => boolean, description: string): Promise<void> {
    if (predicate()) {
        return;
    }
    await new Promise<void>((resolve, reject) => {
        const check = (): void => {
            if (predicate()) {
                clearTimeout(deadline);
                changed.removeListener('change', check);
                resolve();
            }
        };
        const deadline = setTimeout(() => {
            changed.removeListener('change', check);
            reject(new Error(`Offline driver did not reach: ${description}`));
        }, 5_000);
        changed.on('change', check);
        check();
    });
}

function notify(): void {
    changed.emit('change');
}

function useSrv(records: () => dns.SrvRecord[]): void {
    vi.mocked(dns.promises.resolve).mockImplementation((async (
        hostname: string,
        rrtype: string,
    ): Promise<dns.SrvRecord[] | string[][]> => {
        expect(hostname).toBe(rrtype === 'TXT' ? SEED : `_mongodb._tcp.${SEED}`);
        if (rrtype === 'TXT') {
            return [[]];
        }
        expect(rrtype).toBe('SRV');
        return records();
    }) as typeof dns.promises.resolve);
}

function hello(): Record<string, unknown> {
    return {
        ok: 1,
        ismaster: true,
        isWritablePrimary: true,
        helloOk: true,
        minWireVersion: 0,
        maxWireVersion: 25,
        maxBsonObjectSize: 16_777_216,
        maxMessageSizeBytes: 48_000_000,
        maxWriteBatchSize: 100_000,
    };
}

function capturePayload(endpoint: Endpoint, command: Record<string, unknown>): void {
    if (command.payload instanceof BSON.Binary) {
        endpoint.payloads.push(BSON.deserialize(command.payload.value()));
    }
}

function respond(endpoint: Endpoint, socket: TLSSocket, message: Buffer): void {
    const opcode = message.readInt32LE(12);
    let offset: number;
    if (opcode === 2004) {
        offset = message.indexOf(0, 20) + 9; // OP_QUERY: namespace, skip, return count.
    } else if (opcode === 2013 && message[20] === 0) {
        offset = 21; // OP_MSG: flags and a single body section.
    } else {
        throw new Error(`Unexpected offline wire opcode: ${opcode}`);
    }
    const document: Record<string, unknown> = BSON.deserialize(message.subarray(offset));
    endpoint.commands.push({ document, socket });
    let reply: Record<string, unknown>;
    if (document.ismaster || document.hello) {
        reply = endpoint.hello();
        const speculative = document.speculativeAuthenticate;
        if (typeof speculative === 'object' && speculative !== null) {
            capturePayload(endpoint, speculative as Record<string, unknown>);
            reply.speculativeAuthenticate = { ok: 1, conversationId: 1, done: true };
        }
    } else if (document.saslStart || document.saslContinue) {
        capturePayload(endpoint, document);
        reply = { ok: 1, conversationId: 1, done: true, payload: new BSON.Binary() };
    } else if (document.ping && endpoint.reauthenticate) {
        endpoint.reauthenticate = false;
        reply = { ok: 0, code: 391, errmsg: 'Offline fixture requires reauthentication' };
    } else {
        reply = { ok: 1 };
    }
    const body = BSON.serialize(reply);
    const header = Buffer.alloc(opcode === 2004 ? 36 : 21);
    header.writeInt32LE(header.length + body.length, 0);
    header.writeInt32LE(1, 4);
    header.writeInt32LE(message.readInt32LE(4), 8);
    header.writeInt32LE(opcode === 2004 ? 1 : 2013, 12);
    if (opcode === 2004) {
        header.writeInt32LE(1, 32);
    }
    socket.write(Buffer.concat([header, body]));
    notify();
}

async function startEndpoint(wrongName: boolean = false, port: number = 0): Promise<Endpoint> {
    const server = tls.createServer({
        key: certificates.key,
        cert: wrongName ? certificates.wrongNameCert : certificates.cert,
        // Both endpoints can accept the same TLS tickets, so a cross-host resumption would
        // really bypass Node's identity callback. The driver must not supply a session.
        ticketKeys: Buffer.alloc(48, 7),
        minVersion: 'TLSv1.3',
        maxVersion: 'TLSv1.3',
    });
    const endpoint: Endpoint = {
        server,
        port: 0,
        sockets: new Set(),
        chunks: [],
        commands: [],
        payloads: [],
        hello,
        reauthenticate: false,
    };
    endpoints.push(endpoint);
    server.on('connection', (socket: Socket): void => {
        endpoint.sockets.add(socket);
        socket.on('error', notify);
        socket.on('close', (): void => {
            endpoint.sockets.delete(socket);
            notify();
        });
        notify();
    });
    server.on('tlsClientError', notify);
    server.on('secureConnection', (socket: TLSSocket): void => {
        let pending: Buffer = Buffer.alloc(0);
        socket.on('error', notify);
        socket.on('data', (chunk: Buffer): void => {
            endpoint.chunks.push(Buffer.from(chunk));
            pending = Buffer.concat([pending, chunk]);
            while (pending.length >= 4 && pending.length >= pending.readInt32LE(0)) {
                const length = pending.readInt32LE(0);
                if (length < 16 || length > 1_000_000) {
                    throw new Error(`Unexpected offline frame length: ${length}`);
                }
                respond(endpoint, socket, pending.subarray(0, length));
                pending = pending.subarray(length);
            }
            notify();
        });
        notify();
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Offline TLS server has no port');
    }
    endpoint.port = address.port;
    return endpoint;
}

function makeClient(
    connectionString: string,
    callback: () => Promise<{ accessToken: string }>,
    baseOptions: MongoClientOptions = {},
): MongoClient {
    const configuration = buildOidcClientConfiguration({
        connectionString,
        oidcCallback: callback,
        customHostnameSuffix: 'trusted.example',
        baseOptions,
    });
    const client = new MongoClient(configuration.connectionString, {
        ...configuration.options,
        // Fixture trust is deliberately applied after the production builder.
        ca: certificates.ca,
        lookup,
        family: 4,
        heartbeatFrequencyMS: 500,
        serverMonitoringMode: 'poll',
        serverSelectionTimeoutMS: 5_000,
        connectTimeoutMS: 2_000,
        maxPoolSize: 1,
        retryReads: false,
        retryWrites: false,
    });
    clients.push(client);
    return client;
}

async function closeClient(client: MongoClient): Promise<void> {
    await client.close();
    await until(
        () =>
            attempts.every((attempt) => attempt.socket.closed) && endpoints.every((endpoint) => !endpoint.sockets.size),
        'all client and server sockets closed',
    );
}

function expectNoApplicationData(endpoint: Endpoint): void {
    // TLS 1.3 can complete the server-side handshake before the client rejects identity.
    // Only decrypted application bytes and tokens are the security assertion.
    expect(Buffer.concat(endpoint.chunks)).toHaveLength(0);
    expect(endpoint.commands).toEqual([]);
    expect(endpoint.payloads).toEqual([]);
    expect(Buffer.concat(endpoint.chunks).includes(Buffer.from(DUMMY_TOKEN))).toBe(false);
}

function expectFreshIdentityChecks(host: string, minimum: number): void {
    const matching = attempts.filter((attempt) => attempt.host === host);
    expect(matching.length).toBeGreaterThanOrEqual(minimum);
    for (const attempt of matching) {
        expect(attempt.suppliedSession).toBeUndefined();
        expect(attempt.reused).toBe(false);
        expect(attempt.checks).toBe(1);
        expect(attempt.checkedHost).toBe(host);
    }
}

beforeAll((): void => {
    fixtureDirectory = mkdtempSync('.oidc-destination-harness-');
    const run = (...args: string[]): void => {
        // Missing openssl is a test failure, not a skipped security proof.
        execFileSync('openssl', args, { cwd: fixtureDirectory, stdio: 'pipe' });
    };
    try {
        run(
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-days',
            '1',
            '-subj',
            '/CN=Offline driver harness CA',
            '-keyout',
            'ca.key',
            '-out',
            'ca.pem',
        );
        run(
            'req',
            '-new',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-subj',
            '/CN=Offline driver harness',
            '-keyout',
            'leaf.key',
            '-out',
            'leaf.csr',
        );
        for (const [name, hosts] of [
            ['leaf', [...positiveHosts, REJECTED, POLLED]],
            ['wrong-name', ['wrong.example']],
        ] as const) {
            writeFileSync(
                join(fixtureDirectory, `${name}.ext`),
                `basicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\nsubjectAltName=${hosts.map((host) => `DNS:${host}`).join(',')}\n`,
            );
            run(
                'x509',
                '-req',
                '-days',
                '1',
                '-in',
                'leaf.csr',
                '-CA',
                'ca.pem',
                '-CAkey',
                'ca.key',
                '-CAcreateserial',
                '-extfile',
                `${name}.ext`,
                '-out',
                `${name}.pem`,
            );
        }
        certificates = {
            ca: readFileSync(join(fixtureDirectory, 'ca.pem')),
            key: readFileSync(join(fixtureDirectory, 'leaf.key')),
            cert: readFileSync(join(fixtureDirectory, 'leaf.pem')),
            wrongNameCert: readFileSync(join(fixtureDirectory, 'wrong-name.pem')),
        };
    } catch (error) {
        rmSync(fixtureDirectory, { recursive: true, force: true });
        throw error;
    }
});

beforeEach((): void => {
    attempts = [];
    clients = [];
    endpoints = [];
    lookups = [];
    vi.spyOn(dns.promises, 'resolve').mockImplementation(async (hostname): Promise<never> => {
        throw new Error(`Unexpected offline DNS query: ${hostname}`);
    });
    const originalConnect = tls.connect;
    // The installed CommonJS driver calls tls.connect(options). Observe the real socket
    // boundary, not a second invocation of the policy predicate in test code.
    vi.spyOn(tls, 'connect').mockImplementation(((options: ConnectionOptions): TLSSocket => {
        const identity = options.checkServerIdentity;
        const socket = originalConnect({
            ...options,
            checkServerIdentity: (host, certificate): Error | undefined => {
                attempt.checks += 1;
                attempt.checkedHost = host;
                attempt.certificate = certificate;
                attempt.reused = socket.isSessionReused();
                attempt.checkError = identity?.(host, certificate);
                notify();
                return attempt.checkError;
            },
        });
        const attempt: Attempt = {
            host: options.servername ?? '',
            socket,
            suppliedSession: options.session,
            checks: 0,
            tickets: [],
        };
        attempts.push(attempt);
        socket.on('secureConnect', (): void => {
            attempt.reused = socket.isSessionReused();
            notify();
        });
        socket.on('session', (session: Buffer): void => {
            attempt.tickets.push(session);
            notify();
        });
        socket.on('error', notify);
        socket.on('close', notify);
        return socket;
    }) as typeof tls.connect);
});

afterEach(async (): Promise<void> => {
    try {
        const closed = await Promise.allSettled(clients.map(async (client): Promise<void> => client.close()));
        for (const endpoint of endpoints) {
            for (const socket of endpoint.sockets) {
                socket.destroy();
            }
        }
        for (const attempt of attempts) {
            attempt.socket.destroy();
        }
        await Promise.all(
            endpoints.map(
                async ({ server }): Promise<void> => new Promise<void>((resolve) => server.close(() => resolve())),
            ),
        );
        await until(
            () =>
                attempts.every((attempt) => attempt.socket.closed) &&
                endpoints.every((endpoint) => endpoint.sockets.size === 0),
            'teardown closed every socket',
        );
        expect(closed.every((result) => result.status === 'fulfilled')).toBe(true);
    } finally {
        vi.restoreAllMocks();
        changed.removeAllListeners();
    }
});

afterAll((): void => {
    if (fixtureDirectory) {
        rmSync(fixtureDirectory, { recursive: true, force: true });
    }
});

describe('offline OIDC destination protocol (real installed driver and TLS)', (): void => {
    it.each(positiveHosts)('authenticates %s with only the intended dummy token', async (host): Promise<void> => {
        const endpoint = await startEndpoint();
        const callback = vi.fn(async (): Promise<{ accessToken: string }> => ({ accessToken: `${DUMMY_TOKEN}1` }));
        const client = makeClient(`mongodb://${host}:${endpoint.port}/?directConnection=true`, callback);

        await client.connect();
        await client.db().command({ ping: 1 });
        await until(() => attempts.some((attempt) => attempt.tickets.length > 0), 'TLS session ticket issued');
        await closeClient(client);

        expect(callback).toHaveBeenCalledTimes(1);
        expect(endpoint.payloads).toEqual([{ jwt: `${DUMMY_TOKEN}1` }]);
        expectFreshIdentityChecks(host, 2); // Monitoring and authenticated pool sockets.
        expect(attempts.every((attempt) => attempt.socket.authorized)).toBe(true);
        expect(lookups.every((hostname) => hostname === host)).toBe(true);
    });

    it.each([
        REJECTED,
        'unrelated.example',
        'cluster.mongocluster.cosmos.azure.com.evil.example',
        '127.0.0.1',
        `${SEED}.`,
        `${SEED},${REJECTED}`,
        `${REJECTED},${SEED}`,
        'not a connection string',
    ])('extension rejects %s before invoking the provider or driver', (hosts): void => {
        const callback = vi.fn(async (): Promise<{ accessToken: string }> => ({ accessToken: `${DUMMY_TOKEN}1` }));
        const uri = hosts === 'not a connection string' ? hosts : `mongodb://${hosts}/`;

        expect(() => makeClient(uri, callback)).toThrow(EntraDestinationRejectedError);
        expect(callback).not.toHaveBeenCalled();
        expect(attempts).toEqual([]);
        expect(lookups).toEqual([]);
    });

    it('driver ALLOWED_HOSTS rejects an out-of-policy SRV seed even with case-duplicate ENVIRONMENT', async (): Promise<void> => {
        const endpoint = await startEndpoint();
        useSrv(() => [{ name: POLLED, port: endpoint.port, priority: 0, weight: 0 }]);
        const callback = vi.fn(async (): Promise<{ accessToken: string }> => ({ accessToken: `${DUMMY_TOKEN}1` }));
        const client = makeClient(
            `mongodb+srv://${SEED}/?authMechanismProperties=ENVIRONMENT:azure,TOKEN_RESOURCE:untrusted` +
                '&AUTHMECHANISMPROPERTIES=ENVIRONMENT:azure,TOKEN_RESOURCE:untrusted',
            callback,
        );

        expect(client.options.credentials?.mechanismProperties.ENVIRONMENT).toBeUndefined();
        expect(client.options.credentials?.mechanismProperties.ALLOWED_HOSTS).toEqual([
            '*.mongocluster.cosmos.azure.com',
        ]);
        await expect(client.connect()).rejects.toThrow(/not valid for OIDC authentication with ALLOWED_HOSTS/);
        await closeClient(client);

        expect(callback).not.toHaveBeenCalled();
        expect(attempts).toEqual([]); // Driver's seed guard, not TLS or server selection.
        expect(lookups).toEqual([]);
        expectNoApplicationData(endpoint);
    });

    const bypasses = [
        ['tls', false],
        ['ssl', false],
        ['tlsInsecure', true],
        ['tlsAllowInvalidCertificates', true],
        ['tlsAllowInvalidHostnames', true],
        ['sslInsecure', true],
        ['sslAllowInvalidCertificates', true],
        ['sslAllowInvalidHostnames', true],
        ['sslValidate', false],
        ['rejectUnauthorized', false],
    ] as const;

    it.each(bypasses)(
        'saved %s=%s cannot disable certificate or hostname validation',
        async (key, value): Promise<void> => {
            // Each spelling is removed by the builder before reaching the real driver parser;
            // legacy ssl* spellings are not all accepted by the installed driver's raw parser.
            for (const failure of ['hostname', 'chain'] as const) {
                const startIndex = attempts.length;
                const endpoint = await startEndpoint(failure === 'hostname');
                const callback = vi.fn(
                    async (): Promise<{ accessToken: string }> => ({ accessToken: `${DUMMY_TOKEN}1` }),
                );
                const client = makeClient(
                    `mongodb://${SEED}:${endpoint.port}/?directConnection=true&${key}=${value}&${key.toUpperCase()}=${value}`,
                    callback,
                    { [key]: value },
                );
                if (failure === 'chain') {
                    client.options.ca = []; // The generated CA is deliberately not trusted.
                }
                let heartbeatFailure: Error | undefined;
                client.once('serverHeartbeatFailed', (event): void => {
                    heartbeatFailure = event.failure;
                    notify();
                });
                const connecting = client.connect().catch((error: unknown): unknown => error);
                await until(() => heartbeatFailure !== undefined, 'certificate rejected by real driver heartbeat');
                await closeClient(client);
                await connecting;

                expect(client.options.tls).toBe(true);
                expect(client.options.rejectUnauthorized).toBe(true);
                expect(heartbeatFailure?.message).toMatch(
                    failure === 'hostname' ? /altnames|certificate.*name/i : /certificate|self.signed/i,
                );
                expect(callback).not.toHaveBeenCalled();
                expectNoApplicationData(endpoint);
                const matching = attempts.slice(startIndex);
                expect(matching.length).toBeGreaterThan(0);
                for (const attempt of matching) {
                    expect(attempt.host).toBe(SEED);
                    expect(attempt.checks).toBe(failure === 'hostname' ? 1 : 0);
                    expect(attempt.suppliedSession).toBeUndefined();
                }
            }
        },
    );

    it.each([
        { refresh: false, wrongName: false },
        { refresh: true, wrongName: false },
        { refresh: true, wrongName: true },
    ])(
        'rejects hello discovery and repeated reconnects ($refresh refresh, $wrongName wrong certificate)',
        async ({ refresh, wrongName }): Promise<void> => {
            const seed = await startEndpoint();
            const rejected = await startEndpoint(wrongName);
            const seedAddress = `${SEED}:${seed.port}`;
            const rejectedAddress = `${REJECTED}:${rejected.port}`;
            let advertiseRejected = false;
            seed.hello = (): Record<string, unknown> => ({
                ...hello(),
                setName: 'offline',
                hosts: advertiseRejected ? [seedAddress, rejectedAddress] : [seedAddress],
                primary: seedAddress,
                me: seedAddress,
            });
            const callback = vi.fn(
                async (): Promise<{ accessToken: string }> => ({
                    accessToken: `${DUMMY_TOKEN}${callback.mock.calls.length}`,
                }),
            );
            const client = makeClient(`mongodb://${seedAddress}/?replicaSet=offline`, callback);
            await client.connect();
            if (refresh) {
                seed.reauthenticate = true;
                await client.db().command({ ping: 1 });
            }
            const expectedCalls = refresh ? 2 : 1;
            expect(callback).toHaveBeenCalledTimes(expectedCalls);
            await until(
                () => attempts.some((attempt) => attempt.tickets.length > 0),
                'allowed server issued resumable tickets',
            );

            advertiseRejected = true;
            // Exercise real reconnects of the established client, not a second MongoClient.
            for (const socket of seed.sockets) {
                socket.destroy();
            }
            await until(
                () => attempts.filter((attempt) => attempt.host === REJECTED && attempt.socket.closed).length >= 2,
                'discovered member rejected on two independent socket attempts',
            );
            await closeClient(client);

            expectNoApplicationData(rejected);
            expect(callback).toHaveBeenCalledTimes(expectedCalls);
            expect(seed.payloads).toContainEqual({ jwt: `${DUMMY_TOKEN}1` });
            if (refresh) {
                expect(seed.payloads).toContainEqual({ jwt: `${DUMMY_TOKEN}2` });
            }
            expectFreshIdentityChecks(SEED, 3);
            expectFreshIdentityChecks(REJECTED, 2);
            for (const attempt of attempts.filter((attempt) => attempt.host === REJECTED)) {
                expect(attempt.checkError).toBeInstanceOf(EntraDestinationRejectedError);
                expect(attempt.certificate).toBeDefined();
                const ordinaryCheck = tls.checkServerIdentity(REJECTED, attempt.certificate!);
                if (wrongName) {
                    expect(ordinaryCheck).toBeInstanceOf(Error); // Policy rejection must precede the hostname error.
                } else {
                    expect(ordinaryCheck).toBeUndefined(); // A genuinely valid certificate cannot authorize this host.
                }
            }
        },
    );

    it('revalidates the certificate on reconnect before transmitting the refreshed cached token', async (): Promise<void> => {
        const seed = await startEndpoint();
        const callback = vi.fn(
            async (): Promise<{ accessToken: string }> => ({
                accessToken: `${DUMMY_TOKEN}${callback.mock.calls.length}`,
            }),
        );
        const client = makeClient(`mongodb://${SEED}:${seed.port}/?directConnection=true`, callback);
        await client.connect();
        seed.reauthenticate = true;
        await client.db().command({ ping: 1 });
        expect(seed.payloads).toEqual([{ jwt: `${DUMMY_TOKEN}1` }, { jwt: `${DUMMY_TOKEN}2` }]);
        await until(() => attempts.some((attempt) => attempt.tickets.length > 0), 'session tickets before reconnect');

        const stopped = new Promise<void>((resolve) => seed.server.close(() => resolve()));
        for (const socket of seed.sockets) {
            socket.destroy();
        }
        await stopped;
        // Same requested hostname and port, but now a different TLS identity answers.
        const replacement = await startEndpoint(true, seed.port);
        const reconnectStart = attempts.length;
        await until(
            () =>
                attempts
                    .slice(reconnectStart)
                    .filter((attempt) => attempt.checkError !== undefined && attempt.socket.closed).length >= 2,
            'replacement rejected on two reconnect sockets',
        );
        await closeClient(client);

        expect(callback).toHaveBeenCalledTimes(2);
        expectNoApplicationData(replacement);
        for (const attempt of attempts.slice(reconnectStart)) {
            expect(attempt.host).toBe(SEED);
            expect(attempt.checks).toBe(1);
            expect(attempt.suppliedSession).toBeUndefined();
            expect(attempt.reused).toBe(false);
            expect(attempt.checkError).not.toBeInstanceOf(EntraDestinationRejectedError);
            expect(attempt.checkError).toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
        }
    });

    it('later real SRV polling cannot send a cached refreshed token outside policy', async (): Promise<void> => {
        const seed = await startEndpoint();
        const rejected = await startEndpoint();
        seed.hello = (): Record<string, unknown> => ({ ...hello(), msg: 'isdbgrid' });
        let includeRejected = false;
        useSrv(() => [
            { name: SEED, port: seed.port, priority: 0, weight: 0 },
            ...(includeRejected ? [{ name: POLLED, port: rejected.port, priority: 0, weight: 0 }] : []),
        ]);
        const callback = vi.fn(
            async (): Promise<{ accessToken: string }> => ({
                accessToken: `${DUMMY_TOKEN}${callback.mock.calls.length}`,
            }),
        );
        const client = makeClient(`mongodb+srv://${SEED}/`, callback);
        await client.connect();
        seed.reauthenticate = true;
        await client.db().command({ ping: 1 });
        expect(callback).toHaveBeenCalledTimes(2);
        expect(seed.payloads).toEqual([{ jwt: `${DUMMY_TOKEN}1` }, { jwt: `${DUMMY_TOKEN}2` }]);

        // Upgrade-sensitive seam: mongodb 7.2's internal SrvPoller normally waits 60 s.
        // Only shorten its interval; retain the driver's actual DNS polling, parent-domain
        // validation, discovery event, topology update, socket creation and TLS validation.
        const internal = client as unknown as {
            topology: { s: { srvPoller: { rescanSrvIntervalMS: number; stop(): void; start(): void } } };
        };
        const poller = internal.topology.s.srvPoller;
        includeRejected = true;
        poller.stop();
        poller.rescanSrvIntervalMS = 25;
        poller.start();
        await until(
            () => attempts.filter((attempt) => attempt.host === POLLED && attempt.socket.closed).length >= 2,
            'later SRV member rejected on independent reconnects',
        );
        await closeClient(client);

        expect(
            vi.mocked(dns.promises.resolve).mock.calls.filter(([, rrtype]) => rrtype === 'SRV').length,
        ).toBeGreaterThan(1);
        expectNoApplicationData(rejected);
        expect(callback).toHaveBeenCalledTimes(2);
        expectFreshIdentityChecks(POLLED, 2);
        for (const attempt of attempts.filter((attempt) => attempt.host === POLLED)) {
            expect(attempt.checkError).toBeInstanceOf(EntraDestinationRejectedError);
            expect(attempt.certificate).toBeDefined();
            expect(tls.checkServerIdentity(POLLED, attempt.certificate!)).toBeUndefined();
        }
    });
});
