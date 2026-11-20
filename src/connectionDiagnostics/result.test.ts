/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CheckResult, type CheckStepResult, type Finding } from '@documentdb-js/connection-diagnostics';
import { describe, expect, it } from 'vitest';
import { Links } from '../constants';
import { describeFinding } from './findingMessages';
import { rowForCheck } from './panelRows';
import { deriveResult, type DiagnosticsResult } from './result';
import { type FindingCode } from './types';

function finding(
    code: FindingCode,
    data: Readonly<Record<string, unknown>> = {},
    severity: Finding<FindingCode>['severity'] = 'error',
): Finding<FindingCode> {
    return {
        code,
        severity,
        data,
        detail: { language: 'en', text: 'Never use convenience detail as visible wording.' },
    };
}

function check(checkId: string, options: Partial<CheckResult<FindingCode>> = {}): CheckResult<FindingCode> {
    return { checkId, status: 'pass', durationMs: 1, facts: {}, findings: [], ...options };
}

function step(
    stepId: string,
    code: FindingCode,
    data: Readonly<Record<string, unknown>> = {},
): CheckStepResult<FindingCode> {
    return { stepId, status: 'fail', durationMs: 1, facts: {}, findings: [finding(code, data)] };
}

function derive(results: readonly CheckResult<FindingCode>[]): DiagnosticsResult {
    return deriveResult(results, describeFinding);
}

const connected = check('authenticate', { facts: { authenticated: true } });
const deadSeed = check('tcp', { status: 'fail', target: 'dead.test:27017', findings: [finding('tcp.refused')] });
const answered = check('hello', { target: 'member.test:27017', facts: { topology: 'replicaSet' } });

function rejectCredentials(): CheckResult<FindingCode> {
    return check('authenticate', { status: 'fail', findings: [finding('auth.failed')] });
}

describe('deriveResult', (): void => {
    it.each([
        ['tcp', 'tcp.refused'],
        ['tcp', 'tcp.timeout'],
        ['tcp', 'tcp.unreachable'],
        ['tcp', 'tcp.reset'],
        ['tls', 'tls.handshakeRejectedByServer'],
        ['hello', 'hello.noReply'],
    ] as const)('omits the firewall hint when %s/%s proves a local failure', (checkId, code): void => {
        const result = derive([
            check(checkId, {
                status: 'fail',
                target: '127.0.0.1:10260',
                findings: [finding(code, { addressClass: 'loopback' })],
            }),
            check('authenticate', { status: 'fail', findings: [finding('auth.serverSelectionTimeout')] }),
        ]);
        expect(result).toMatchObject({
            outcome: 'failed',
            headline: { code },
            supporting: { corroboration: 'serverSelection' },
            firewallHint: false,
        });
        expect(result.headline?.nextStep).not.toMatch(/firewall|allowlist/i);
    });

    it('requires every failing finding and target to prove loopback, not just the headline', (): void => {
        const local = check('tcp', {
            status: 'fail',
            target: '127.0.0.1:10260',
            findings: [finding('tcp.refused', { addressClass: 'loopback' })],
        });
        const auth = check('authenticate', { status: 'fail', findings: [finding('auth.serverSelectionTimeout')] });
        expect(derive([local, { ...local, target: '[::1]:10260' }, auth]).firewallHint).toBe(false);
        for (const addressClass of ['public', 'private', 'linkLocal', 'mixed', undefined]) {
            const other = check('tcp', {
                status: 'fail',
                target: 'other.test:27017',
                findings: [finding('tcp.timeout', { addressClass })],
            });
            expect(derive([local, other, auth]).firewallHint).toBe(true);
            expect(derive([{ ...local, findings: [...local.findings, ...other.findings] }, auth]).firewallHint).toBe(
                true,
            );
        }
        expect(derive([local, check('tcp', { status: 'fail', target: 'unknown.test:27017' }), auth]).firewallHint).toBe(
            true,
        );
        expect(
            derive([
                local,
                check('hello', { status: 'fail', findings: [finding('check.timeout', { operation: 'hello' })] }),
                auth,
            ]).firewallHint,
        ).toBe(true);
    });

    it.each(['public', 'private', 'linkLocal', 'mixed', undefined])(
        'retains the hint for %s transport evidence even on a loopback-looking target',
        (addressClass): void => {
            const result = derive([
                check('tls', {
                    status: 'fail',
                    target: '127.0.0.1:10260',
                    findings: [finding('tls.handshakeRejectedByServer', { addressClass })],
                }),
                check('authenticate', { status: 'fail', findings: [finding('auth.serverSelectionTimeout')] }),
            ]);
            expect(result.firewallHint).toBe(true);
            expect(result.headline?.nextStep).toContain('A firewall or IP allowlist');
        },
    );

    it('does not infer loopback for an isolated driver timeout or discard a real authentication failure', (): void => {
        expect(
            derive([check('authenticate', { status: 'fail', findings: [finding('auth.serverSelectionTimeout')] })])
                .firewallHint,
        ).toBe(true);
        const local = check('tcp', {
            status: 'fail',
            findings: [finding('tcp.refused', { addressClass: 'loopback' })],
        });
        expect(derive([local, connected])).toMatchObject({ outcome: 'connected', firewallHint: false });
        expect(derive([local, rejectCredentials()])).toMatchObject({
            outcome: 'failed',
            headline: { code: 'auth.failed' },
            firewallHint: false,
        });
    });

    it.each([
        ['sourceUnreachable', 'Kubernetes API unreachable'],
        ['noReadyBackend', 'No ready pods behind the service'],
    ])('stops at preparation for %s without a network or authentication headline', (reason, title): void => {
        const result = derive([
            check('prepare', {
                status: 'fail',
                findings: [finding('prepare.failed', { providerId: 'kubernetes-port-forward', reason })],
            }),
            check('dns', { status: 'skipped', skippedBecause: { reason: 'dependencyFailed', checkId: 'prepare' } }),
            check('authenticate', {
                status: 'skipped',
                skippedBecause: { reason: 'dependencyFailed', checkId: 'prepare' },
            }),
        ]);
        expect(result).toMatchObject({
            outcome: 'failed',
            stoppedAtRow: 'connectionSettings',
            headline: { checkId: 'prepare', code: 'prepare.failed', title },
            firewallHint: false,
        });
        expect(result.supporting).toBeUndefined();
    });

    it('acceptance 1: a real connection produces a server line with the answering host and ping', (): void => {
        expect(
            derive([
                connected,
                check('connectionAccess', { facts: { pingMs: 12 } }),
                check('serverFacts', {
                    facts: {
                        versions: { server: '7.0.12' },
                        answeredBy: 'member.test:27017',
                        seedHosts: ['seed.test:27017'],
                    },
                }),
            ]),
        ).toMatchObject({
            outcome: 'connected',
            authenticated: true,
            serverLine: { serverVersion: '7.0.12', host: 'member.test', pingMs: 12 },
        });
    });

    it('acceptance 2: a dead seed never overturns a working member or creates a headline', (): void => {
        const result = derive([deadSeed, answered, connected]);
        expect(result.outcome).toBe('connected');
        expect(result.headline).toBeUndefined();
        expect(result.supporting).toBeUndefined();
        expect(result.firewallHint).toBe(false);
    });

    it('acceptance 2: a reachable member rejecting credentials outranks the dead seed without misleading supporting evidence', (): void => {
        const result = derive([deadSeed, answered, rejectCredentials()]);
        expect(result).toMatchObject({
            outcome: 'failed',
            stoppedAtRow: 'authentication',
            headline: { checkId: 'authenticate', code: 'auth.failed' },
            firewallHint: false,
        });
        expect(result.supporting).toBeUndefined();
    });

    it.each(['method', 'password', 'entraSession'] as const)(
        'acceptance 3: missing %s means not tested, with localized explanation',
        (missing): void => {
            const result = derive([
                answered,
                check('authenticate', {
                    status: 'skipped',
                    skippedBecause: { reason: 'inputUnavailable' },
                    findings: [finding('auth.credentialsUnavailable', { missing }, 'info')],
                }),
            ]);
            expect(result).toMatchObject({
                outcome: 'notTested',
                stoppedAtRow: 'authentication',
                headline: { code: 'auth.credentialsUnavailable' },
                firewallHint: false,
            });
            expect(result.headline?.explanation).toBeTruthy();
            expect(result.headline?.nextStep).toBeTruthy();
        },
    );

    it.each([
        ['auth.cloudMismatch', {}, 'microsoft-sovereign-cloud.environment'],
        [
            'auth.tokenResourceUnresolved',
            { kind: 'customCloudUnresolved' },
            'documentDB.customEnvironment.ossrdbmsEndpoint',
        ],
    ] as const)('acceptance 4: %s is a real failure naming the setting', (code, data, setting): void => {
        const result = derive([
            check('authenticate', { status: 'fail', steps: [step('auth.signInConfiguration', code, data)] }),
        ]);
        expect(result).toMatchObject({
            outcome: 'failed',
            stoppedAtRow: 'authentication',
            headline: { checkId: 'authenticate', code },
            firewallHint: false,
        });
        expect(result.headline?.nextStep).toContain(setting);
    });

    it('acceptance 5: listing and metadata warnings do not overturn connected', (): void => {
        const result = derive([
            connected,
            check('connectionAccess', {
                status: 'warning',
                findings: [finding('access.listDatabasesDenied', {}, 'warning')],
            }),
            check('serverFacts', { status: 'warning' }),
        ]);
        expect(result).toMatchObject({ outcome: 'connected' });
        expect(result.headline).toBeUndefined();
    });

    it('acceptance 6: probes can fail while the driver succeeds, including authentication warnings', (): void => {
        expect(
            derive([
                deadSeed,
                check('hello', { status: 'fail', findings: [finding('hello.noReply')] }),
                { ...connected, status: 'warning' },
            ]).outcome,
        ).toBe('connected');
    });

    it('acceptance 6: passing probes cannot hide a driver failure', (): void => {
        const result = derive([
            answered,
            check('authenticate', {
                status: 'fail',
                steps: [
                    step('auth.token', 'auth.entraTokenFailed', { ruleId: 'conditionalAccess', aadstsCode: '53003' }),
                    step('auth.serverAuthentication', 'auth.failed'),
                ],
            }),
        ]);
        expect(result.headline).toMatchObject({
            checkId: 'authenticate',
            code: 'auth.entraTokenFailed',
            title: describeFinding(finding('auth.entraTokenFailed')).title,
        });
        expect(result.outcome).toBe('failed');
    });

    it('acceptance 8: whole-run timeout before an attempt makes no unreachable claim', (): void => {
        const result = derive([
            deadSeed,
            check('authenticate', { status: 'skipped', skippedBecause: { reason: 'runTimeoutExceeded' } }),
        ]);
        expect(result).toMatchObject({ outcome: 'notTested', runTimeoutBeforeAttempt: true, firewallHint: false });
        expect(result.headline).toBeUndefined();
        expect(result.supporting).toBeUndefined();
    });

    it.each([
        'tcp.refused',
        'tcp.timeout',
        'tcp.unreachable',
        'tcp.reset',
        'hello.noReply',
        'tls.handshakeRejectedByServer',
    ] as const)('acceptance 9: %s supporting evidence enables the possible-firewall hint', (code): void => {
        const result = derive([
            check(code.split('.')[0], { status: 'fail', target: 'host.test:27017', findings: [finding(code)] }),
            check('authenticate', { status: 'fail', findings: [finding('auth.serverSelectionTimeout')] }),
        ]);
        // WI-27 (decision 0047): the failed probe is the root cause; the driver's timeout corroborates it.
        expect(result).toMatchObject({
            outcome: 'failed',
            stoppedAtRow: rowForCheck(code.split('.')[0]),
            headline: { code, target: 'host.test:27017' },
            firewallHint: true,
            supporting: {
                title: describeFinding(finding('auth.serverSelectionTimeout')).title,
                corroboration: 'serverSelection',
            },
        });
    });

    it('acceptance 9: an isolated authentication rejection never hints at a firewall', (): void => {
        expect(derive([rejectCredentials()]).firewallHint).toBe(false);
    });

    it.each(['cs.unparseable', 'tls.expired'] as const)(
        'does not attach firewall advice to isolated %s',
        (code): void => {
            const checkId = code === 'cs.unparseable' ? 'connectionString' : 'tls';
            expect(
                derive([
                    check(checkId, { status: 'fail', findings: [finding(code)] }),
                    check('authenticate', {
                        status: 'skipped',
                        skippedBecause: { reason: 'dependencyFailed', checkId },
                    }),
                ]).firewallHint,
            ).toBe(false);
        },
    );

    it('acceptance 11: negotiated snappy plus a failed ping stops at Database access with the compressor fix', (): void => {
        const result = derive([
            check('hello', {
                status: 'warning',
                findings: [finding('hello.compressorUnavailable', { compressor: 'snappy' }, 'warning')],
            }),
            connected,
            check('connectionAccess', { status: 'fail', facts: { command: 'ping' } }),
        ]);
        expect(result).toMatchObject({
            outcome: 'failed',
            stoppedAtRow: 'databaseAccess',
            headline: { checkId: 'hello', code: 'hello.compressorUnavailable' },
            firewallHint: false,
        });
        expect(result.headline?.nextStep).toBe('Remove snappy from the compressors option, or put zlib first.');
    });

    it('acceptance 11: DocumentDB ignores snappy and stays connected with only the settings warning', (): void => {
        expect(derive([connected])).toMatchObject({ outcome: 'connected' });
    });

    it('post-connect failures without a negotiated compressor do not overturn an owned connection', (): void => {
        expect(
            derive([connected, check('connectionAccess', { status: 'fail', facts: { command: 'ping' } })]).outcome,
        ).toBe('connected');
    });

    it('omits the server host when no server metadata is available, never substituting a URI seed', (): void => {
        const result = derive([
            check('connectionString', { facts: { hosts: [{ host: 'seed.test', port: 27017 }] } }),
            connected,
        ]);
        expect(result.outcome).toBe('connected');
        expect(result.serverLine?.host).toBeUndefined();
    });

    it('S5: a failed attempt with only the driver-options finding has a headline, explanation and next step', (): void => {
        const result = derive([
            check('authenticate', {
                status: 'fail',
                findings: [finding('auth.driverOptionsRejected', { errorName: 'MongoParseError' })],
            }),
        ]);
        expect(result).toMatchObject({
            outcome: 'failed',
            stoppedAtRow: 'authentication',
            headline: { code: 'auth.driverOptionsRejected', title: 'Connection options rejected' },
        });
        expect(result.headline?.explanation).toBeTruthy();
        expect(result.headline?.nextStep).toBeTruthy();
    });

    it('S5: the generic fallback never outranks a specific earlier observation', (): void => {
        const fallback = check('authenticate', {
            status: 'fail',
            findings: [finding('auth.connectFailed', { errorName: 'MongoNetworkError', phase: 'connect' })],
        });
        expect(derive([deadSeed, fallback]).headline?.code).toBe('tcp.refused');
        expect(derive([fallback])).toMatchObject({
            outcome: 'failed',
            headline: { code: 'auth.connectFailed', title: 'Connection attempt failed' },
        });
    });

    it('S1: a failed first seed is never presented as the server that answered', (): void => {
        const result = derive([
            check('tcp', { status: 'fail', target: 'dead.fixture.invalid:27017', findings: [finding('tcp.refused')] }),
            check('tcp', { target: 'live.fixture.invalid:27017' }),
            connected,
            check('connectionAccess', { facts: { pingMs: 7 } }),
            check('serverFacts', {
                facts: {
                    versions: { server: '7.0.12' },
                    seedHosts: ['dead.fixture.invalid:27017', 'live.fixture.invalid:27017'],
                    answeredBy: null,
                },
            }),
        ]);
        expect(result.outcome).toBe('connected');
        expect(result.serverLine).toMatchObject({ serverVersion: '7.0.12', pingMs: 7 });
        expect(result.serverLine?.host).toBeUndefined();
    });

    it('an invalid connection string without a runnable authentication check is failed', (): void => {
        expect(
            derive([check('connectionString', { status: 'fail', findings: [finding('cs.unparseable')] })]),
        ).toMatchObject({
            outcome: 'failed',
            stoppedAtRow: 'connectionSettings',
            headline: { code: 'cs.unparseable' },
        });
    });

    it('acceptance 12: DocumentDB gateway keeps engine and API versions distinct, without inferring the answering host from a seed', (): void => {
        const result = derive([
            connected,
            check('serverFacts', {
                facts: {
                    topology: 'documentdbGateway',
                    versions: { engine: '0.107.0', api: '7.0.12' },
                    seedHosts: ['[::1]:27017'],
                    answeredBy: null,
                },
            }),
        ]);
        expect(result.serverLine).toMatchObject({ engineVersion: '0.107.0', apiVersion: '7.0.12' });
        expect(result.serverLine?.host).toBeUndefined();
        expect(result.serverLine?.serverVersion).toBeUndefined();
    });

    it('No Authentication is connected but never authenticated', (): void => {
        expect(
            derive([check('authenticate', { facts: { authMethod: 'NoAuth', authenticated: false } })]),
        ).toMatchObject({ outcome: 'connected', authenticated: false });
    });

    it.each(['pass', 'fail', 'skipped'] as const)(
        'earlier sign-in failure never changes the %s outcome',
        (status): void => {
            const auth = check('authenticate', {
                status,
                ...(status === 'skipped' ? { skippedBecause: { reason: 'inputUnavailable' as const } } : {}),
                findings: [finding('auth.credentialsUnavailable', { missing: 'entraSession' }, 'info')],
            });
            const previous = derive([auth]);
            expect(
                derive([
                    { ...auth, facts: { earlierInSession: { ruleId: 'firstPartyPreauthorization', ageSeconds: 30 } } },
                ]),
            ).toMatchObject({ outcome: previous.outcome, earlierSignInFailure: true });
        },
    );

    it('orders supporting evidence by row and recorded target order, not event completion order', (): void => {
        const dns = check('dns', { status: 'fail', target: 'first.test:27017', findings: [finding('dns.notFound')] });
        const result = derive([
            deadSeed,
            dns,
            check('dns', { ...dns, target: 'second.test:27017' }),
            check('authenticate', { status: 'fail', findings: [finding('auth.serverSelectionTimeout')] }),
        ]);
        // WI-27: the earliest failed probe leads, in row and target order; the driver corroborates it.
        expect(result.headline).toMatchObject({ target: 'first.test:27017', code: 'dns.notFound' });
        expect(result.supporting).toMatchObject({ corroboration: 'serverSelection' });
    });

    it('uses an earlier row error if the failed owned attempt produced no finding', (): void => {
        expect(derive([deadSeed, check('authenticate', { status: 'fail' })])).toMatchObject({
            outcome: 'failed',
            stoppedAtRow: 'networkConnection',
            headline: { checkId: 'tcp', code: 'tcp.refused' },
        });
    });

    it('leaves the headline absent when preparation failed without a finding', (): void => {
        const result = derive([
            check('prepare', { status: 'fail' }),
            check('authenticate', {
                status: 'skipped',
                skippedBecause: { reason: 'dependencyFailed', checkId: 'prepare' },
            }),
        ]);
        expect(result).toMatchObject({ outcome: 'failed', stoppedAtRow: 'connectionSettings' });
        expect(result.headline).toBeUndefined();
    });

    it('follows dependency skips to the originating connection-string failure', (): void => {
        expect(
            derive([
                check('connectionString', { status: 'fail', findings: [finding('cs.unparseable')] }),
                check('prepare', {
                    status: 'skipped',
                    skippedBecause: { reason: 'dependencyFailed', checkId: 'connectionString' },
                }),
                check('authenticate', {
                    status: 'skipped',
                    skippedBecause: { reason: 'dependencySkipped', checkId: 'prepare' },
                }),
            ]),
        ).toMatchObject({
            outcome: 'failed',
            stoppedAtRow: 'connectionSettings',
            headline: { code: 'cs.unparseable' },
        });
    });

    it('includes a sanitized provider hint without changing the connection result', (): void => {
        expect(
            derive([connected, check('contextHints', { facts: { explanation: 'Start the stopped instance.' } })]),
        ).toMatchObject({ outcome: 'connected', providerHint: 'Start the stopped instance.' });
    });

    describe('WI-8: provider guidance repeats only unrelated evidence', (): void => {
        const explanation = 'Provider-specific guidance.';
        const privateAccessHint = 'Connect from the private network.';

        it.each([
            ['entra-sign-in', 'auth.entraTokenFailed', 'sovereignClouds', Links.SovereignClouds],
            ['srv-dns', 'srv.compressedReplyRejected', 'srvDns', Links.SrvDnsTroubleshooting],
            ['srv-dns', 'srv.notFound', 'srvDns', Links.SrvDnsTroubleshooting],
            ['srv-dns', 'srv.txtUnsupportedOption', 'srvDns', Links.SrvDnsTroubleshooting],
            ['srv-dns', 'srv.targetOutsideDomain', 'srvDns', Links.SrvDnsTroubleshooting],
        ] as const)(
            'replaces %s guidance for %s with its documentation, retaining any private-access hint',
            (providerId, code, topic, url): void => {
                for (const hint of [undefined, privateAccessHint]) {
                    const hints = check('contextHints', {
                        facts: { providerId, explanation, privateAccessHint: hint },
                    });
                    const result = derive([
                        check('authenticate', { status: 'fail', findings: [finding(code)] }),
                        hints,
                    ]);
                    expect(result.headline?.code).toBe(code);
                    expect(result.providerHint).toBe(hint);
                    expect(result.learnMore).toEqual({ topic, url });
                    expect(hints.facts.explanation).toBe(explanation);
                }
            },
        );

        it.each([
            ['entra-sign-in', 'auth.failed'],
            ['srv-dns', 'auth.entraTokenFailed'],
            ['entra-sign-in', 'srv.compressedReplyRejected'],
            ['localQuickStart', 'auth.entraTokenFailed'],
            ['kubernetes-port-forward', 'srv.compressedReplyRejected'],
            ['atlas', 'auth.entraTokenFailed'],
        ] as const)('keeps %s guidance for the unrelated %s headline', (providerId, code): void => {
            for (const hint of [undefined, privateAccessHint]) {
                const result = derive([
                    check('authenticate', { status: 'fail', findings: [finding(code)] }),
                    check('contextHints', { facts: { providerId, explanation, privateAccessHint: hint } }),
                ]);
                expect(result.providerHint).toBe(hint ? `${explanation} ${hint}` : explanation);
                expect(result.learnMore).toBeUndefined();
            }
        });

        it.each(['entra-sign-in', 'srv-dns'])('keeps %s guidance when there is no headline', (providerId): void => {
            const result = derive([
                connected,
                check('contextHints', { facts: { providerId, explanation, privateAccessHint } }),
            ]);
            expect(result.headline).toBeUndefined();
            expect(result.providerHint).toBe(`${explanation} ${privateAccessHint}`);
            expect(result.learnMore).toBeUndefined();
        });

        it.each([undefined, ''])(
            'keeps a private-access hint without a non-empty provider explanation (%s)',
            (explanation): void => {
                const result = derive([
                    rejectCredentials(),
                    check('contextHints', { facts: { providerId: null, explanation, privateAccessHint } }),
                ]);
                expect(result.providerHint).toBe(privateAccessHint);
                expect(result.learnMore).toBeUndefined();
            },
        );

        it('omits empty provider and private-access hints', (): void => {
            const result = derive([
                rejectCredentials(),
                check('contextHints', { facts: { explanation: '', privateAccessHint: '' } }),
            ]);
            expect(result.providerHint).toBeUndefined();
            expect(result.learnMore).toBeUndefined();
        });
    });

    it.each(['dns', 'tcp', 'tls', 'hello', 'authenticate'])(
        'a started %s timeout can suggest checking firewall rules',
        (checkId): void => {
            const timedOut = check(checkId, { status: 'fail', findings: [finding('check.timeout')] });
            const results =
                checkId === 'authenticate' ? [timedOut] : [timedOut, check('authenticate', { status: 'fail' })];
            expect(derive(results).firewallHint).toBe(true);
        },
    );

    describe('WI-27: the root cause leads when the driver reached no server (decision 0047)', (): void => {
        const tcpTimedOut = check('tcp', {
            status: 'fail',
            target: 'asf.com:27017',
            findings: [finding('check.timeout', { operation: 'tcp', timeoutMs: 10000, source: 'check' })],
        });

        it('a timed-out TCP probe and a driver timeout stop at Network connection, with the driver as corroboration', (): void => {
            const result = derive([
                tcpTimedOut,
                check('authenticate', {
                    status: 'fail',
                    facts: { authMethod: 'NoAuth' },
                    findings: [finding('auth.serverSelectionTimeout')],
                }),
            ]);
            expect(result).toMatchObject({
                outcome: 'failed',
                stoppedAtRow: 'networkConnection',
                headline: {
                    checkId: 'tcp',
                    target: 'asf.com:27017',
                    code: 'check.timeout',
                    title: 'Network connection timed out',
                },
                supporting: { corroboration: 'serverSelection' },
                firewallHint: true,
            });
        });

        it("a timed-out authenticate step corroborates as the driver's timeout", (): void => {
            const result = derive([
                tcpTimedOut,
                check('authenticate', {
                    status: 'fail',
                    findings: [finding('check.timeout', { operation: 'authenticate', timeoutMs: 45000 })],
                }),
            ]);
            expect(result).toMatchObject({
                stoppedAtRow: 'networkConnection',
                headline: { checkId: 'tcp' },
                supporting: { corroboration: 'timedOut' },
            });
        });

        it('without an earlier network failure, the driver timeout stays the Authentication headline', (): void => {
            const result = derive([
                check('tcp', { target: 'asf.com:27017' }),
                check('authenticate', { status: 'fail', findings: [finding('auth.serverSelectionTimeout')] }),
            ]);
            expect(result).toMatchObject({
                stoppedAtRow: 'authentication',
                headline: { code: 'auth.serverSelectionTimeout', title: 'No server selected' },
            });
            expect(result.supporting).toBeUndefined();
        });

        it('a rejected sign-in keeps its headline over a failed seed', (): void => {
            const result = derive([deadSeed, answered, rejectCredentials()]);
            expect(result).toMatchObject({ stoppedAtRow: 'authentication', headline: { code: 'auth.failed' } });
            expect(result.supporting).toBeUndefined();
        });

        it('a non-network earlier failure does not take over a driver timeout', (): void => {
            const result = derive([
                check('connectionString', {
                    status: 'warning',
                    findings: [finding('cs.unknownOption', { option: 'tlss' }, 'error')],
                }),
                check('authenticate', { status: 'fail', findings: [finding('auth.serverSelectionTimeout')] }),
            ]);
            expect(result.headline?.code).toBe('auth.serverSelectionTimeout');
        });
    });

    describe('WI-27: sign-in required with No authentication (decision 0048)', (): void => {
        const noAuth = check('authenticate', { facts: { authMethod: 'NoAuth', authenticated: false } });

        it('stays connected, with the sign-in finding as its headline and no stopped row', (): void => {
            const result = derive([
                noAuth,
                check('connectionAccess', {
                    status: 'warning',
                    facts: { pingMs: 93 },
                    findings: [finding('access.signInRequired', { command: 'listDatabases' }, 'warning')],
                }),
            ]);
            expect(result).toMatchObject({
                outcome: 'connected',
                signInRequired: true,
                authenticated: false,
                firewallHint: false,
                headline: { checkId: 'connectionAccess', code: 'access.signInRequired' },
            });
            expect(result.stoppedAtRow).toBeUndefined();
        });

        it('a denied listing or a working no-auth listing is not a sign-in requirement', (): void => {
            for (const access of [
                check('connectionAccess', {
                    status: 'warning',
                    findings: [finding('access.listDatabasesDenied', {}, 'warning')],
                }),
                check('connectionAccess', { facts: { pingMs: 3, databaseCount: 2 } }),
            ]) {
                const result = derive([noAuth, access]);
                expect(result.outcome).toBe('connected');
                expect(result.signInRequired).toBeUndefined();
                expect(result.headline).toBeUndefined();
            }
        });
    });
});
