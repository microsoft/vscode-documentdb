/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { builtInFindingCodes, type CheckResult, type CheckStepResult } from '@documentdb-js/connection-diagnostics';
import { describe, expect, it, vi } from 'vitest';
import { entraErrorRules } from '../documentdb/auth/entraErrors/entraErrorRules';
import { formatEvidence } from '../webviews/documentdb/connectionDiagnostics/formatEvidence';
import { type EvidenceSegment } from '../webviews/documentdb/connectionDiagnostics/panelTypes';
import { describeFinding } from './findingMessages';
import { withRowDetails } from './panelDetails';
import { rowForCheck } from './panelRows';
import { checkResult, detailSentinel, finding, fixtureRun, host, outputs } from './test/fixtures';
import { extensionFindingCodes, type FindingCode } from './types';

vi.mock('@vscode/l10n', () => ({
    t: (message: string, ...args: unknown[]): string =>
        args.reduce<string>((result, value, index): string => result.replace(`{${index}}`, String(value)), message),
}));

const codes = [...builtInFindingCodes, ...extensionFindingCodes];

function checkFor(code: FindingCode): string {
    if (code === 'check.timeout') {
        return 'tcp';
    }
    if (code === 'env.remoteExtensionHost') {
        return 'extensionEnvironment';
    }
    if (code.startsWith('env.')) {
        return 'environment';
    }
    if (code.startsWith('target.')) {
        return 'resolveTarget';
    }
    if (code === 'cs.credentialsMissing') {
        return 'credentials';
    }
    if (code.startsWith('cs.')) {
        return 'connectionString';
    }
    if (code.startsWith('auth.')) {
        return 'authenticate';
    }
    if (code.startsWith('access.')) {
        return 'connectionAccess';
    }
    return code.split('.')[0];
}

function assertPlain(text: string, pingAllowed = false): void {
    expect(text).not.toContain(detailSentinel);
    expect(text).not.toMatch(/AADSTS|http/i);
    expect(pingAllowed ? text.replace(/\bPing \d+ ms\b/g, '') : text).not.toMatch(/\d+\s+ms\b/);
    for (const code of codes) {
        expect(text).not.toContain(code);
    }
    for (const rule of entraErrorRules) {
        expect(text).not.toContain(rule.id);
    }
}

function baseline(): CheckResult<FindingCode>[] {
    return [
        checkResult('environment', { facts: { platform: 'linux', release: '6.8', arch: 'x64' } }),
        checkResult('extensionEnvironment', { facts: { remoteKind: 'ssh' } }),
        checkResult('resolveTarget'),
        checkResult('connectionString', { facts: { scheme: 'mongodb', options: [] } }),
        checkResult('credentials'),
        checkResult('prepare'),
        checkResult('srv'),
        ...['dns', 'tcp', 'tls', 'hello'].map(
            (id): CheckResult<FindingCode> =>
                checkResult(id, {
                    target: `${host}:27017`,
                    facts: id === 'hello' ? { topology: 'documentdbGateway', isWritablePrimary: true } : {},
                }),
        ),
        checkResult('authenticate', { facts: { authMethod: 'MicrosoftEntraID', authenticated: true } }),
        checkResult('connectionAccess', { facts: { pingMs: 12, databaseCount: 5 } }),
        checkResult('serverFacts'),
    ];
}

function cardText(result: ReturnType<typeof outputs>['result']): string {
    return [
        result.headline?.title,
        result.headline?.explanation,
        result.headline?.nextStep,
        result.supporting?.title,
        result.providerHint,
    ]
        .filter(Boolean)
        .join(' ');
}

interface AuthOutcome {
    readonly name: string;
    readonly status: CheckResult<FindingCode>['status'];
    readonly code?: FindingCode;
    readonly phase?: string;
    readonly method?: 'ManagedIdentity';
    readonly facts?: Readonly<Record<string, unknown>>;
    readonly configuration?: Readonly<Record<string, unknown>>;
    readonly segments: readonly EvidenceSegment[];
    readonly evidence: string;
    readonly outcome: 'connected' | 'failed' | 'notTested';
    readonly fix?: string;
}

const authOutcomes: readonly AuthOutcome[] = [
    {
        name: 'passed in the public cloud',
        status: 'pass',
        facts: { account: 'alice@contoso.com' },
        segments: [
            { kind: 'authMethod', method: 'entraId' },
            { kind: 'account', label: 'alice@contoso.com' },
        ],
        evidence: 'Microsoft Entra ID · alice@contoso.com',
        outcome: 'connected',
    },
    {
        name: 'passed in a sovereign cloud',
        status: 'pass',
        facts: { account: 'alice@contoso.com' },
        configuration: { configuredCloud: 'AzureUSGovernment' },
        segments: [
            { kind: 'authMethod', method: 'entraId' },
            { kind: 'account', label: 'alice@contoso.com' },
            { kind: 'cloud', cloud: 'usGovernment' },
        ],
        evidence: 'Microsoft Entra ID · alice@contoso.com · Azure US Government',
        outcome: 'connected',
    },
    {
        name: 'cloud problem',
        status: 'fail',
        code: 'auth.cloudMismatch',
        phase: 'auth.signInConfiguration',
        segments: [
            { kind: 'authMethod', method: 'entraId' },
            { kind: 'clusterCloud', cloud: 'AzureUSGovernment' },
            { kind: 'signedInCloud', cloud: 'AzureCloud' },
        ],
        evidence: 'Microsoft Entra ID · Cluster in Azure US Government · Sign-in set to Azure',
        outcome: 'failed',
        fix: 'microsoft-sovereign-cloud.environment',
    },
    {
        name: 'not signed in',
        status: 'skipped',
        code: 'auth.credentialsUnavailable',
        segments: [{ kind: 'authMethod', method: 'entraId' }, { kind: 'noSilentSignIn' }],
        evidence: 'Microsoft Entra ID · No sign-in available without a prompt',
        outcome: 'notTested',
        fix: "Connect to the cluster once, then run the diagnosis again.",
    },
    {
        name: 'token request failed',
        status: 'fail',
        code: 'auth.entraTokenFailed',
        phase: 'auth.token',
        segments: [{ kind: 'authMethod', method: 'entraId' }, { kind: 'signInFailed' }],
        evidence: 'Microsoft Entra ID · Sign-in failed',
        outcome: 'failed',
        fix: 'Contact your IT help desk',
    },
    {
        name: 'server rejected the token',
        status: 'fail',
        code: 'auth.failed',
        phase: 'auth.serverAuthentication',
        segments: [{ kind: 'authMethod', method: 'entraId' }, { kind: 'signedInNotAccepted' }],
        evidence: 'Microsoft Entra ID · Token obtained · Token rejected by the cluster',
        outcome: 'failed',
        fix: 'added as a user on the cluster',
    },
    ...(['userAssigned', 'systemAssigned'] as const).map(
        (identityKind): AuthOutcome => ({
            name: `managed identity passed (${identityKind})`,
            method: 'ManagedIdentity',
            status: 'pass',
            facts: { managedIdentityKind: identityKind },
            segments: [
                { kind: 'authMethod', method: 'managedIdentity' },
                { kind: 'managedIdentityKind', identityKind },
            ],
            evidence: `Managed identity · ${identityKind === 'userAssigned' ? 'User-assigned' : 'System-assigned'}`,
            outcome: 'connected',
        }),
    ),
];

describe('Panel wording (design §4.9.2 and §5.2)', (): void => {
    it.each(codes)('keeps %s in the report, not in the rendered panel evidence', (code): void => {
        const checkId = checkFor(code);
        expect(rowForCheck(checkId)).toBeDefined();
        const results = baseline().map(
            (result): CheckResult<FindingCode> =>
                result.checkId === checkId ? { ...result, status: 'fail', findings: [finding(code)] } : result,
        );
        const view = outputs(fixtureRun(results));
        const row = view.projector.rows().find((item): boolean => item.id === rowForCheck(checkId));
        expect(row).toBeDefined();
        const rendered = formatEvidence(row?.segments ?? []) ?? '';
        expect(rendered.trim()).not.toBe('');
        assertPlain(rendered, row?.id === 'databaseAccess');
        for (const item of view.projector.rows()) {
            assertPlain(formatEvidence(item.segments) ?? '', item.id === 'databaseAccess');
        }
        assertPlain(cardText(view.result));
        expect(view.markdown.replace(/\\/g, '')).toContain(code);
        expect(view.markdown).not.toContain(detailSentinel);
        expect(view.json).toContain(code);
    });

    it.each(authOutcomes)('renders the documented evidence and card for $name', (sample): void => {
        const findings = sample.code ? [finding(sample.code)] : [];
        const phases = ['auth.signInConfiguration', 'auth.token', 'auth.serverAuthentication'];
        const blockingPhase = sample.phase ?? (sample.status === 'skipped' ? 'auth.token' : undefined);
        const steps: CheckStepResult<FindingCode>[] = phases.map((stepId, index): CheckStepResult<FindingCode> => {
            const dependencySkipped = blockingPhase !== undefined && index > phases.indexOf(blockingPhase);
            const skipped = dependencySkipped || (stepId === blockingPhase && sample.status === 'skipped');
            return {
                stepId,
                status: skipped ? 'skipped' : sample.phase === stepId ? 'fail' : 'pass',
                durationMs: skipped ? 0 : 1234,
                ...(skipped
                    ? {
                          skippedBecause: {
                              reason: dependencySkipped
                                  ? sample.status === 'skipped'
                                      ? 'dependencySkipped'
                                      : 'dependencyFailed'
                                  : 'inputUnavailable',
                              ...(dependencySkipped ? { stepId: blockingPhase } : {}),
                          },
                      }
                    : {}),
                facts:
                    stepId === 'auth.signInConfiguration'
                        ? { configuredCloud: 'AzureCloud', ...sample.configuration }
                        : {},
                findings: stepId === sample.phase ? findings : [],
            };
        });
        const auth = checkResult('authenticate', {
            status: sample.status,
            ...(sample.status === 'skipped' ? { skippedBecause: { reason: 'inputUnavailable' } } : {}),
            facts: {
                authMethod: sample.method ?? 'MicrosoftEntraID',
                authenticated: sample.status === 'pass',
                ...sample.facts,
            },
            findings: sample.phase ? [] : findings,
            steps,
        });
        const view = outputs(
            fixtureRun(
                baseline().map((item): CheckResult<FindingCode> => (item.checkId === 'authenticate' ? auth : item)),
            ),
        );
        const row = view.projector.rows().find((item): boolean => item.id === 'authentication');
        expect(row?.segments).toEqual(sample.segments);
        expect(formatEvidence(row?.segments ?? [])).toBe(sample.evidence);
        assertPlain(formatEvidence(row?.segments ?? []) ?? '');
        expect(view.result.outcome).toBe(sample.outcome);
        expect(view.result.authenticated).toBe(sample.status === 'pass');
        expect(view.result.firewallHint).toBe(false);
        if (sample.code) {
            expect(view.result.headline).toMatchObject({ code: sample.code, ...describeFinding(finding(sample.code)) });
            expect(view.markdown.replace(/\\/g, '')).toContain(sample.code);
        } else {
            expect(view.result.headline).toBeUndefined();
            expect(view.result.serverLine).toBeDefined();
        }
        if (sample.fix) {
            expect(view.result.headline?.nextStep).toContain(sample.fix);
        }
        assertPlain(cardText(view.result));
    });

    describe('WI-27 wording (decisions 0047 and 0048)', (): void => {
        function rowText(view: ReturnType<typeof outputs>, id: string): string {
            return formatEvidence(view.projector.rows().find((row): boolean => row.id === id)?.segments ?? []) ?? '';
        }

        it('an unreachable host names the TCP timeout, and the Authentication row does not read as a credential problem', (): void => {
            const results = baseline().map((item): CheckResult<FindingCode> => {
                switch (item.checkId) {
                    case 'tcp':
                        return {
                            ...item,
                            status: 'fail',
                            findings: [
                                finding('check.timeout', {
                                    operation: 'tcp',
                                    timeoutMs: 10000,
                                    source: 'check',
                                    target: `${host}:27017`,
                                }),
                            ],
                        };
                    case 'tls':
                    case 'hello':
                        return {
                            ...item,
                            status: 'skipped',
                            skippedBecause: { reason: 'dependencyFailed', checkId: 'tcp' },
                        };
                    case 'authenticate':
                        return {
                            ...item,
                            status: 'fail',
                            facts: { authMethod: 'NoAuth', authenticated: false },
                            findings: [finding('auth.serverSelectionTimeout')],
                        };
                    case 'connectionAccess':
                    case 'serverFacts':
                        return {
                            ...item,
                            status: 'skipped',
                            facts: {},
                            skippedBecause: { reason: 'dependencyFailed', checkId: 'authenticate' },
                        };
                    default:
                        return item;
                }
            });
            const view = outputs(fixtureRun(results));
            expect(rowText(view, 'networkConnection')).toBe(
                `Network connection timed out (${host}) · 0 of 1 hosts reachable · Port 27017`,
            );
            expect(rowText(view, 'authentication')).toBe('No authentication · Could not reach a server');
            expect(view.result).toMatchObject({
                stoppedAtRow: 'networkConnection',
                headline: { title: 'Network connection timed out', target: `${host}:27017` },
                supporting: { corroboration: 'serverSelection' },
            });
            for (const row of withRowDetails(view.projector.rows(), results, describeFinding)) {
                assertPlain(formatEvidence(row.segments) ?? '');
                assertPlain(JSON.stringify(row.details ?? {}));
                expect(JSON.stringify(row)).not.toMatch(/Step timed out|Did not finish in time/);
            }
            assertPlain(cardText(view.result));
        });

        it('sign-in required keeps codes and the server message out of the row, its details and the card', (): void => {
            const results = baseline().map((item): CheckResult<FindingCode> => {
                switch (item.checkId) {
                    case 'authenticate':
                        return { ...item, facts: { authMethod: 'NoAuth', authenticated: false } };
                    case 'connectionAccess':
                        return {
                            ...item,
                            status: 'warning',
                            facts: {
                                pingMs: 93,
                                commands: [
                                    { command: 'ping', outcome: 'ok', durationMs: 93 },
                                    {
                                        command: 'connectionStatus',
                                        outcome: 'signInRequired',
                                        durationMs: 4,
                                        codeName: 'Unauthorized',
                                    },
                                    {
                                        command: 'listDatabases',
                                        outcome: 'signInRequired',
                                        durationMs: 4,
                                        codeName: 'Unauthorized',
                                    },
                                ],
                            },
                            findings: [
                                {
                                    ...finding('access.signInRequired', { command: 'listDatabases' }),
                                    severity: 'warning',
                                },
                            ],
                        };
                    default:
                        return item;
                }
            });
            const view = outputs(fixtureRun(results));
            expect(rowText(view, 'databaseAccess')).toBe('Ping 93 ms · Listing databases needs sign-in');
            const access = withRowDetails(view.projector.rows(), results, describeFinding).find(
                (row): boolean => row.id === 'databaseAccess',
            );
            expect(access?.status).toBe('warning');
            expect(access?.details?.findings[0]).toMatchObject({
                severity: 'warning',
                title: 'Sign-in required to use this connection',
            });
            const details = JSON.stringify(access?.details ?? {});
            expect(details).not.toMatch(/Unauthorized|\b13\b/);
            assertPlain(details, true);
            expect(view.result).toMatchObject({ outcome: 'connected', signInRequired: true });
            assertPlain(cardText(view.result));
            expect(view.json).toContain('Unauthorized');
        });
    });
});
