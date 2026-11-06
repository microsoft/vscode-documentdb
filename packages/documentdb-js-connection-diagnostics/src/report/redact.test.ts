/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Socket } from 'node:net';
import { Duplex } from 'node:stream';
import { describe, expect, it } from 'vitest';

import {
    buildReport,
    createBuiltInChecks,
    DEFAULT_TIMEOUTS,
    englishReportText,
    redactReport,
    renderJson,
    renderMarkdown,
    runDiagnostics,
} from '../index.js';
import { replyFrame } from '../test/wireResponder.js';

import { type TLSSocket } from 'node:tls';
import { type CheckResult, type DiagnosticsReport, type DnsIo, type IdentifierKind } from '../index.js';

const host = 'node.cluster.test';
const identifiers = [
    'alice',
    'sales',
    'service.cluster.test',
    host,
    'member.cluster.test',
    'alias.privatelink.cluster.test',
    'private.cluster.test',
    '10.11.12.13',
    '192.0.2.53',
    'Private Organization',
    'private-replica',
    'proxy.cluster.test',
    'bypass.cluster.test',
    'auth-database',
    'Display connection',
];
const prose = `### <b>Connect</b> [to the host](https://${host}) \`code\``;

async function fixture(): Promise<DiagnosticsReport<string>> {
    const dns: DnsIo = {
        lookup: async (): ReturnType<DnsIo['lookup']> => [{ address: '10.11.12.13', family: 4 }],
        resolve4: async (): Promise<string[]> => ['10.11.12.13'],
        resolve6: async (): Promise<string[]> => [],
        resolveCname: async (name): Promise<string[]> => (name === host ? ['alias.privatelink.cluster.test'] : []),
        resolveSrv: async (): ReturnType<DnsIo['resolveSrv']> => [{ name: host, port: 27017, priority: 0, weight: 1 }],
        resolveTxt: async (): Promise<string[][]> => [['authSource=auth-database&replicaSet=private-replica']],
        getServers: (): string[] => ['192.0.2.53'],
        resolveSrvFallback: async (): Promise<never> => {
            throw new Error('Unexpected fallback');
        },
        resolveTxtFallback: async (): Promise<never> => {
            throw new Error('Unexpected fallback');
        },
    };
    function tlsSocket(): TLSSocket {
        const socket = new Duplex({
            read(): void {},
            write(chunk: Buffer, _encoding, callback): void {
                socket.push(
                    replyFrame(chunk.readInt32LE(4), {
                        ok: 1,
                        setName: 'private-replica',
                        hosts: [`${host}:27017`, 'member.cluster.test:27018'],
                        me: `${host}:27017`,
                        primary: `${host}:27017`,
                        localTime: new Date(),
                        minWireVersion: 0,
                        maxWireVersion: 25,
                        internal: { documentdb_versions: ['0.107.0'] },
                        saslSupportedMechs: ['SCRAM-SHA-256'],
                    }),
                );
                callback();
            },
        });
        return Object.assign(socket, {
            authorized: true,
            getProtocol: (): string => 'TLSv1.3',
            getCipher: (): { name: string } => ({ name: 'TLS_AES_256_GCM_SHA384' }),
            getPeerCertificate: (): object => ({
                subject: { CN: host, O: 'Private Organization' },
                issuer: { CN: 'Public Example Root CA', O: 'Public CA Organization' },
                subjectaltname: `DNS:${host}, DNS:private.cluster.test, IP Address:10.11.12.13`,
                fingerprint256: 'AA:BB:CC',
                valid_from: 'Jan 1 00:00:00 2020 GMT',
                valid_to: 'Jan 1 00:00:00 2040 GMT',
            }),
        }) as unknown as TLSSocket;
    }
    const run = await runDiagnostics({
        input: { connectionString: 'mongodb+srv://alice:fixture-password@service.cluster.test/sales' },
        checks: createBuiltInChecks(),
        io: {
            dns,
            net: {
                connect: async (): Promise<Socket> => new Socket(),
                connectTls: async (): Promise<TLSSocket> => tlsSocket(),
            },
            environment: {
                versions: { node: '22.18.0', openssl: '3.0.16', ares: '1.34.6' },
                platform: 'linux',
                release: 'test',
                arch: 'x64',
                timeZone: 'UTC',
                env: { HTTPS_PROXY: 'http://proxy.cluster.test:8080', NO_PROXY: 'bypass.cluster.test' },
            },
        },
    });
    expect(run.results.map((result): string => result.checkId)).toEqual([
        'environment',
        'connectionString',
        'srv',
        'dns',
        'tcp',
        'tls',
        'hello',
    ]);
    expect(run.results.every((result): boolean => result.status === 'pass')).toBe(true);
    const extra: CheckResult<string> = {
        checkId: 'consumer',
        status: 'pass',
        durationMs: 1,
        facts: {},
        findings: [
            {
                code: 'consumer.diagnostic',
                severity: 'info',
                data: { host },
                detail: { language: 'en', text: `Observed ${host.toUpperCase()}:27017, alice and sales. ${prose}` },
            },
        ],
    };
    return buildReport(
        { ...run, results: [...run.results, extra] },
        {
            connectionName: 'Display connection',
            summary: {
                outcome: 'connected',
                headline: { checkId: 'hello', target: `${host}:27017`, code: 'consumer.diagnostic' },
                serverRows: [{ label: 'Server', value: `${host}:27017 (0.107.0)` }],
                nextSteps: [`Connect to ${host}`],
                location: `Near ${host}`,
                notes: [`Earlier in this session: ${host}`, prose],
            },
        },
    );
}

function customReport(
    facts: Readonly<Record<string, unknown>>,
    identifierKeys: Readonly<Record<string, IdentifierKind>> = {},
    detail = '',
    target?: string,
): DiagnosticsReport<string> {
    return buildReport(
        {
            runId: 'redaction-test',
            startedAt: 0,
            finishedAt: 1,
            durationMs: 1,
            timeoutProfile: 'default',
            timeouts: DEFAULT_TIMEOUTS,
            targets: [],
            coverage: {
                limited: false,
                timedOut: [],
                notStartedCount: 0,
                omittedTargetCount: 0,
                retryWouldHelp: false,
            },
            results: [
                {
                    checkId: 'custom',
                    status: 'pass',
                    durationMs: 1,
                    target,
                    facts,
                    findings: [{ code: 'custom.code', severity: 'info', detail: { language: 'en', text: detail } }],
                },
            ],
        },
        { identifierKeys },
    );
}

describe('identifier redaction and JSON rendering', (): void => {
    it('redacts a complete real check run consistently in facts, targets and prose', async (): Promise<void> => {
        const report = await fixture();
        const redacted = redactReport(report);
        const json = renderJson(report, { redact: true });
        for (const identifier of identifiers) {
            expect(json.toLowerCase()).not.toContain(identifier.toLowerCase());
        }
        const connection = redacted.results.find((result): boolean => result.checkId === 'connectionString');
        const hosts = connection?.facts.hosts as readonly { host: string; port?: number }[];
        expect(hosts[0].host).toMatch(/^host-\d+$/);
        const hello = redacted.results.find((result): boolean => result.checkId === 'hello');
        const target = redacted.targets[0];
        expect(hello?.target).toBe(target);
        expect(hello?.facts.me).toBe(target);
        expect(hello?.facts.hosts).toContain(target);
        expect(redacted.results.at(-1)?.findings[0].detail.text).toContain(target);
        expect(redacted.summary?.serverRows?.[0].value).toContain(target);
        expect(redacted.clockOffset?.target).toBe(target);
        expect(json).toContain(':27017');
        expect(json).toContain(':27018');
        expect(json).toContain('"port": 8080');
        expect(json).toContain('22.18.0');
        expect(json).toContain('0.107.0');
        expect(json).toContain('TLSv1.3');
        expect(json).toContain('consumer.diagnostic');
        expect(json).toContain('Public Example Root CA');
        expect(json).toContain('Public CA Organization');
        expect(json).toContain('"redacted": true');
        expect(json).not.toContain('identifierKeys');
        expect(Object.isFrozen(redacted.results[0].facts)).toBe(true);
        expect(redacted).not.toBe(report);
        expect(report.targets[0]).toBe(`${host}:27017`);
    });

    it('preserves identifiers, English details and Markdown/HTML-looking strings in complete JSON', async (): Promise<void> => {
        const report = await fixture();
        const json = renderJson(report, { redact: false });
        for (const identifier of identifiers) {
            expect(json).toContain(identifier);
        }
        expect(json).toContain('"language": "en"');
        expect(json).toContain('"redacted": false');
        expect(json).not.toContain('identifierKeys');
        expect(json).toContain(prose);
        const redacted = renderJson(report, { redact: true });
        expect(redacted).toContain('### <b>Connect</b> [to the host](https://host-');
        expect(redacted).toContain('`code`');
    });

    it('supports all consumer identifier kinds, array values, steps and summary prose', (): void => {
        const keys: Readonly<Record<string, IdentifierKind>> = {
            tenantId: 'tenant',
            accountName: 'account',
            managedId: 'clientId',
            cloudEndpoint: 'endpoint',
            customRole: 'role',
        };
        const facts = {
            tenantId: 'private-tenant',
            accountName: ['private-account'],
            managedId: 'private-client',
            cloudEndpoint: 'https://private.endpoint.test',
            customRole: 'private-role',
        };
        const report = customReport(facts, keys, Object.values(facts).flat().join(' '));
        const json = renderJson(report, { redact: true });
        for (const original of Object.values(facts).flat()) {
            expect(json).not.toContain(original);
        }
        for (const prefix of ['tenant', 'account', 'client', 'endpoint', 'role']) {
            expect(json).toContain(`${prefix}-1`);
        }
        const withSteps = {
            ...report,
            results: [
                {
                    ...report.results[0],
                    steps: [
                        {
                            stepId: 'phase',
                            status: 'pass' as const,
                            durationMs: 1,
                            facts: { host: 'step.example' },
                            findings: [
                                {
                                    code: 'phase.code',
                                    severity: 'info' as const,
                                    data: { userName: 'phase-user' },
                                    detail: { language: 'en' as const, text: 'step.example phase-user' },
                                },
                            ],
                        },
                    ],
                },
            ],
        };
        const steps = redactReport(withSteps).results[0].steps;
        expect(steps?.[0].facts.host).toBe('host-1');
        expect(steps?.[0].findings[0].detail.text).toBe('host-1 user-1');
    });

    it('matches contextual keys without classifying unrelated names or public issuers', (): void => {
        const report = customReport({
            name: 'ordinary-name',
            entries: ['ordinary-entry'],
            CN: 'ordinary-cn',
            records: [{ name: 'srv.example', port: 27017 }],
            subject: { CN: 'private-cn', O: 'private-org' },
            issuerChain: [{ CN: 'Example Public Root CA', O: 'Example Trust Services' }],
            proxy: { variables: [{ host: 'proxy.example' }], noProxy: { entries: ['bypass.example'] } },
            NO_PROXY: { entries: ['other-bypass.example'] },
        });
        expect(redactReport(report).results[0].facts).toMatchObject({
            name: 'ordinary-name',
            entries: ['ordinary-entry'],
            CN: 'ordinary-cn',
            records: [{ name: 'host-1', port: 27017 }],
            subject: { CN: 'certificate-1', O: 'certificate-2' },
            issuerChain: [{ CN: 'Example Public Root CA', O: 'Example Trust Services' }],
            proxy: { variables: [{ host: 'proxy-1' }], noProxy: { entries: ['host-2'] } },
            NO_PROXY: { entries: ['host-3'] },
        });
    });

    it('redacts self-signed certificate subject and issuer identifiers in JSON and Markdown', (): void => {
        const subject = { CN: 'private-db.internal.example', O: 'Private Customer Organization' };
        const report = customReport({
            subject,
            subjectAltNames: [`DNS:${subject.CN}`],
            issuerChain: [subject],
            selfIssued: true,
        });
        const redacted = redactReport(report);
        expect(redacted.results[0].facts).toMatchObject({
            subject: { CN: 'certificate-1', O: 'certificate-2' },
            issuerChain: [{ CN: 'certificate-1', O: 'certificate-2' }],
        });
        const outputs = [
            renderJson(report, { redact: true }),
            renderMarkdown(report, { text: englishReportText, redact: true }).replace(/\\/g, ''),
        ];
        for (const output of outputs) {
            expect(output).not.toContain(subject.CN);
            expect(output).not.toContain(subject.O);
        }
    });

    it('handles address objects, host ports, SAN prefixes and bracketed IPv6', (): void => {
        const report = customReport(
            {
                osAddresses: [{ address: '2001:db8::1', family: 6, class: 'private' }],
                hosts: ['[2001:db8::1]:27017'],
                subjectAltNames: ['IP Address:2001:db8::1'],
            },
            {},
            '[2001:db8::1]:27017',
            '[2001:db8::1]:27017',
        );
        const redacted = redactReport(report);
        expect(redacted.results[0].facts).toEqual({
            osAddresses: [{ address: 'address-1', family: 6, class: 'private' }],
            hosts: ['address-1:27017'],
            subjectAltNames: ['IP Address:address-1'],
        });
        expect(redacted.results[0].target).toBe('address-1:27017');
        expect(redacted.results[0].findings[0].detail.text).toBe('[address-1]:27017');
    });

    it('keeps explicit DNS server ports while sharing address placeholders', (): void => {
        const report = customReport({ dnsServers: ['192.0.2.53:1053', '[2001:db8::53]:1053'], address: '192.0.2.53' });
        expect(redactReport(report).results[0].facts).toEqual({
            dnsServers: ['address-1:1053', 'address-2:1053'],
            address: 'address-1',
        });
    });

    it('uses longest-first non-cascading substring replacements and host-insensitive matching', (): void => {
        const report = customReport(
            { host: ['db.example', 'sub.db.example', 'HOST'] },
            {},
            'SUB.DB.EXAMPLE DB.EXAMPLE HOST',
        );
        expect(redactReport(report).results[0].findings[0].detail.text).toBe('host-2 host-1 host-3');
    });

    it('replaces short values only in classified positions and other identifiers case-sensitively', (): void => {
        const report = customReport(
            { host: ['db', 'DB'], userName: 'Ann', database: 'en', marker: '[depth limit]' },
            {},
            'db DB Ann ANN en',
        );
        const redacted = redactReport(report);
        expect(redacted.results[0].facts.host).toEqual(['host-1', 'host-1']);
        expect(redacted.results[0].facts.database).toBe('database-1');
        expect(redacted.results[0].findings[0].detail).toEqual({ language: 'en', text: 'db DB user-1 ANN en' });
    });

    it('keeps one placeholder when a host was first observed as another identifier kind', (): void => {
        const report = customReport({ userName: 'Shared.Example', host: 'shared.example' }, {}, 'SHARED.EXAMPLE');
        const redacted = redactReport(report);
        expect(redacted.results[0].facts).toEqual({ userName: 'user-1', host: 'user-1' });
        expect(redacted.results[0].findings[0].detail.text).toBe('user-1');
    });

    it('keeps machine codes, cloud categories and versions even when identifiers collide', (): void => {
        const report = customReport(
            {
                userName: ['public', '22.18.0', 'ECONNRESET'],
                cloud: 'public',
                nodeVersion: '22.18.0',
                documentdbVersions: ['22.18.0'],
                osErrorCode: 'ECONNRESET',
            },
            {},
            'public 22.18.0 ECONNRESET',
        );
        const redacted = redactReport(report);
        expect(redacted.results[0].facts).toEqual({
            userName: ['user-1', 'user-2', 'user-3'],
            cloud: 'public',
            nodeVersion: '22.18.0',
            documentdbVersions: ['22.18.0'],
            osErrorCode: 'ECONNRESET',
        });
        expect(redacted.results[0].findings[0].detail.text).toBe('user-1 user-2 user-3');
    });

    it('honors consumer overrides and named option values without changing option names', (): void => {
        const report = customReport(
            {
                host: 'custom.endpoint',
                options: [
                    { name: 'authSource', value: 'auth-db' },
                    { name: 'REPLICASET', value: 'custom-rs' },
                    { name: 'proxyUsername', value: 'proxy-user' },
                    { name: 'proxyHost', value: 'proxy.example' },
                    { name: 'dbName', value: 'other-db' },
                    { name: 'servername', value: 'sni.example' },
                    { name: 'localAddress', value: '192.0.2.123' },
                ],
            },
            { host: 'endpoint' },
        );
        const redacted = redactReport(report);
        expect(redacted.results[0].facts.host).toBe('endpoint-1');
        expect(redacted.results[0].facts.options).toEqual([
            { name: 'authSource', value: 'database-1' },
            { name: 'REPLICASET', value: 'replica-set-1' },
            { name: 'proxyUsername', value: 'user-1' },
            { name: 'proxyHost', value: 'proxy-1' },
            { name: 'dbName', value: 'database-2' },
            { name: 'servername', value: 'host-1' },
            { name: 'localAddress', value: 'address-1' },
        ]);
    });
});
