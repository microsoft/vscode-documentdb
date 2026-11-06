/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    timeoutsForProfile,
    type CheckResult,
    type DiagnosticsRun,
    type Finding,
} from '@documentdb-js/connection-diagnostics';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { describe, expect, it } from 'vitest';
import {
    applyCheckTelemetry,
    applyCompletedRunTelemetry,
    configureDiagnosticsTelemetry,
    maskDiagnosticsInput,
} from './telemetry';
import { type FindingCode } from './types';

function context(): IActionContext {
    return {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: {},
        valuesToMask: [],
    } as unknown as IActionContext;
}

describe('diagnostics telemetry boundaries', (): void => {
    it('allowlists, deduplicates and sorts finding codes, without copying facts or finding data and detail', (): void => {
        const ctx = context();
        const result = {
            checkId: 'tcp',
            status: 'fail',
            durationMs: 12,
            target: 'secret-host:27017',
            facts: { password: 'secret-password' },
            findings: [
                {
                    code: 'tcp.refused',
                    severity: 'error',
                    data: { user: 'secret-user' },
                    detail: { language: 'en', text: 'secret-detail' },
                },
                {
                    code: 'not-a-known-code-secret',
                    severity: 'error',
                    detail: { language: 'en', text: 'secret-detail' },
                },
            ],
            steps: [
                {
                    stepId: 'tcp.attempt',
                    status: 'fail',
                    durationMs: 3,
                    facts: {},
                    findings: [
                        {
                            code: 'cs.credentialsMissing',
                            severity: 'info',
                            detail: { language: 'en', text: 'secret-detail' },
                        },
                        { code: 'tcp.refused', severity: 'error', detail: { language: 'en', text: 'secret-detail' } },
                    ],
                },
            ],
        } as unknown as CheckResult<FindingCode>;
        applyCheckTelemetry(ctx, [result], 1);
        expect(ctx.telemetry.properties.findingCodes).toBe('cs.credentialsMissing,tcp.refused');
        expect(ctx.telemetry.measurements.tcpMaxDurationMs).toBe(12);
        expect(JSON.stringify(ctx.telemetry)).not.toContain('secret');
    });

    it('masks raw, parsed and encoded credentials without recording malformed parser errors', (): void => {
        const ctx = context();
        configureDiagnosticsTelemetry(ctx);
        maskDiagnosticsInput(ctx, 'mongodb://private-user:private-password@private.example/', 'private-password');
        maskDiagnosticsInput(ctx, 'mongodb://unparseable-secret@', 'password:@');
        expect(ctx.telemetry.maskEntireErrorMessage).toBe(true);
        expect(ctx.valuesToMask).toEqual(
            expect.arrayContaining([
                'private-user',
                'private-password',
                'private.example',
                'mongodb://private-user:private-password@private.example/',
                'mongodb://unparseable-secret@',
                'password:@',
                'password%3A%40',
            ]),
        );
        expect(ctx.telemetry.properties).toEqual({});
        expect(ctx.telemetry.measurements).toEqual({});
    });
});

describe('completed connection telemetry', (): void => {
    function check(checkId: string, options: Partial<CheckResult<FindingCode>> = {}): CheckResult<FindingCode> {
        return {
            checkId,
            status: 'pass',
            durationMs: 1,
            facts: { host: 'secret-host', user: 'secret-user', message: 'secret-message' },
            findings: [],
            ...options,
        };
    }

    function finding(code: FindingCode, data: Readonly<Record<string, unknown>> = {}): Finding<FindingCode> {
        return { code, severity: 'error', data, detail: { language: 'en', text: 'secret-message' } };
    }

    function telemetry(results: readonly CheckResult<FindingCode>[]): IActionContext['telemetry'] {
        const ctx = context();
        const run: DiagnosticsRun<FindingCode> = {
            runId: 'run',
            startedAt: 0,
            finishedAt: 1,
            durationMs: 1,
            timeoutProfile: 'default',
            timeouts: timeoutsForProfile('default'),
            targets: [{ host: 'secret-host', port: 27017, source: 'uri' }],
            results,
            coverage: {
                limited: false,
                retryWouldHelp: false,
                timedOut: [],
                notStartedCount: 0,
                omittedTargetCount: 0,
            },
        };
        applyCompletedRunTelemetry(ctx, run);
        expect(JSON.stringify(ctx.telemetry)).not.toMatch(/secret-host|secret-user|secret-message/);
        expect(ctx.telemetry.measurements).not.toHaveProperty('retryWouldHelp');
        // Whole-error masking redacts any property named like an error, whatever its value.
        expect(Object.keys(ctx.telemetry.properties).filter((key): boolean => /(error|exception)/i.test(key))).toEqual(
            [],
        );
        return ctx.telemetry;
    }

    it('uses the real connection outcome even when probes failed', (): void => {
        expect(
            telemetry([check('tcp', { status: 'fail', findings: [finding('tcp.refused')] }), check('authenticate')])
                .properties,
        ).toMatchObject({
            connectionOutcome: 'connected',
            firstBlockingCheck: 'tcp',
            firstBlockingPhase: 'none',
            authSkipReason: 'none',
            entraRuleId: 'none',
            aadstsCode: 'none',
        });
    });

    it('uses the headline check and blocking phase, not the earlier failed probe', (): void => {
        expect(
            telemetry([
                check('tcp', { status: 'fail', findings: [finding('tcp.refused')] }),
                check('authenticate', {
                    status: 'fail',
                    steps: [
                        {
                            stepId: 'auth.token',
                            status: 'fail',
                            durationMs: 1,
                            facts: { message: 'secret-message' },
                            findings: [
                                finding('auth.entraTokenFailed', {
                                    ruleId: 'firstPartyPreauthorization',
                                    aadstsCode: '65002',
                                    message: 'secret-message',
                                }),
                            ],
                        },
                    ],
                }),
            ]).properties,
        ).toMatchObject({
            connectionOutcome: 'failed',
            firstBlockingCheck: 'authenticate',
            firstBlockingPhase: 'auth.token',
            entraRuleId: 'firstPartyPreauthorization',
            aadstsCode: '65002',
        });
    });

    it('does not attribute a check-level headline to a later failing step', (): void => {
        expect(
            telemetry([
                check('authenticate', {
                    status: 'fail',
                    findings: [finding('auth.failed')],
                    steps: [
                        { stepId: 'auth.token', status: 'fail', durationMs: 1, facts: {}, findings: [] },
                        {
                            stepId: 'auth.serverAuthentication',
                            status: 'fail',
                            durationMs: 1,
                            facts: {},
                            findings: [finding('auth.failed')],
                        },
                    ],
                }),
            ]).properties,
        ).toMatchObject({ firstBlockingCheck: 'authenticate', firstBlockingPhase: 'none' });
    });

    it('keeps a native authentication failure at the check level', (): void => {
        expect(
            telemetry([check('authenticate', { status: 'fail', findings: [finding('auth.failed')] })]).properties,
        ).toMatchObject({
            connectionOutcome: 'failed',
            firstBlockingCheck: 'authenticate',
            firstBlockingPhase: 'none',
            authSkipReason: 'none',
        });
    });

    it.each(['method', 'password', 'entraSession'] as const)(
        'reports missing %s from the actual finding',
        (missing): void => {
            expect(
                telemetry([
                    check('authenticate', {
                        status: 'skipped',
                        skippedBecause: { reason: 'inputUnavailable' },
                        findings: [finding('auth.credentialsUnavailable', { missing })],
                    }),
                ]).properties,
            ).toMatchObject({
                connectionOutcome: 'notTested',
                firstBlockingCheck: 'authenticate',
                authSkipReason: missing,
            });
        },
    );

    it('identifies a whole-run timeout before authentication as not tested', (): void => {
        expect(
            telemetry([check('authenticate', { status: 'skipped', skippedBecause: { reason: 'runTimeoutExceeded' } })])
                .properties,
        ).toMatchObject({ connectionOutcome: 'notTested', authSkipReason: 'runTimeout', firstBlockingCheck: 'none' });
    });

    it('does not send arbitrary rule IDs, AADSTS data or missing-input categories', (): void => {
        expect(
            telemetry([
                check('authenticate', {
                    status: 'fail',
                    findings: [
                        finding('auth.entraTokenFailed', { ruleId: 'secret-user', aadstsCode: 'secret-message' }),
                        finding('auth.credentialsUnavailable', { missing: 'secret-host' }),
                    ],
                }),
            ]).properties,
        ).toMatchObject({ entraRuleId: 'none', aadstsCode: 'none', authSkipReason: 'none' });
    });

    it('does not send unrecognized numeric AADSTS categories', (): void => {
        expect(
            telemetry([
                check('authenticate', {
                    status: 'fail',
                    findings: [finding('auth.entraTokenFailed', { ruleId: 'unknownAadsts', aadstsCode: '12345' })],
                }),
            ]).properties,
        ).toMatchObject({ entraRuleId: 'unknownAadsts', aadstsCode: 'none' });
    });

    it('uses a failed prerequisite without findings as the blocking check', (): void => {
        expect(
            telemetry([
                check('prepare', { status: 'fail' }),
                check('authenticate', {
                    status: 'skipped',
                    skippedBecause: { reason: 'dependencyFailed', checkId: 'prepare' },
                }),
            ]).properties,
        ).toMatchObject({ connectionOutcome: 'failed', firstBlockingCheck: 'prepare', firstBlockingPhase: 'none' });
    });

    it('reports no target-resolution categories when the target resolved', (): void => {
        expect(telemetry([check('resolveTarget'), check('authenticate')]).properties).toMatchObject({
            targetSource: 'none',
            targetFailureReason: 'none',
            targetHttpStatus: 'none',
        });
    });

    it.each([
        ['target.sourceInaccessible', { source: 'azure', reason: 'accessDenied', statusCode: 403 }, '403'],
        ['target.sourceInaccessible', { source: 'kubernetes', reason: 'unreachable' }, 'none'],
        ['target.sourceInaccessible', { source: 'atlas', reason: 'signInRequired', statusCode: 401 }, '401'],
        ['target.endpointMissing', { source: 'kubernetes', reason: 'pending' }, 'none'],
        ['target.notFound', { source: 'azure', statusCode: 404 }, '404'],
    ] as const)('distinguishes %s from %j', (code, data, httpStatus): void => {
        const properties = telemetry([
            check('resolveTarget', { status: 'fail', findings: [finding(code, { ...data, errorName: 'RestError' })] }),
            check('authenticate', {
                status: 'skipped',
                skippedBecause: { reason: 'dependencyFailed', checkId: 'resolveTarget' },
            }),
        ]).properties;
        expect(properties).toMatchObject({
            firstBlockingCheck: 'resolveTarget',
            findingCodes: code,
            targetSource: data.source,
            targetFailureReason: 'reason' in data ? data.reason : 'none',
            targetHttpStatus: httpStatus,
        });
    });

    it('never sends unrecognized target-resolution values', (): void => {
        expect(
            telemetry([
                check('resolveTarget', {
                    status: 'fail',
                    findings: [
                        finding('target.sourceInaccessible', {
                            source: 'secret-host',
                            reason: 'secret-message',
                            statusCode: 'secret-user',
                        }),
                    ],
                }),
            ]).properties,
        ).toMatchObject({ targetSource: 'none', targetFailureReason: 'none', targetHttpStatus: 'none' });
    });
});
