/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { buildReport, DEFAULT_TIMEOUTS, type CheckResult, type Finding } from '@documentdb-js/connection-diagnostics';
import { describe, expect, it } from 'vitest';
import {
    panelRowIds,
    type PanelRow,
    type PanelRowId,
    type PanelRowStatus,
} from '../webviews/documentdb/connectionDiagnostics/panelTypes';
import { describeFinding } from './findingMessages';
import { diagnosticsIdentifierKeys } from './identifierKeys';
import { buildRowDetails, withRowDetails } from './panelDetails';
import { type FindingCode } from './types';

const cluster = 'c-stage0.mongocluster.cosmos.azure.com';
const srvTarget = `fc-0123456789ab-000.${cluster}`;
const privateLink = 'fc-0123456789ab-000.privatelink.mongocluster.cosmos.azure.com';
const publicAddress = '203.0.113.24';
const englishDetail = 'Do not display: AADSTS http://private.example rule-id 123 ms';

function finding(
    code: FindingCode,
    severity: 'info' | 'warning' | 'error',
    data?: Readonly<Record<string, unknown>>,
): Finding<FindingCode> {
    return { code, severity, data, detail: { language: 'en', text: englishDetail } };
}

function result(checkId: string, options: Partial<CheckResult<FindingCode>> = {}): CheckResult<FindingCode> {
    return { checkId, status: 'pass', durationMs: 4321, findings: [], facts: {}, ...options };
}

/** The operator's WSL run against an Azure DocumentDB private-link alias that resolves publicly. */
function operatorRun(): CheckResult<FindingCode>[] {
    const target = `${srvTarget}:10260`;
    const address = { address: publicAddress, family: 4, class: 'public' };
    return [
        result('environment', {
            facts: { platform: 'linux', release: '6.6.87-microsoft-standard-WSL2', arch: 'x64' },
            findings: [finding('env.caresRejectsCompressedSrv', 'info', { aresVersion: '1.34.4' })],
        }),
        result('extensionEnvironment', {
            facts: { remoteKind: 'wsl' },
            findings: [finding('env.remoteExtensionHost', 'info', { remoteKind: 'wsl' })],
        }),
        result('connectionString', {
            facts: {
                scheme: 'mongodb+srv',
                hosts: [{ host: cluster }],
                database: null,
                userName: 'stage0user',
                passwordPresent: true,
                options: [
                    { name: 'tls', value: 'true', valueSupplied: true, known: true, sensitive: false },
                    {
                        name: 'authMechanism',
                        value: 'SCRAM-SHA-256',
                        valueSupplied: true,
                        known: true,
                        sensitive: false,
                    },
                    { name: 'appName', value: 'stage0-app', valueSupplied: true, known: true, sensitive: false },
                    // The package never records a sensitive value; even if one arrived, it must not show.
                    {
                        name: 'tlsCertificateKeyFilePassword',
                        value: 'S3cret-value',
                        valueSupplied: true,
                        known: true,
                        sensitive: true,
                    },
                    { name: 'mysteryToken', valueSupplied: true, known: false, sensitive: true },
                ],
            },
        }),
        result('credentials', { facts: { authMethod: 'NativeAuth', credentialState: 'available' } }),
        result('srv', {
            facts: {
                srvQueryName: `_mongodb._tcp.${cluster}`,
                resolutionPath: 'node',
                dnsServers: ['172.20.192.1'],
                records: [{ name: srvTarget, port: 10260, priority: 0, weight: 0 }],
                omittedRecordCount: 0,
                txtOptions: [{ name: 'authSource', value: 'admin' }],
            },
        }),
        result('dns', {
            target,
            status: 'pass',
            findings: [finding('dns.privateEndpointPublicAddress', 'info')],
            facts: {
                osAddresses: [address],
                caresAddresses: [address],
                cnameChain: [privateLink],
                osErrorCode: null,
                caresErrorCode: null,
            },
        }),
        result('tcp', {
            target,
            facts: {
                attempts: [{ address: publicAddress, family: 4, outcome: 'connected', latencyMs: 31 }],
                connectedAddress: { address: publicAddress, family: 4 },
            },
        }),
        result('tls', {
            target,
            facts: {
                protocol: 'TLSv1.3',
                verificationErrorCode: null,
                certificate: {
                    subject: { CN: `*.${cluster}` },
                    issuerChain: [{ CN: 'Microsoft Azure RSA TLS Issuing CA 03', O: 'Microsoft Corporation' }],
                    validTo: '2027-03-01T00:00:00.000Z',
                },
            },
        }),
        result('hello', {
            target,
            facts: {
                handshake: 'opMsg',
                topology: 'documentdbGateway',
                documentdbVersions: ['0.107.0'],
                maxWireVersion: 21,
                isWritablePrimary: true,
                saslSupportedMechs: ['SCRAM-SHA-256'],
                roundTripMs: 40,
            },
        }),
        result('authenticate', {
            facts: { authMethod: 'NativeAuth', mechanism: 'SCRAM-SHA-256', userName: 'stage0user' },
        }),
        result('connectionAccess', {
            facts: {
                commands: [
                    { command: 'ping', outcome: 'ok', durationMs: 33 },
                    { command: 'listDatabases', outcome: 'ok', durationMs: 50 },
                ],
                pingMs: 33,
                databaseCount: 3,
            },
        }),
        result('serverFacts', {
            facts: { commands: [{ command: 'buildInfo', outcome: 'ok', durationMs: 20 }], serverVersion: '7.0.0' },
        }),
    ];
}

function rows(statuses: Partial<Record<PanelRowId, PanelRowStatus>> = {}): PanelRow[] {
    return panelRowIds.map(
        (id): PanelRow => ({ id, status: statuses[id] ?? 'done', segments: [{ kind: 'connected' }] }),
    );
}

function details(output: readonly PanelRow[], id: PanelRowId): NonNullable<PanelRow['details']> | undefined {
    return output.find((row): boolean => row.id === id)?.details;
}

function report(results: readonly CheckResult<FindingCode>[]): ReturnType<typeof buildReport<FindingCode>> {
    return buildReport(
        {
            runId: 'run',
            startedAt: 0,
            finishedAt: 1,
            durationMs: 1,
            timeoutProfile: 'default',
            timeouts: DEFAULT_TIMEOUTS,
            targets: [{ host: srvTarget, port: 10260, source: 'srv' }],
            results,
            coverage: {
                limited: false,
                timedOut: [],
                notStartedCount: 0,
                omittedTargetCount: 0,
                retryWouldHelp: false,
            },
        },
        { connectionName: 'Stage 0 fixture connection', identifierKeys: diagnosticsIdentifierKeys },
    );
}

describe('panel row details (WI-18 prototype)', () => {
    it("explains the operator's informational DNS finding: an Azure private-link alias resolving publicly", (): void => {
        const output = withRowDetails(rows({ serverAddress: 'done' }), operatorRun(), describeFinding);
        const dns = details(output, 'serverAddress');

        expect(dns?.findings).toEqual([
            {
                severity: 'info',
                title: 'Public address for this Azure host name',
                explanation:
                    "The name goes through Azure's private-link alias and resolves to a public address. That is normal outside the cluster's private network.",
                targets: [srvTarget],
            },
        ]);
        expect(dns?.evidence).toEqual([
            {
                kind: 'srv',
                query: `_mongodb._tcp.${cluster}`,
                targets: [`${srvTarget}:10260`],
                omittedTargets: 0,
                resolver: 'system',
                dnsServers: ['172.20.192.1'],
                txtOptions: [{ name: 'authSource', value: 'admin' }],
                failed: false,
            },
            {
                kind: 'dnsHost',
                host: srvTarget,
                cnameChain: [privateLink],
                system: [{ address: publicAddress, family: 4, addressClass: 'public' }],
                direct: [{ address: publicAddress, family: 4, addressClass: 'public' }],
                systemFailed: false,
                directFailed: false,
                agree: true,
            },
        ]);
    });

    it('lists both environment notes on Diagnosis setup, with where the checks ran', (): void => {
        const setup = details(withRowDetails(rows(), operatorRun(), describeFinding), 'setup');

        expect(setup?.findings.map((item): string => item.title)).toEqual([
            'Known DNS issue in this VS Code version',
            'Checks run on a remote host',
        ]);
        expect(setup?.findings.every((item): boolean => item.severity === 'info')).toBe(true);
        expect(setup?.evidence).toEqual([
            {
                kind: 'setup',
                remoteKind: 'wsl',
                platform: 'linux',
                release: '6.6.87-microsoft-standard-WSL2',
                arch: 'x64',
            },
        ]);
    });

    it('shows evidence for the other healthy rows; with one host and one attempt, the ping is the only timing', (): void => {
        const output = withRowDetails(rows(), operatorRun(), describeFinding);

        // One host: its time would repeat the row's badge. One attempt: nothing to compare (WI-33).
        expect(details(output, 'networkConnection')?.evidence).toEqual([
            {
                kind: 'tcpHost',
                host: srvTarget,
                port: 10260,
                connectedAddress: publicAddress,
                failedAddresses: [],
            },
        ]);
        expect(details(output, 'secureConnection')?.evidence).toEqual([
            {
                kind: 'tlsHost',
                host: srvTarget,
                protocol: 'TLSv1.3',
                subject: `*.${cluster}`,
                issuer: 'Microsoft Azure RSA TLS Issuing CA 03',
                validTo: '2027-03-01T00:00:00.000Z',
                trusted: true,
                hostNameMatched: true,
            },
        ]);
        expect(details(output, 'serverResponse')?.evidence).toEqual([
            {
                kind: 'serverHost',
                host: srvTarget,
                command: 'hello',
                topology: 'documentdbGateway',
                documentdbVersion: '0.107.0',
                maxWireVersion: 21,
                passwordMechanisms: ['SCRAM-SHA-256'],
            },
        ]);
        expect(details(output, 'authentication')?.evidence).toEqual([
            {
                kind: 'auth',
                method: 'native',
                mechanism: 'SCRAM-SHA-256',
                user: 'stage0user',
                authSource: { value: 'admin', origin: 'dns' },
                stages: [{ stage: 'sendPassword', outcome: 'done' }],
            },
        ]);
        expect(details(output, 'databaseAccess')?.evidence).toEqual([
            {
                kind: 'access',
                commands: [
                    { command: 'ping', outcome: 'ok' },
                    { command: 'listDatabases', outcome: 'ok' },
                    { command: 'buildInfo', outcome: 'ok' },
                ],
                pingMs: 33,
                databaseCount: 3,
                serverVersion: '7.0.0',
            },
        ]);
        // Decision 0050 allows each host's check time and each TCP connect time, but a single-host row
        // and a single-attempt host leave them out (WI-33). The checks' other timing facts, the greeting
        // round trip (40) and command times (50, 20), stay out too.
        const text = JSON.stringify(output);
        for (const timing of ['latencyMs', 'roundTripMs', 'durationMs', 'connectMs', ':40', ':50', ':20', ':31']) {
            expect(text).not.toContain(timing);
        }
    });

    it('gives each host section its time only when the row has two or more hosts (WI-33)', (): void => {
        const hello = (target: string, durationMs: number): CheckResult<FindingCode> =>
            result('hello', { target, durationMs, facts: { handshake: 'opMsg', topology: 'documentdbGateway' } });
        const two = withRowDetails(
            rows(),
            [hello('host-a.test:27017', 120), hello('host-b.test:27017', 340)],
            describeFinding,
        );
        const one = withRowDetails(rows(), [hello('host-a.test:27017', 120)], describeFinding);

        expect(
            details(two, 'serverResponse')?.evidence.map((evidence) =>
                'durationMs' in evidence ? evidence.durationMs : undefined,
            ),
        ).toEqual([120, 340]);
        expect(details(one, 'serverResponse')?.evidence).toHaveLength(1);
        expect(details(one, 'serverResponse')?.evidence[0]).not.toHaveProperty('durationMs');
    });

    it('gives each TCP host its time and connect times only to a host with two or more attempts (WI-33)', (): void => {
        const output = withRowDetails(
            rows({ networkConnection: 'warning' }),
            [
                result('tcp', {
                    target: 'host-a.test:27017',
                    durationMs: 3046.5,
                    facts: {
                        attempts: [
                            {
                                address: '2001:db8::5',
                                family: 6,
                                outcome: 'failed',
                                errorCode: 'ETIMEDOUT',
                                latencyMs: 3000,
                            },
                            // A repeated address keeps its first attempt.
                            {
                                address: '2001:db8::5',
                                family: 6,
                                outcome: 'failed',
                                errorCode: 'ETIMEDOUT',
                                latencyMs: 9,
                            },
                            { address: '203.0.113.9', family: 4, outcome: 'failed', errorCode: 'ECONNREFUSED' },
                            { address: '203.0.113.10', family: 4, outcome: 'connected', latencyMs: 42.5 },
                        ],
                        connectedAddress: { address: '203.0.113.10', family: 4 },
                    },
                }),
                result('tcp', {
                    target: 'host-b.test:27017',
                    status: 'fail',
                    durationMs: 12,
                    facts: {
                        attempts: [{ address: '203.0.113.11', family: 4, outcome: 'failed', latencyMs: 11 }],
                        connectedAddress: null,
                    },
                }),
            ],
            describeFinding,
        );

        expect(details(output, 'networkConnection')?.evidence).toEqual([
            {
                kind: 'tcpHost',
                host: 'host-a.test',
                port: 27017,
                connectedAddress: '203.0.113.10',
                connectMs: 42.5,
                failedAddresses: [{ address: '2001:db8::5', connectMs: 3000 }, { address: '203.0.113.9' }],
                durationMs: 3046.5,
            },
            {
                kind: 'tcpHost',
                host: 'host-b.test',
                port: 27017,
                // One attempt: its connect time is all but the host's own time.
                failedAddresses: [{ address: '203.0.113.11' }],
                durationMs: 12,
            },
        ]);
    });

    it('lists what the Connection settings evidence line counts, without any secret', (): void => {
        const output = withRowDetails(rows(), operatorRun(), describeFinding);
        const settings = details(output, 'connectionSettings');

        expect(settings?.evidence).toEqual([
            {
                kind: 'connectionSettings',
                scheme: 'mongodb+srv',
                hosts: [cluster],
                user: 'stage0user',
                passwordPresent: true,
                authMethod: 'native',
                authSource: { value: 'admin', origin: 'dns' },
                options: [
                    { name: 'tls', value: 'true', hidden: false, source: 'uri' },
                    { name: 'authMechanism', value: 'SCRAM-SHA-256', hidden: false, source: 'uri' },
                    { name: 'appName', value: 'stage0-app', hidden: false, source: 'uri' },
                    { name: 'tlsCertificateKeyFilePassword', hidden: true, source: 'uri' },
                    { name: 'mysteryToken', hidden: true, source: 'uri' },
                    { name: 'authSource', value: 'admin', hidden: false, source: 'dns' },
                ],
            },
        ]);
        expect(JSON.stringify(output)).not.toContain('S3cret-value');
    });

    it('takes the authentication source from the URI, then the path, then the default', (): void => {
        const source = (facts: Record<string, unknown>): unknown => {
            const built = buildRowDetails(
                'connectionSettings',
                'done',
                [result('connectionString', { facts: { scheme: 'mongodb', hosts: [], ...facts } })],
                describeFinding,
            );
            const evidence = built?.evidence[0];
            return evidence?.kind === 'connectionSettings' ? evidence.authSource : undefined;
        };
        const authSource = { name: 'authSource', value: 'users', valueSupplied: true, known: true, sensitive: false };

        expect(source({ options: [authSource], database: 'orders' })).toEqual({ value: 'users', origin: 'uri' });
        expect(source({ options: [], database: 'orders' })).toEqual({ value: 'orders', origin: 'path' });
        expect(source({ options: [] })).toEqual({ value: 'admin', origin: 'default' });
    });

    it('offers no details on a healthy row that has nothing beyond its evidence line', (): void => {
        const quiet = operatorRun().map(
            (item): CheckResult<FindingCode> =>
                item.checkId.endsWith('nvironment') ? { ...item, findings: [] } : item,
        );
        expect(details(withRowDetails(rows(), quiet, describeFinding), 'setup')).toBeUndefined();
    });

    it('never offers details on a pending or active row', (): void => {
        const output = withRowDetails(
            rows({ serverAddress: 'active', networkConnection: 'pending', setup: 'pending' }),
            operatorRun(),
            describeFinding,
        );

        expect(details(output, 'serverAddress')).toBeUndefined();
        expect(details(output, 'networkConnection')).toBeUndefined();
        expect(details(output, 'setup')).toBeUndefined();
    });

    describe('a warning or error row always explains its status', () => {
        const cases: readonly { id: PanelRowId; status: 'warning' | 'error'; results: CheckResult<FindingCode>[] }[] =
            panelRowIds.flatMap((id) =>
                (['warning', 'error'] as const).map((status) => ({
                    id,
                    status,
                    // A check that ended this way without any finding: the worst case for the invariant.
                    results: [],
                })),
            );

        it.each(cases)('$id ($status) with no finding gets a generic explanation', ({ id, status, results }): void => {
            const built = buildRowDetails(id, status, results, describeFinding);

            expect(built?.findings[0]).toMatchObject({ severity: status });
            expect(built?.findings[0].nextStep).toContain('Show report');
        });

        it('a failed TCP probe with an unrecognised error code still explains the error', (): void => {
            const output = withRowDetails(
                rows({ networkConnection: 'error' }),
                [
                    result('tcp', {
                        target: 'host-a.test:27017',
                        status: 'fail',
                        facts: {
                            attempts: [{ address: '203.0.113.9', family: 4, outcome: 'failed', errorCode: 'EPROTO' }],
                            connectedAddress: null,
                        },
                    }),
                ],
                describeFinding,
            );
            const network = details(output, 'networkConnection');

            expect(network?.findings.map((item): string => item.severity)).toEqual(['error']);
            expect(network?.evidence).toEqual([
                {
                    kind: 'tcpHost',
                    host: 'host-a.test',
                    port: 27017,
                    failedAddresses: [{ address: '203.0.113.9' }],
                },
            ]);
        });

        it('an info-only finding does not explain a warning', (): void => {
            const built = buildRowDetails(
                'serverAddress',
                'warning',
                [
                    result('dns', {
                        target: 'a.test:27017',
                        status: 'warning',
                        findings: [finding('dns.loopback', 'info')],
                    }),
                ],
                describeFinding,
            );

            expect(built?.findings.map((item): string => item.severity)).toEqual(['warning', 'info']);
        });
    });

    it('orders findings by severity and merges the same finding across hosts', (): void => {
        const built = buildRowDetails(
            'serverAddress',
            'error',
            [
                result('dns', {
                    target: 'a.test:27017',
                    status: 'warning',
                    findings: [finding('dns.loopback', 'info')],
                }),
                result('dns', { target: 'b.test:27017', status: 'fail', findings: [finding('dns.notFound', 'error')] }),
                result('dns', {
                    target: 'c.test:27017',
                    status: 'warning',
                    findings: [finding('dns.loopback', 'info')],
                }),
            ],
            describeFinding,
        );

        expect(built?.findings.map((item) => [item.severity, item.targets])).toEqual([
            ['error', ['b.test']],
            ['info', ['a.test', 'c.test']],
        ]);
    });

    it('shows no finding codes, English package details or raw error codes', (): void => {
        const run = operatorRun();
        run.push(
            result('tcp', {
                target: 'b.test:27017',
                status: 'fail',
                findings: [finding('tcp.refused', 'error', { errorCode: 'ECONNREFUSED' })],
                facts: { attempts: [{ address: '10.0.0.5', family: 4, outcome: 'failed', errorCode: 'ECONNREFUSED' }] },
            }),
        );
        const text = JSON.stringify(withRowDetails(rows({ networkConnection: 'error' }), run, describeFinding));

        expect(text).not.toMatch(/\b(?:env|cs|srv|dns|tcp|tls|hello|auth|access|check|prepare)\.[a-z][a-z]+\b/);
        expect(text).not.toContain(englishDetail);
        expect(text).not.toContain('ECONNREFUSED');
        expect(text).not.toContain('AADSTS');
    });

    it('always shows full identifiers: Hide identifiers applies to the report only (0040)', (): void => {
        const run = operatorRun();
        for (const output of [
            withRowDetails(rows({ serverAddress: 'warning' }), report(run), describeFinding),
            withRowDetails(rows({ serverAddress: 'warning' }), run, describeFinding),
        ]) {
            expect(output.every((row) => row.details === undefined || 'findings' in row.details)).toBe(true);
            const text = JSON.stringify(output.map((row) => row.details));
            for (const identifier of [cluster, srvTarget, privateLink, publicAddress, 'stage0user']) {
                expect(text).toContain(identifier);
            }
            expect(text).not.toMatch(/"(?:host|address|user|database)-\d+"/);
        }
    });

    describe('Server greeting and Authentication layout', () => {
        const hello = (facts: Readonly<Record<string, unknown>>): CheckResult<FindingCode> =>
            result('hello', { target: 'node-a.example.com:27017', facts });
        const parsed = result('connectionString', { facts: { scheme: 'mongodb', hosts: [], options: [] } });

        it('negotiates the password mechanism from the greeting, and lists the rejected stage', (): void => {
            const auth = result('authenticate', {
                status: 'fail',
                facts: { authMethod: 'NativeAuth', mechanism: 'DEFAULT', userName: 'demo' },
                findings: [finding('auth.failed', 'error', { authMethod: 'NativeAuth', serverCode: 18 })],
            });
            const context = [parsed, hello({ saslSupportedMechs: ['SCRAM-SHA-1', 'SCRAM-SHA-256'] }), auth];

            const built = buildRowDetails('authentication', 'error', [auth], describeFinding, context);

            expect(built?.evidence).toEqual([
                {
                    kind: 'auth',
                    method: 'native',
                    mechanism: 'SCRAM-SHA-256',
                    mechanismNegotiated: true,
                    user: 'demo',
                    authSource: { value: 'admin', origin: 'default' },
                    stages: [{ stage: 'sendPassword', outcome: 'rejected' }],
                },
            ]);
        });

        it('falls back to SCRAM-SHA-1 as the driver does, and names no mechanism when none was offered', (): void => {
            const auth = result('authenticate', {
                facts: { authMethod: 'NativeAuth', mechanism: 'DEFAULT', userName: 'demo' },
            });
            const sha1 = buildRowDetails('authentication', 'done', [auth], describeFinding, [
                hello({ saslSupportedMechs: ['SCRAM-SHA-1'] }),
                auth,
            ]);
            const unknown = buildRowDetails('authentication', 'done', [auth], describeFinding, [
                hello({ saslSupportedMechs: [] }),
                auth,
            ]);

            expect(sha1?.evidence[0]).toMatchObject({ mechanism: 'SCRAM-SHA-1', mechanismNegotiated: true });
            expect(unknown?.evidence[0]).not.toHaveProperty('mechanism');
            expect(unknown?.evidence[0]).not.toHaveProperty('mechanismNegotiated');
        });

        it('lists both Microsoft Entra ID stages: the token was obtained, and the cluster rejected it', (): void => {
            const rejected = finding('auth.failed', 'error', { authMethod: 'MicrosoftEntraID', serverCode: 18 });
            const auth = result('authenticate', {
                status: 'fail',
                facts: { authMethod: 'MicrosoftEntraID', mechanism: 'MONGODB-OIDC', account: 'user@example.com' },
                steps: [
                    { stepId: 'auth.signInConfiguration', status: 'pass', durationMs: 1, facts: {}, findings: [] },
                    { stepId: 'auth.token', status: 'pass', durationMs: 1, facts: {}, findings: [] },
                    {
                        stepId: 'auth.serverAuthentication',
                        status: 'fail',
                        durationMs: 1,
                        facts: {},
                        findings: [rejected],
                    },
                ],
            });

            const built = buildRowDetails('authentication', 'error', [auth], describeFinding, [parsed, auth]);

            expect(built?.evidence).toEqual([
                {
                    kind: 'auth',
                    method: 'entraId',
                    mechanism: 'MONGODB-OIDC',
                    user: 'user@example.com',
                    stages: [
                        { stage: 'getToken', outcome: 'done' },
                        { stage: 'sendToken', outcome: 'rejected' },
                    ],
                },
            ]);
        });

        it('shows the preparation stage only when sign-in stopped there', (): void => {
            const auth = result('authenticate', {
                status: 'fail',
                facts: { authMethod: 'MicrosoftEntraID', mechanism: 'MONGODB-OIDC' },
                steps: [
                    { stepId: 'auth.signInConfiguration', status: 'fail', durationMs: 1, facts: {}, findings: [] },
                    {
                        stepId: 'auth.token',
                        status: 'skipped',
                        durationMs: 0,
                        facts: {},
                        findings: [],
                        skippedBecause: { reason: 'dependencyFailed', stepId: 'auth.signInConfiguration' },
                    },
                ],
            });

            const built = buildRowDetails('authentication', 'error', [auth], describeFinding);

            expect(built?.evidence[0]).toMatchObject({
                stages: [
                    { stage: 'prepareSignIn', outcome: 'failed' },
                    { stage: 'getToken', outcome: 'notRun' },
                ],
            });
        });

        it("shows a replica set member's role and the legacy greeting command, never a router's writability", (): void => {
            const member = hello({
                handshake: 'opQuery',
                topology: 'replicaSet',
                setName: 'rs0',
                isWritablePrimary: false,
                maxWireVersion: 17,
            });
            const router = hello({ handshake: 'opMsg', topology: 'shardedRouter', isWritablePrimary: true });

            expect(buildRowDetails('serverResponse', 'done', [member], describeFinding)?.evidence).toEqual([
                {
                    kind: 'serverHost',
                    host: 'node-a.example.com',
                    command: 'isMaster',
                    topology: 'replicaSet',
                    setName: 'rs0',
                    maxWireVersion: 17,
                    passwordMechanisms: [],
                    role: 'notPrimary',
                },
            ]);
            expect(
                buildRowDetails('serverResponse', 'done', [router], describeFinding)?.evidence[0],
            ).not.toHaveProperty('role');
        });
    });
});
