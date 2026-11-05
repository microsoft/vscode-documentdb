/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createPrivateKey } from 'node:crypto';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createConnectionStringCheck, createTcpCheck, createTlsCheck, runDiagnostics } from '../index.js';
import { nodeNet } from '../io/nodeNet.js';
import { createCertificate } from '../test/certificates.js';

import {
    type BuiltInFindingCode,
    type Check,
    type CheckOutcome,
    type CheckResult,
    type NetIo,
    type NetworkOptions,
    type RunContext,
    type TimeoutProfile,
    type DiagnosticsClock,
} from '../index.js';

const day = 86400000;
const now = Date.now();
const validity = { notBefore: new Date(now - day), notAfter: new Date(now + day) };
const ca = createCertificate({ subjectCN: 'Private Test CA', isCA: true, ...validity });
const trusted = createCertificate({ subjectCN: 'db.test', issuer: ca, dnsNames: ['db.test'], ...validity });
const selfSigned = createCertificate({ subjectCN: 'db.test', dnsNames: ['db.test'], ...validity });
const servers: net.Server[] = [];
const sockets: net.Socket[] = [];

async function listen(server: net.Server): Promise<number> {
    servers.push(server);
    server.on('connection', (socket): void => {
        sockets.push(socket);
        socket.on('error', (): void => {});
    });
    await new Promise<void>((resolve, reject): void => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', (): void => {
            server.removeListener('error', reject);
            resolve();
        });
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Expected TLS address');
    }
    return address.port;
}

async function tlsServer(
    certificate: { cert: string; key: string },
    options: tls.TlsOptions = {},
): Promise<{ server: tls.Server; port: number }> {
    const server = tls.createServer({ ...certificate, ...options });
    server.on('tlsClientError', (): void => {});
    server.on('secureConnection', (socket): void => {
        sockets.push(socket);
    });
    return { server, port: await listen(server) };
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
});

async function runTls(
    port: number,
    options: {
        network?: NetworkOptions;
        host?: string;
        readFile?: (path: string) => Promise<Uint8Array>;
        net?: NetIo;
        clock?: DiagnosticsClock;
        timeoutProfile?: TimeoutProfile;
    } = {},
): Promise<CheckResult<BuiltInFindingCode>> {
    const dns: Check<RunContext, BuiltInFindingCode> = {
        id: 'dns',
        scope: 'host',
        run: async (): Promise<CheckOutcome<BuiltInFindingCode>> => ({
            status: 'pass',
            findings: [],
            facts: { osAddresses: [{ address: '127.0.0.1', family: 4 }] },
        }),
    };
    const run = await runDiagnostics({
        input: {
            connectionString: `mongodb://${options.host ?? 'db.test'}:${port}`,
            networkOptionLayers: [{ origin: 'setting', options: { tls: true, ...options.network } }],
        },
        checks: [createConnectionStringCheck(), dns, createTcpCheck(), createTlsCheck()],
        io: { readFile: options.readFile, net: options.net, clock: options.clock },
        ...(options.timeoutProfile === undefined
            ? { timeouts: { probeTimeoutMs: 2000 } }
            : { timeoutProfile: options.timeoutProfile }),
    });
    return run.results[3];
}

function caFile(path: string): Promise<Uint8Array> {
    if (path !== 'ca.pem') {
        throw new Error('Unexpected file');
    }
    return Promise.resolve(Buffer.from(ca.cert));
}

describe('verification-first TLS probe', (): void => {
    it('trusts a supplied CA, connects by resolved address, preserves SNI and reports public certificate facts', async (): Promise<void> => {
        let servername: string | undefined;
        const { port } = await tlsServer(trusted, {
            SNICallback: (name, callback): void => {
                servername = name;
                callback(null, tls.createSecureContext(trusted));
            },
        });
        const result = await runTls(port, { network: { tlsCAFile: 'ca.pem' }, readFile: caFile });
        expect(result).toMatchObject({
            status: 'pass',
            findings: [],
            facts: {
                protocol: expect.stringMatching(/^TLSv1\./) as unknown,
                cipher: expect.any(String) as unknown,
                caSource: 'tlsCAFile',
                clientCertificateConfigured: false,
                verificationErrorCode: null,
                inspectionOnly: false,
                certificate: {
                    subject: { CN: 'db.test' },
                    subjectAltNames: ['DNS:db.test'],
                    omittedSubjectAltNameCount: 0,
                    issuerChain: [{ CN: 'Private Test CA' }],
                    validFrom: validity.notBefore.toISOString().replace(/\.\d{3}Z$/, '.000Z'),
                    validTo: validity.notAfter.toISOString().replace(/\.\d{3}Z$/, '.000Z'),
                    fingerprint256: expect.any(String) as unknown,
                    selfIssued: false,
                },
            },
        });
        expect(servername).toBe('db.test');
        expect(JSON.stringify(result)).not.toContain('BEGIN');
        expect(JSON.stringify(result)).not.toContain('raw');
    });

    it('keeps self-signed verification failure while collecting inspection-only certificate facts', async (): Promise<void> => {
        const { port } = await tlsServer(selfSigned);
        const result = await runTls(port);
        expect(result).toMatchObject({
            status: 'fail',
            findings: [{ code: 'tls.selfSigned', severity: 'error' }],
            facts: {
                verificationErrorCode: 'DEPTH_ZERO_SELF_SIGNED_CERT',
                inspectionOnly: true,
                certificate: { subject: { CN: 'db.test' }, selfIssued: true },
            },
        });
    });

    it('classifies a private issuer without its CA as untrusted', async (): Promise<void> => {
        const { port } = await tlsServer(trusted);
        expect(await runTls(port)).toMatchObject({
            status: 'fail',
            findings: [{ code: 'tls.untrustedIssuer', severity: 'error' }],
            facts: { inspectionOnly: true, certificate: { subject: { CN: 'db.test' } } },
        });
    });

    it('checks the original host name rather than the resolved address', async (): Promise<void> => {
        const wrongName = createCertificate({
            subjectCN: 'other.test',
            dnsNames: ['other.test'],
            issuer: ca,
            ...validity,
        });
        const { port } = await tlsServer(wrongName);
        const result = await runTls(port, { network: { tlsCAFile: 'ca.pem' }, readFile: caFile });
        expect(result).toMatchObject({
            status: 'fail',
            findings: [{ code: 'tls.hostnameMismatch' }],
            facts: {
                verificationErrorCode: 'ERR_TLS_CERT_ALTNAME_INVALID',
                certificate: { subject: { CN: 'other.test' } },
            },
        });
    });

    it.each([
        ['expired', now - 3 * day, now - 2 * day, 'tls.expired'],
        ['future', now + 2 * day, now + 3 * day, 'tls.notYetValid'],
    ] as const)(
        'reports %s certificates with verification-first evidence',
        async (_, from, to, code): Promise<void> => {
            const certificate = createCertificate({
                subjectCN: 'db.test',
                dnsNames: ['db.test'],
                issuer: ca,
                notBefore: new Date(from),
                notAfter: new Date(to),
            });
            const { port } = await tlsServer(certificate);
            const clock: DiagnosticsClock = {
                now: (): number => now,
                setTimeout: (callback, ms): unknown => setTimeout(callback, ms),
                clearTimeout: (handle): void => {
                    clearTimeout(handle as ReturnType<typeof setTimeout>);
                },
            };
            const result = await runTls(port, { network: { tlsCAFile: 'ca.pem' }, readFile: caFile, clock });
            expect(result).toMatchObject({
                status: 'fail',
                findings: [{ code, severity: 'error' }],
                facts: { inspectionOnly: true, certificate: { subject: { CN: 'db.test' } } },
            });
            if (code === 'tls.notYetValid') {
                expect(result.findings[0].data?.localTime).toBe(new Date(now).toISOString());
            }
        },
    );

    it('warns when a configured exception bypasses a self-signed certificate', async (): Promise<void> => {
        const { port } = await tlsServer(selfSigned);
        expect(await runTls(port, { network: { tlsAllowInvalidCertificates: true } })).toMatchObject({
            status: 'warning',
            findings: [
                { code: 'tls.selfSigned', severity: 'warning' },
                { code: 'tls.verificationBypassed', severity: 'info' },
            ],
            facts: {
                inspectionOnly: false,
                verificationErrorCode: 'DEPTH_ZERO_SELF_SIGNED_CERT',
                certificate: { selfIssued: true },
            },
        });
    });

    it.each(['tlsAllowInvalidHostnames', 'tlsInsecure'] as const)(
        'warns about the name mismatch allowed by %s',
        async (option): Promise<void> => {
            const certificate = createCertificate({
                subjectCN: 'other.test',
                dnsNames: ['other.test'],
                issuer: ca,
                ...validity,
            });
            const { port } = await tlsServer(certificate);
            expect(
                await runTls(port, { network: { tlsCAFile: 'ca.pem', [option]: true }, readFile: caFile }),
            ).toMatchObject({
                status: 'warning',
                findings: [
                    { code: 'tls.hostnameMismatch', severity: 'warning' },
                    { code: 'tls.verificationBypassed', severity: 'info' },
                ],
            });
        },
    );

    it('requires positive plaintext evidence to call a server non-TLS', async (): Promise<void> => {
        const port = await listen(
            net.createServer((socket): void => {
                socket.end('HTTP/1.1 200 OK\r\n\r\nplaintext reply');
            }),
        );
        expect(await runTls(port)).toMatchObject({
            status: 'fail',
            findings: [{ code: 'tls.notTlsServer' }],
            facts: { inspectionOnly: false, certificate: null },
        });
    });

    it('classifies a server closing the handshake without a certificate separately from plaintext', async (): Promise<void> => {
        const port = await listen(
            net.createServer((socket): void => {
                socket.destroy();
            }),
        );
        const result = await runTls(port);
        expect(result).toMatchObject({
            status: 'fail',
            findings: [{ code: 'tls.handshakeRejectedByServer' }],
            facts: { certificate: null, inspectionOnly: false },
        });
        expect(result.findings[0].detail.text).toContain('IP access list');
    });

    it('skips without performing a TLS handshake when TLS is off', async (): Promise<void> => {
        const port = await listen(net.createServer());
        const connectTls = vi.fn<NetIo['connectTls']>();
        expect(await runTls(port, { network: { tls: false }, net: { ...nodeNet, connectTls } })).toMatchObject({
            status: 'skipped',
            skippedBecause: { reason: 'notApplicable' },
        });
        expect(connectTls).not.toHaveBeenCalled();
    });

    it('uses the client certificate and encrypted private key without exposing PEM or the passphrase', async (): Promise<void> => {
        const client = createCertificate({ subjectCN: 'test-client', issuer: ca, ...validity });
        const passphrase = 'never-share-test-passphrase';
        const encryptedKey = createPrivateKey(client.key).export({
            type: 'pkcs8',
            format: 'pem',
            cipher: 'aes-256-cbc',
            passphrase,
        });
        let received!: (subject: string | undefined) => void;
        const peer = new Promise<string | undefined>((resolve): void => {
            received = resolve;
        });
        const { server, port } = await tlsServer(trusted, {
            requestCert: true,
            rejectUnauthorized: true,
            ca: ca.cert,
            maxVersion: 'TLSv1.2',
        });
        server.on('secureConnection', (socket): void => {
            received(socket.getPeerCertificate().subject.CN);
        });
        const readFile = vi.fn(async (path: string): Promise<Uint8Array> => {
            if (path === 'ca.pem') {
                return Buffer.from(ca.cert);
            }
            if (path === 'client.pem') {
                return Buffer.from(client.cert + encryptedKey.toString());
            }
            throw new Error('Unexpected file');
        });
        const result = await runTls(port, {
            network: {
                tlsCAFile: 'ca.pem',
                tlsCertificateKeyFile: 'client.pem',
                tlsCertificateKeyFilePassword: passphrase,
            },
            readFile,
        });
        expect(result).toMatchObject({ status: 'pass', facts: { clientCertificateConfigured: true } });
        expect(await peer).toBe('test-client');
        expect(readFile).toHaveBeenCalledWith('client.pem');
        const json = JSON.stringify(result);
        expect(json).not.toContain(passphrase);
        expect(json).not.toContain('-----BEGIN');
        expect(json).not.toContain(client.key);
    });

    it.each(['tlsCAFile', 'tlsCertificateKeyFile'] as const)(
        'fails an unreadable %s without a handshake or error text',
        async (file): Promise<void> => {
            const port = await listen(net.createServer());
            const connectTls = vi.fn<NetIo['connectTls']>();
            const readFile = vi.fn(async (): Promise<never> => {
                throw Object.assign(new Error('secret file path and contents'), { code: 'ENOENT' });
            });
            const result = await runTls(port, {
                network: { [file]: 'private.pem' },
                readFile,
                net: { ...nodeNet, connectTls },
            });
            expect(result).toMatchObject({
                status: 'fail',
                findings: [],
                facts: { fileReadError: { file, code: 'ENOENT' } },
            });
            expect(connectTls).not.toHaveBeenCalled();
            expect(JSON.stringify(result)).not.toContain('secret');
            expect(JSON.stringify(result)).not.toContain('private.pem');
        },
    );

    it('omits SNI for an IP literal while checking its IP SAN', async (): Promise<void> => {
        const certificate = createCertificate({
            subjectCN: 'db.test',
            ipAddresses: ['127.0.0.1'],
            issuer: ca,
            ...validity,
        });
        const { port } = await tlsServer(certificate);
        const connectTls = vi.fn<NetIo['connectTls']>(nodeNet.connectTls);
        expect(
            await runTls(port, {
                host: '127.0.0.1',
                network: { tlsCAFile: 'ca.pem' },
                readFile: caFile,
                net: { ...nodeNet, connectTls },
            }),
        ).toMatchObject({ status: 'pass' });
        expect(connectTls.mock.calls[0][0]).not.toHaveProperty('servername');
    });

    it('caps public SAN facts and counts omitted entries', async (): Promise<void> => {
        const certificate = createCertificate({
            subjectCN: 'db.test',
            dnsNames: ['db.test', ...Array.from({ length: 34 }, (_, index): string => `db${index}.test`)],
            issuer: ca,
            ...validity,
        });
        const { port } = await tlsServer(certificate);
        const result = await runTls(port, { network: { tlsCAFile: 'ca.pem' }, readFile: caFile });
        expect(result).toMatchObject({
            status: 'pass',
            facts: { certificate: { subjectAltNames: expect.any(Array) as unknown, omittedSubjectAltNameCount: 3 } },
        });
        const certificateFacts = result.facts.certificate as { subjectAltNames: string[] };
        expect(certificateFacts.subjectAltNames).toHaveLength(32);
    });

    it('does not replace the first verification failure when inspection also fails', async (): Promise<void> => {
        const port = await listen(net.createServer());
        const connectTls = vi
            .fn<NetIo['connectTls']>()
            .mockRejectedValueOnce(Object.assign(new Error('private verification error'), { code: 'CERT_HAS_EXPIRED' }))
            .mockRejectedValueOnce(Object.assign(new Error('private inspection error'), { code: 'ECONNRESET' }));
        const result = await runTls(port, { net: { ...nodeNet, connectTls } });
        expect(result).toMatchObject({
            status: 'fail',
            findings: [{ code: 'tls.expired' }],
            facts: { certificate: null, inspectionOnly: true, verificationErrorCode: 'CERT_HAS_EXPIRED' },
        });
        expect(connectTls).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(result)).not.toContain('private');
    });
});

describe('S2: the connection connect timeout bounds establishing the TLS socket', (): void => {
    it.each(['default', 'noDiagnosticTimeouts'] as const)(
        'ends a hanging handshake with a connection-sourced timeout (%s profile)',
        async (timeoutProfile): Promise<void> => {
            vi.useFakeTimers();
            const tlsSocket = new net.Socket();
            const io: NetIo = {
                connect: async (): Promise<net.Socket> => new net.Socket(),
                connectTls: ({ signal }): Promise<never> =>
                    new Promise<never>((_, reject): void => {
                        signal.addEventListener(
                            'abort',
                            (): void => {
                                tlsSocket.destroy();
                                reject(new Error('Operation aborted', { cause: signal.reason }));
                            },
                            { once: true },
                        );
                    }),
            };
            const pending = runTls(27017, { net: io, network: { connectTimeoutMS: 5 }, timeoutProfile });
            await vi.advanceTimersByTimeAsync(5);
            expect(await pending).toMatchObject({
                status: 'fail',
                findings: [
                    {
                        code: 'check.timeout',
                        data: { operation: 'tls', timeoutMs: 5, source: 'connection', target: 'db.test:27017' },
                    },
                ],
            });
            expect(tlsSocket.destroyed).toBe(true);
            vi.useRealTimers();
        },
    );
});
