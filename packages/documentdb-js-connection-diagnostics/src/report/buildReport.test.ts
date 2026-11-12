/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';

import { buildReport, createEnvironmentCheck, DEFAULT_TIMEOUTS, runDiagnostics } from '../index.js';
import { defaultIdentifierKeys } from './buildReport.js';

import { type CheckResult, type DiagnosticsRun, type ReportSummary } from '../index.js';

function result(checkId: string, facts: Readonly<Record<string, unknown>> = {}, target?: string): CheckResult<string> {
    return { checkId, ...(target === undefined ? {} : { target }), status: 'pass', durationMs: 1, findings: [], facts };
}

function run(results: readonly CheckResult<string>[]): DiagnosticsRun<string> {
    return {
        runId: 'snapshot-test',
        startedAt: 0,
        finishedAt: 12,
        durationMs: 12,
        timeoutProfile: 'default',
        timeouts: { ...DEFAULT_TIMEOUTS },
        targets: [{ host: 'db.test', port: 27017, source: 'uri' }],
        results,
        coverage: { limited: false, timedOut: [], notStartedCount: 0, omittedTargetCount: 0, retryWouldHelp: false },
    };
}

function expectFrozen(value: unknown): void {
    if (value !== null && typeof value === 'object') {
        expect(Object.isFrozen(value)).toBe(true);
        for (const child of Object.values(value)) {
            expectFrozen(child);
        }
    }
}

describe('report snapshots', (): void => {
    it('preserves check order, ISO timestamps, coverage and formatted IPv6 targets', (): void => {
        const source = run([result('second'), result('first')]);
        const report = buildReport({ ...source, targets: [{ host: '2001:db8::1', port: 27017, source: 'uri' }] });
        expect(report.results.map((entry): string => entry.checkId)).toEqual(['second', 'first']);
        expect(report).toMatchObject({
            schemaVersion: 1,
            runId: source.runId,
            startedAt: '1970-01-01T00:00:00.000Z',
            finishedAt: '1970-01-01T00:00:00.012Z',
            durationMs: 12,
            timeoutProfile: 'default',
            timeouts: source.timeouts,
            coverage: source.coverage,
            targets: ['[2001:db8::1]:27017'],
        });
    });

    it('makes sanitized, deeply frozen copies without freezing or retaining its inputs', (): void => {
        const facts = { host: 'db.test', nested: { number: 1, invalid: Infinity } };
        const summary: ReportSummary = { outcome: 'connected', notes: ['Earlier in this session'] };
        const source = run([
            {
                ...result('custom', facts),
                findings: [
                    {
                        code: 'custom.code',
                        severity: 'info',
                        data: { message: 'safe\0text', invalid: new Date() },
                        detail: { language: 'en', text: 'safe\0detail' },
                    },
                ],
                steps: [
                    {
                        stepId: 'phase',
                        status: 'pass',
                        durationMs: 1,
                        facts: { text: 'safe\rstep' },
                        findings: [
                            {
                                code: 'phase.code',
                                severity: 'info',
                                data: { value: undefined },
                                detail: { language: 'en', text: 'step\0detail' },
                            },
                        ],
                    },
                ],
            },
        ]);
        const report = buildReport(source, { summary, connectionName: 'Saved\0connection' });
        expectFrozen(report);
        expect(Object.isFrozen(facts)).toBe(false);
        expect(Object.isFrozen(summary)).toBe(false);
        expect(report.results[0].facts).toEqual({ host: 'db.test', nested: { number: 1 } });
        expect(report.results[0].findings[0]).toMatchObject({
            data: { message: 'safetext' },
            detail: { language: 'en', text: 'safedetail' },
        });
        expect(report.results[0].steps?.[0]).toMatchObject({
            facts: { text: 'safestep' },
            findings: [{ code: 'phase.code', data: {}, detail: { language: 'en', text: 'stepdetail' } }],
        });
        facts.nested.number = 2;
        expect(report.results[0].facts).toEqual({ host: 'db.test', nested: { number: 1 } });
        expect((): void => {
            (report.targets as string[]).push('other:1');
        }).toThrow();
        expect(report.connectionName).toBe('Savedconnection');
    });

    it('bounds steps without inserting non-step omission markers', (): void => {
        const steps = Array.from({ length: 33 }, (_, index): NonNullable<CheckResult<string>['steps']>[number] => ({
            stepId: `step-${index}`,
            status: 'pass',
            durationMs: 1,
            findings: [],
            facts: { invalid: new Date(), text: 'safe\0text' },
        }));
        const report = buildReport(run([{ ...result('custom'), steps }]));
        expect(report.results[0].steps).toHaveLength(32);
        expect(report.results[0].steps?.[0].facts).toEqual({ text: 'safetext' });
        expect(report.results[0].omittedStepCount).toBe(1);
    });

    it('selects the smallest hello clock uncertainty and keeps the first result on ties', (): void => {
        const source = run([
            result('hello', { clockOffsetMs: 500, clockUncertaintyMs: 5 }, 'first:27017'),
            result('hello', { clockOffsetMs: -200, clockUncertaintyMs: 2 }, 'second:27017'),
            result('hello', { clockOffsetMs: 300, clockUncertaintyMs: 2 }, 'third:27017'),
        ]);
        expect(buildReport(source).clockOffset).toEqual({ target: 'second:27017', offsetMs: -200, uncertaintyMs: 2 });
    });

    it('returns a null clock offset without a complete finite hello observation', (): void => {
        expect(buildReport(run([])).clockOffset).toBeNull();
        expect(
            buildReport(
                run([
                    result('other', { clockOffsetMs: 1, clockUncertaintyMs: 1 }, 'db:1'),
                    result('hello', { clockOffsetMs: 1, clockUncertaintyMs: null }, 'db:1'),
                    result('hello', { clockOffsetMs: Infinity, clockUncertaintyMs: 1 }, 'db:1'),
                ]),
            ).clockOffset,
        ).toBeNull();
    });

    it('only includes declared snapshot fields, never run input or extra result properties', (): void => {
        const extraResult = { ...result('custom'), input: 'private-input' };
        const source = { ...run([extraResult]), input: { connectionString: 'private-uri' } };
        const report = buildReport(source);
        expect(report).not.toHaveProperty('input');
        expect(report.results[0]).not.toHaveProperty('input');
        expect(JSON.stringify(report)).not.toContain('private-');
    });

    it('merges consumer classifications without changing defaults', (): void => {
        const keys = { host: 'endpoint', tenantId: 'tenant' } as const;
        const report = buildReport(run([]), { identifierKeys: keys });
        expect(report.identifierKeys).toEqual({ ...defaultIdentifierKeys, ...keys });
        expect(defaultIdentifierKeys.host).toBe('host');
        expect(Object.isFrozen(keys)).toBe(false);
    });

    it('builds a snapshot from actual checks with injected IO', async (): Promise<void> => {
        const source = await runDiagnostics({
            input: { connectionString: 'mongodb://db.test' },
            checks: [createEnvironmentCheck()],
            io: {
                environment: {
                    versions: { node: '22.18.0' },
                    platform: 'linux',
                    release: 'test',
                    arch: 'x64',
                    env: {},
                    timeZone: 'UTC',
                },
            },
        });
        const report = buildReport(source);
        expect(report.results[0].facts.nodeVersion).toBe('22.18.0');
        expectFrozen(report);
    });
});
