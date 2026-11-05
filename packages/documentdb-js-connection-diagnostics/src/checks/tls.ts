/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as tls from 'node:tls';

import { nodeNet, readFile } from '../io/nodeNet.js';
import { resolveNetworkOptions } from '../networkOptions.js';
import {
    ConnectionTimeoutError,
    connectionDeadlineMs,
    connectionTimeoutFinding,
    establishWithin,
} from './connectionDeadline.js';
import { tlsConnectionOptions } from './tlsOptions.js';

import { type BuiltInFindingCode } from '../findingCodes.js';
import { type Check, type CheckOutcome, type Finding, type FindingSeverity, type RunContext } from '../types.js';

interface CertificateName {
    readonly CN?: string;
    readonly O?: string;
}

interface CertificateFacts {
    readonly subject: CertificateName;
    readonly subjectAltNames: readonly string[];
    readonly omittedSubjectAltNameCount: number;
    readonly issuerChain: readonly CertificateName[];
    readonly validFrom: string | null;
    readonly validTo: string | null;
    readonly fingerprint256: string;
    readonly selfIssued: boolean;
}

function finding(
    code: BuiltInFindingCode,
    severity: FindingSeverity,
    data: Readonly<Record<string, unknown>>,
    text: string,
): Finding<BuiltInFindingCode> {
    return { code, severity, data, detail: { language: 'en', text } };
}

function errorCode(error: unknown): string {
    const code =
        typeof error === 'string'
            ? error
            : error && typeof error === 'object' && 'code' in error
              ? error.code
              : undefined;
    return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : 'unknown';
}

function verificationFinding(
    code: string,
    severity: FindingSeverity,
    context: RunContext,
): Finding<BuiltInFindingCode> | undefined {
    const data = { errorCode: code };
    switch (code) {
        case 'DEPTH_ZERO_SELF_SIGNED_CERT':
        case 'SELF_SIGNED_CERT_IN_CHAIN':
            return finding(
                'tls.selfSigned',
                severity,
                data,
                'The server certificate is self-signed or its chain contains a self-signed certificate.',
            );
        case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
        case 'UNABLE_TO_GET_ISSUER_CERT':
        case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
            return finding(
                'tls.untrustedIssuer',
                severity,
                data,
                'The server certificate issuer is not trusted; check the CA bundle or corporate TLS inspection configuration.',
            );
        case 'ERR_TLS_CERT_ALTNAME_INVALID':
            return finding(
                'tls.hostnameMismatch',
                severity,
                data,
                'The server certificate does not match the original host name.',
            );
        case 'CERT_HAS_EXPIRED':
            return finding('tls.expired', severity, data, 'The server certificate has expired.');
        case 'CERT_NOT_YET_VALID':
            return finding(
                'tls.notYetValid',
                severity,
                { ...data, localTime: new Date(context.io.clock.now()).toISOString() },
                'The server certificate is not yet valid; check the local clock and the certificate validity dates.',
            );
        default:
            return undefined;
    }
}

function plaintextReply(error: unknown): boolean {
    if (['ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_SSL_PACKET_LENGTH_TOO_LONG'].includes(errorCode(error))) {
        return true;
    }
    if (!error || typeof error !== 'object') {
        return false;
    }
    const reason = 'reason' in error ? error.reason : undefined;
    const library = 'library' in error ? error.library : undefined;
    return (
        typeof library === 'string' &&
        /SSL|TLS/i.test(library) &&
        typeof reason === 'string' &&
        ['wrong version number', 'packet length too long'].includes(reason.toLowerCase())
    );
}

function certificateName(name: tls.Certificate): CertificateName {
    const commonName = name.CN;
    const organization = name.O;
    return {
        ...(typeof commonName === 'string' ? { CN: commonName } : {}),
        ...(typeof organization === 'string' ? { O: organization } : {}),
    };
}

function isoDate(value: string): string | null {
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function certificateFacts(cert: tls.DetailedPeerCertificate | undefined): CertificateFacts | null {
    if (!cert?.subject || !cert.issuer || typeof cert.fingerprint256 !== 'string') {
        return null;
    }
    // Node quotes SAN values containing commas; keep those entries together.
    const names = cert.subjectaltname?.match(/(?:[^,"]|"(?:[^"\\]|\\.)*")+/g)?.map((name): string => name.trim()) ?? [];
    const issuerChain: CertificateName[] = [];
    const seen = new Set([cert.fingerprint256]);
    let current = cert;
    while (issuerChain.length < 8) {
        const issuer = current.issuerCertificate;
        if (!issuer?.subject || typeof issuer.fingerprint256 !== 'string') {
            issuerChain.push(certificateName(current.issuer));
            break;
        }
        if (seen.has(issuer.fingerprint256)) {
            // A self-issued leaf has no separate issuer object to add.
            if (issuerChain.length === 0) {
                issuerChain.push(certificateName(issuer.subject));
            }
            break;
        }
        issuerChain.push(certificateName(issuer.subject));
        seen.add(issuer.fingerprint256);
        current = issuer;
    }
    const subjectKeys = Object.keys(cert.subject) as (keyof tls.Certificate)[];
    const issuerKeys = Object.keys(cert.issuer);
    return {
        subject: certificateName(cert.subject),
        subjectAltNames: names.slice(0, 32),
        omittedSubjectAltNameCount: Math.max(0, names.length - 32),
        issuerChain,
        validFrom: isoDate(cert.valid_from),
        validTo: isoDate(cert.valid_to),
        fingerprint256: cert.fingerprint256,
        selfIssued:
            subjectKeys.length === issuerKeys.length &&
            subjectKeys.every((key): boolean => JSON.stringify(cert.subject[key]) === JSON.stringify(cert.issuer[key])),
    };
}

function errorCertificate(error: unknown): tls.DetailedPeerCertificate | undefined {
    if (
        error &&
        typeof error === 'object' &&
        'cert' in error &&
        error.cert &&
        typeof error.cert === 'object' &&
        'subject' in error.cert &&
        'issuer' in error.cert &&
        'fingerprint256' in error.cert
    ) {
        return error.cert as tls.DetailedPeerCertificate;
    }
    return undefined;
}

export function createTlsCheck(): Check<RunContext, BuiltInFindingCode> {
    return {
        id: 'tls',
        scope: 'host',
        dependsOn: ['tcp'],
        timeout: 'probe',
        run: async (context, signal): Promise<CheckOutcome<BuiltInFindingCode>> => {
            const options = resolveNetworkOptions(context).values;
            if (options.tls !== true) {
                return { status: 'skipped', skippedBecause: { reason: 'notApplicable' }, findings: [], facts: {} };
            }
            const connected: unknown = context.getResult('tcp', context.target)?.facts.connectedAddress;
            if (
                !context.target ||
                !connected ||
                typeof connected !== 'object' ||
                !('address' in connected) ||
                typeof connected.address !== 'string' ||
                !('family' in connected) ||
                (connected.family !== 4 && connected.family !== 6)
            ) {
                return { status: 'skipped', skippedBecause: { reason: 'inputUnavailable' }, findings: [], facts: {} };
            }
            signal.throwIfAborted();
            const facts: Record<string, unknown> = {
                protocol: null,
                cipher: null,
                caSource: options.tlsCAFile === undefined ? 'system' : 'tlsCAFile',
                clientCertificateConfigured: options.tlsCertificateKeyFile !== undefined,
                verificationErrorCode: null,
                inspectionOnly: false,
                certificate: null,
            };
            let ca: Buffer | undefined;
            let clientPem: Buffer | undefined;
            for (const file of ['tlsCAFile', 'tlsCertificateKeyFile'] as const) {
                const path = options[file];
                if (path === undefined) {
                    continue;
                }
                try {
                    const contents = Buffer.from(await (context.io.readFile ?? readFile)(path));
                    signal.throwIfAborted();
                    if (file === 'tlsCAFile') {
                        ca = contents;
                    } else {
                        clientPem = contents;
                    }
                } catch (error) {
                    signal.throwIfAborted();
                    return {
                        status: 'fail',
                        findings: [],
                        facts: { ...facts, fileReadError: { file, code: errorCode(error) } },
                    };
                }
            }
            const host = context.target.host;
            const connectionOptions = tlsConnectionOptions(
                options,
                host,
                connected.address,
                context.target.port,
                signal,
                ca,
                clientPem,
            );
            const io = context.io.net ?? nodeNet;
            const findings: Finding<BuiltInFindingCode>[] = [];
            function collect(socket: tls.TLSSocket): void {
                facts.protocol = socket.getProtocol() ?? null;
                facts.cipher = socket.getCipher()?.name ?? null;
                facts.certificate = certificateFacts(socket.getPeerCertificate(true));
            }
            const deadlineMs = connectionDeadlineMs(context, options.connectTimeoutMS);
            function connect(overrides: Partial<tls.ConnectionOptions> = {}): Promise<tls.TLSSocket> {
                // Each new socket gets the connection's connect timeout, as a driver connection would.
                return establishWithin(
                    context,
                    deadlineMs,
                    signal,
                    (attemptSignal): Promise<tls.TLSSocket> =>
                        io.connectTls({ ...connectionOptions, ...overrides, signal: attemptSignal }),
                );
            }
            let socket: tls.TLSSocket | undefined;
            let failed = false;
            try {
                socket = await connect();
                signal.throwIfAborted();
                collect(socket);
                const code = socket.authorized === false ? errorCode(socket.authorizationError) : null;
                if (code !== null) {
                    facts.verificationErrorCode = code;
                    const problem = verificationFinding(code, 'warning', context);
                    if (problem) {
                        findings.push(problem);
                    }
                }
                if (options.tlsAllowInvalidHostnames || options.tlsInsecure) {
                    const cert = socket.getPeerCertificate(true);
                    if (cert?.subject && tls.checkServerIdentity(host, cert)) {
                        if (!findings.some((entry): boolean => entry.code === 'tls.hostnameMismatch')) {
                            const mismatch = verificationFinding('ERR_TLS_CERT_ALTNAME_INVALID', 'warning', context);
                            if (mismatch) {
                                findings.push(mismatch);
                            }
                        }
                        facts.verificationErrorCode ??= 'ERR_TLS_CERT_ALTNAME_INVALID';
                    }
                }
                if (code !== null || findings.length > 0) {
                    findings.push(
                        finding(
                            'tls.verificationBypassed',
                            'info',
                            {},
                            'The configured TLS exception allowed a connection despite a certificate verification problem.',
                        ),
                    );
                }
            } catch (error) {
                signal.throwIfAborted();
                failed = true;
                if (error instanceof ConnectionTimeoutError) {
                    findings.push(connectionTimeoutFinding(context, 'tls', error));
                    return { status: 'fail', findings, facts };
                }
                const code = errorCode(error);
                facts.verificationErrorCode = code;
                const problem = verificationFinding(code, 'error', context);
                if (problem) {
                    findings.push(problem);
                    facts.certificate = certificateFacts(errorCertificate(error));
                    if (facts.certificate === null) {
                        facts.inspectionOnly = true;
                        let inspectionSocket: tls.TLSSocket | undefined;
                        try {
                            inspectionSocket = await connect({
                                rejectUnauthorized: false,
                                checkServerIdentity: (): undefined => undefined,
                            });
                            signal.throwIfAborted();
                            collect(inspectionSocket);
                        } catch {
                            signal.throwIfAborted();
                            facts.certificate = null;
                        } finally {
                            inspectionSocket?.destroy();
                        }
                    }
                } else if (plaintextReply(error)) {
                    findings.push(
                        finding(
                            'tls.notTlsServer',
                            'error',
                            { errorCode: code },
                            'The server replied with bytes that are not TLS; check whether this port expects a plaintext connection.',
                        ),
                    );
                } else if (['ECONNRESET', 'EPIPE'].includes(code)) {
                    findings.push(
                        finding(
                            'tls.handshakeRejectedByServer',
                            'error',
                            { errorCode: code },
                            'The server closed the TLS handshake before a certificate arrived; an IP access list is one possible cause.',
                        ),
                    );
                }
            } finally {
                socket?.destroy();
            }
            const warning = findings.some(
                (entry): boolean => entry.severity === 'warning' || entry.code === 'tls.verificationBypassed',
            );
            return { status: failed ? 'fail' : warning ? 'warning' : 'pass', findings, facts };
        },
    };
}
