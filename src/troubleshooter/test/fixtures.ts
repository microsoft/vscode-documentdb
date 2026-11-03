/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    buildReport,
    DEFAULT_TIMEOUTS,
    renderJson,
    renderMarkdown,
    type CheckResult,
    type DnsIo,
    type Finding,
    type NetIo,
    type ReportSummary,
    type TroubleshooterEvent,
    type TroubleshooterIo,
    type TroubleshooterRun,
} from '@documentdb-js/connectivity-troubleshooter';
import { type Socket } from 'node:net';
import { Duplex } from 'node:stream';
import { type TLSSocket } from 'node:tls';
import { vi } from 'vitest';
import {
    replyFrame,
    wireResponder,
    type WireRequest,
} from '../../../packages/documentdb-js-connectivity-troubleshooter/src/test/wireResponder';
import { describeFinding } from '../findingMessages';
import { troubleshooterIdentifierKeys } from '../identifierKeys';
import { PanelRowProjector } from '../panelRows';
import { createExtensionReportText } from '../reportText';
import { deriveResult } from '../result';
import { type FindingCode } from '../types';

export const detailSentinel = 'CONVENIENCE_DETAIL_MUST_NEVER_REACH_THE_PANEL';
export const host = 'fixture.mongocluster.cosmos.azure.com';
export const gatewayReply = {
    ok: 1,
    msg: 'isdbgrid',
    isWritablePrimary: true,
    minWireVersion: 0,
    maxWireVersion: 21,
    internal: { documentdb_versions: ['0.107.0'] },
};

export function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise): void => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

export function socketError(code: string): Error & { code: string } {
    return Object.assign(new Error('Private driver error text'), { code });
}

/** The package hello tests' paired-Duplex responder, using its shared wire encoder/parser. */
export function offlineIo(): {
    io: TroubleshooterIo;
    dns: DnsIo;
    sockets: Duplex[];
    requests: WireRequest[];
    controls: {
        reply: Readonly<Record<string, unknown>>;
        replyDelayMs: number;
        connectError?: string;
        deadAddresses: Set<string>;
    };
    elapse(ms: number): void;
    dispose(): void;
} {
    const sockets: Duplex[] = [];
    const requests: WireRequest[] = [];
    const controls = {
        reply: gatewayReply as Readonly<Record<string, unknown>>,
        replyDelayMs: 0,
        connectError: undefined as string | undefined,
        deadAddresses: new Set<string>(),
    };
    let elapsed = 0;
    const dns: DnsIo = {
        lookup: vi.fn(
            async (name: string): Promise<{ address: string; family: 4 | 6 }[]> => [
                { address: name.startsWith('dead') ? '203.0.113.5' : '203.0.113.4', family: 4 },
            ],
        ),
        resolve4: vi.fn(
            async (name: string): Promise<string[]> => [name.startsWith('dead') ? '203.0.113.5' : '203.0.113.4'],
        ),
        resolve6: vi.fn(async (): Promise<string[]> => []),
        resolveCname: vi.fn(async (): Promise<string[]> => []),
        resolveSrv: vi.fn(async (): Promise<never> => {
            throw new Error('Unexpected SRV query');
        }),
        resolveTxt: vi.fn(async (): Promise<never> => {
            throw new Error('Unexpected TXT query');
        }),
        getServers: (): string[] => [],
        resolveSrvFallback: async (): Promise<never> => {
            throw new Error('Unexpected SRV fallback');
        },
        resolveTxtFallback: async (): Promise<never> => {
            throw new Error('Unexpected TXT fallback');
        },
    };
    function socket(address: string): Socket {
        if (controls.connectError || controls.deadAddresses.has(address)) {
            throw socketError(controls.connectError ?? 'ECONNREFUSED');
        }
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
        wireResponder(
            server,
            (request, peer): void => {
                const respond = (): void => {
                    if (!client.destroyed && !peer.destroyed) {
                        peer.write(replyFrame(request.requestId, controls.reply));
                    }
                };
                if (controls.replyDelayMs) {
                    setTimeout(respond, controls.replyDelayMs);
                } else {
                    respond();
                }
            },
            requests,
        );
        return client as unknown as Socket;
    }
    const net: NetIo = {
        connect: vi.fn(async (options: Parameters<NetIo['connect']>[0]): Promise<Socket> => socket(options.host)),
        connectTls: vi.fn(
            async (options: Parameters<NetIo['connectTls']>[0]): Promise<TLSSocket> =>
                Object.assign(socket(String(options.host)), {
                    authorized: true,
                    getProtocol: (): string => 'TLSv1.3',
                    getCipher: (): { name: string } => ({ name: 'TLS_AES_256_GCM_SHA384' }),
                    getPeerCertificate: (): object => ({}),
                }) as unknown as TLSSocket,
        ),
    };
    return {
        io: {
            dns,
            net,
            clock: {
                now: (): number => Date.now() + elapsed,
                setTimeout: (callback, ms): unknown => setTimeout(callback, ms),
                clearTimeout: (handle): void => {
                    clearTimeout(handle as ReturnType<typeof setTimeout>);
                },
            },
            environment: {
                versions: { node: '22.0.0', ares: '1.34.6', openssl: '3.0.0' },
                platform: 'linux',
                release: '6.8',
                arch: 'x64',
                env: {},
                timeZone: 'UTC',
            },
        },
        dns,
        sockets,
        requests,
        controls,
        elapse(ms): void {
            elapsed += ms;
        },
        dispose(): void {
            for (const item of sockets) {
                item.destroy();
            }
        },
    };
}

export function checkResult(
    checkId: string,
    overrides: Partial<CheckResult<FindingCode>> = {},
): CheckResult<FindingCode> {
    return { checkId, status: 'pass', durationMs: 37, findings: [], facts: {}, ...overrides };
}

export function fixtureRun(results: readonly CheckResult<FindingCode>[]): TroubleshooterRun<FindingCode> {
    return {
        runId: 'wording-run',
        startedAt: 1000,
        finishedAt: 2000,
        durationMs: 1000,
        timeoutProfile: 'default',
        timeouts: DEFAULT_TIMEOUTS,
        targets: [{ host, port: 27017, source: 'uri' }],
        results,
        coverage: { limited: false, timedOut: [], notStartedCount: 0, omittedTargetCount: 0, retryWouldHelp: false },
    };
}

export function runEvents(run: TroubleshooterRun<FindingCode>): TroubleshooterEvent<FindingCode>[] {
    return [
        ...run.results.flatMap((result): TroubleshooterEvent<FindingCode>[] => [
            {
                type: 'checkStarted',
                runId: run.runId,
                checkId: result.checkId,
                target: result.target,
                at: run.startedAt,
            },
            { type: 'checkFinished', runId: run.runId, result, at: run.finishedAt },
        ]),
        { type: 'runFinished', runId: run.runId, run, at: run.finishedAt },
    ];
}

export function projectRun(run: TroubleshooterRun<FindingCode>, events = runEvents(run)): PanelRowProjector {
    const plan = [...new Set(run.results.map((result): string => result.checkId))].map(
        (id): { id: string; scope: 'host' | 'run' } => ({
            id,
            scope: run.results.some((result): boolean => result.checkId === id && result.target !== undefined)
                ? 'host'
                : 'run',
        }),
    );
    const projector = new PanelRowProjector(describeFinding, plan);
    for (const event of events) {
        projector.apply(event);
    }
    return projector;
}

export function outputs(
    run: TroubleshooterRun<FindingCode>,
    events = runEvents(run),
    summary?: ReportSummary,
): {
    projector: PanelRowProjector;
    result: ReturnType<typeof deriveResult>;
    markdown: string;
    json: string;
} {
    const projector = projectRun(run, events);
    const result = deriveResult(run.results, describeFinding);
    const report = buildReport(run, {
        identifierKeys: troubleshooterIdentifierKeys,
        summary: summary ?? { outcome: result.outcome, ...(result.headline ? { headline: result.headline } : {}) },
    });
    return {
        projector,
        result,
        markdown: renderMarkdown(report, { text: createExtensionReportText(), redact: false }),
        json: renderJson(report, { redact: false }),
    };
}

export function finding(
    code: FindingCode,
    data: Readonly<Record<string, unknown>> = representativeData[code],
): Finding<FindingCode> {
    return { code, severity: 'error', data, detail: { language: 'en', text: detailSentinel } };
}

export const representativeData: Readonly<Record<FindingCode, Readonly<Record<string, unknown>>>> = {
    'check.timeout': { operation: 'tcp', timeoutMs: 10000, source: 'check' },
    'env.proxyConfigured': { variables: ['HTTPS_PROXY'] },
    'env.caresRejectsCompressedSrv': { aresVersion: '1.34.6' },
    'cs.unparseable': { reason: 'invalidScheme' },
    'cs.srvWithPort': {},
    'cs.srvMultipleHosts': {},
    'cs.unknownOption': { option: 'tlss', suggestion: 'tls' },
    'cs.optionIgnoredByDriver': { option: 'sslvalidate', replacement: 'tlsAllowInvalidCertificates' },
    'cs.conflictingTlsOptions': {},
    'cs.tlsVerificationDisabled': { options: ['tlsInsecure'] },
    'cs.directConnectionWithMultipleHosts': {},
    'cs.unencodedReservedCharacter': { part: 'username', character: '@' },
    'cs.authSourceUnusual': { authSource: 'accounts' },
    'cs.compressorUnavailable': { compressor: 'snappy', available: ['zlib'] },
    'srv.notFound': {},
    'srv.compressedReplyRejected': { nodeErrorCode: 'EBADRESP', fallbackOutcome: 'succeeded' },
    'srv.txtUnsupportedOption': {},
    'srv.targetOutsideDomain': {},
    'dns.notFound': {},
    'dns.temporaryFailure': {},
    'dns.resolversDisagree': { osAddressCount: 2, caresAddressCount: 0, caresErrorCode: 'ENOTFOUND' },
    'dns.privateEndpoint': {},
    'dns.privateEndpointPublicAddress': {},
    'dns.loopback': {},
    'tcp.refused': { errorCode: 'ECONNREFUSED' },
    'tcp.timeout': { errorCode: 'ETIMEDOUT', source: 'connection' },
    'tcp.unreachable': { errorCode: 'EHOSTUNREACH' },
    'tcp.reset': { errorCode: 'ECONNRESET' },
    'tls.notTlsServer': { errorCode: 'ERR_SSL_WRONG_VERSION_NUMBER' },
    'tls.handshakeRejectedByServer': { errorCode: 'ECONNRESET' },
    'tls.selfSigned': { errorCode: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
    'tls.untrustedIssuer': { errorCode: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' },
    'tls.hostnameMismatch': { errorCode: 'ERR_TLS_CERT_ALTNAME_INVALID' },
    'tls.expired': { errorCode: 'CERT_HAS_EXPIRED' },
    'tls.notYetValid': { errorCode: 'CERT_NOT_YET_VALID', localTime: '2026-10-29T12:00:00Z' },
    'tls.verificationBypassed': {},
    'hello.noReply': { waitedMs: 9750 },
    'hello.notWireProtocol': {},
    'hello.closedWithoutReply': { tls: false },
    'hello.inconclusive': { reason: 'commandFailed', code: 59, codeName: 'CommandNotFound' },
    'hello.mechanismNotOffered': { mechanism: 'SCRAM-SHA-256', offered: ['SCRAM-SHA-1'] },
    'hello.compressorUnavailable': { compressor: 'snappy' },
    'hello.clockOffset': { offsetMs: 420000, uncertaintyMs: 10 },
    'env.remoteExtensionHost': { remoteKind: 'ssh' },
    'target.notFound': { source: 'azure', errorName: 'RestError', statusCode: 404 },
    'target.inputCancelled': { input: 'port' },
    'target.sourceInaccessible': { source: 'kubernetes', reason: 'unreachable', errorName: 'Error' },
    'target.endpointMissing': { source: 'kubernetes', reason: 'pending' },
    'cs.credentialsMissing': { missing: 'password', authMethod: 'NativeAuth' },
    'prepare.localPortInUse': { localPort: 27017, holder: 'otherProgram' },
    'prepare.sharedTunnel': { tunnel: 'started' },
    'hello.advertisedMembersUnreachable': { unreachableCount: 2 },
    'auth.failed': { authMethod: 'MicrosoftEntraID', serverCode: 18, serverCodeName: 'AuthenticationFailed' },
    'auth.mechanismMismatch': { requested: 'SCRAM-SHA-256', offered: ['SCRAM-SHA-1'] },
    'auth.credentialsUnavailable': { missing: 'entraSession', authMethod: 'MicrosoftEntraID' },
    'auth.serverSelectionTimeout': { timeoutMs: 45000, serverErrorCount: 2 },
    'auth.driverOptionsRejected': { errorName: 'MongoParseError' },
    'auth.connectFailed': { errorName: 'MongoNetworkError', phase: 'connect' },
    'auth.cloudMismatch': { configuredCloud: 'AzureCloud', hostCloud: 'AzureUSGovernment' },
    'auth.tokenResourceUnresolved': { kind: 'customCloudUnresolved' },
    'auth.oidcHostNotAllowed': {},
    'auth.entraTokenFailed': {
        ruleId: 'conditionalAccess',
        aadstsCode: '53003',
        resource: 'https://ossrdbms-aad.database.windows.net',
    },
    'auth.entraAudienceMismatch': {},
    'auth.entraTenantMismatch': {},
    'access.listDatabasesDenied': { codeName: 'Unauthorized' },
    'access.signInRequired': { command: 'listDatabases' },
    'access.noDatabasesVisible': {},
    'access.readRoleReported': { role: 'read', database: 'sample' },
};
