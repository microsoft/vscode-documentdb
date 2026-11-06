/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';

import {
    buildReport,
    DEFAULT_TIMEOUTS,
    englishReportText,
    redactReport,
    renderJson,
    renderMarkdown,
} from '../index.js';

import {
    type CheckResult,
    type CheckStepResult,
    type DiagnosticsReport,
    type DiagnosticsRun,
    type Finding,
    type ReportOmissionKind,
    type ReportSummary,
} from '../index.js';

const host = 'private.example';
const payload = { host, text: 'safe\0text', list: Array.from({ length: 34 }, (_, index): number => index) };

function finding(code: string): Finding<string> {
    return {
        code,
        severity: 'warning',
        data: payload,
        detail: { language: 'en', text: `Observed\0 ${host}` },
    };
}

function run(result: CheckResult<string>): DiagnosticsRun<string> {
    return {
        runId: 'structural-lists',
        startedAt: 0,
        finishedAt: 100,
        durationMs: 100,
        timeoutProfile: 'default',
        timeouts: DEFAULT_TIMEOUTS,
        targets: [{ host, port: 27017, source: 'uri' }],
        results: [result],
        coverage: { limited: false, timedOut: [], notStartedCount: 0, omittedTargetCount: 0, retryWouldHelp: false },
    };
}

function expectFrozen(value: unknown): void {
    if (value !== null && typeof value === 'object') {
        expect(Object.isFrozen(value)).toBe(true);
        Object.values(value).forEach(expectFrozen);
    }
}

function expectCount(parent: object, key: string, length: number): void {
    if (length > 32) {
        expect(parent).toHaveProperty(key, length - 32);
    } else {
        expect(parent).not.toHaveProperty(key);
    }
}

describe.each([false, true])('bounded structural report lists (redact=%s)', (redact): void => {
    it.each(
        (['steps', 'stepFindings', 'findings', 'serverRows'] as const).flatMap((kind) =>
            [32, 33, 39].map((length) => ({ kind, length })),
        ),
    )('keeps typed $kind at $length entries through Markdown and JSON', ({ kind, length }): void => {
        const stepCount = kind === 'steps' ? length : 1;
        const stepFindingCount = kind === 'stepFindings' ? length : 1;
        const findingCount = kind === 'findings' ? length : 1;
        const rowCount = kind === 'serverRows' ? length : 1;
        const owner: CheckResult<string> = {
            checkId: 'custom',
            target: `${host}:27017`,
            status: 'fail',
            durationMs: 100,
            facts: payload,
            omittedFindingCount: 999,
            omittedStepCount: 999,
            findings: Array.from({ length: findingCount }, (_, index): Finding<string> => finding(`result.${index}`)),
            steps: Array.from({ length: stepCount }, (_, index): CheckStepResult<string> => ({
                stepId: `step\0-${index}`,
                status: index % 2 === 0 ? 'skipped' : 'warning',
                skippedBecause: { reason: 'dependencyFailed', stepId: 'earlier\0-step' },
                durationMs: index,
                facts: payload,
                omittedFindingCount: 999,
                findings: Array.from(
                    { length: stepFindingCount },
                    (_, findingIndex): Finding<string> => finding(`step.${index}.${findingIndex}`),
                ),
            })),
        };
        const summary: ReportSummary = {
            outcome: 'failed',
            omittedServerRowCount: 999,
            serverRows: Array.from({ length: rowCount }, (_, index) => ({
                label: `Server\0 ${index}`,
                value: `Observed\0 ${host}`,
            })),
            notes: ['Safe\0 note'],
            nextSteps: ['Safe\0 next step'],
            location: 'This\0 computer',
            headline: { checkId: 'custom', target: `${host}:27017`, code: 'result.0' },
        };
        const source = run(owner);
        const before = structuredClone({ source, summary });
        const report = buildReport(source, { summary });
        const snapshot = redact ? redactReport(report) : report;
        const markdown = renderMarkdown(report, { text: englishReportText, redact }).replace(/\\/g, '');
        const json = renderJson(report, { redact });
        const parsed = JSON.parse(json) as DiagnosticsReport<string>;
        for (const candidate of [snapshot, parsed]) {
            expect(candidate.schemaVersion).toBe(1);
            expect(candidate.coverage).toEqual(source.coverage);
            expect(candidate.results).toHaveLength(1);
            const result = candidate.results[0];
            expect(result.status).toBe('fail');
            expect(result.durationMs).toBe(100);
            expect(result.steps).toHaveLength(Math.min(32, stepCount));
            expect(result.findings).toHaveLength(Math.min(32, findingCount));
            expectCount(result, 'omittedStepCount', stepCount);
            expectCount(result, 'omittedFindingCount', findingCount);
            expect(candidate.summary?.serverRows).toHaveLength(Math.min(32, rowCount));
            expectCount(candidate.summary ?? {}, 'omittedServerRowCount', rowCount);
            expect(candidate.summary).toMatchObject({
                notes: ['Safe note'],
                nextSteps: ['Safe next step'],
                location: 'This computer',
            });
            for (const [index, row] of (candidate.summary?.serverRows ?? []).entries()) {
                expect(row).toEqual({ label: `Server ${index}`, value: `Observed ${redact ? 'host-1' : host}` });
            }
            for (const [index, entry] of result.findings.entries()) {
                expect(entry).toMatchObject({
                    code: `result.${index}`,
                    severity: 'warning',
                    data: { host: redact ? 'host-1' : host, text: 'safetext' },
                    detail: { language: 'en', text: `Observed ${redact ? 'host-1' : host}` },
                });
                expect(entry.data?.list).toEqual([...Array.from({ length: 32 }, (_, i): number => i), '[2 more omitted]']);
            }
            for (const [index, step] of (result.steps ?? []).entries()) {
                expect(step).toMatchObject({
                    stepId: `step-${index}`,
                    status: index % 2 === 0 ? 'skipped' : 'warning',
                    durationMs: index,
                    skippedBecause: { reason: 'dependencyFailed', stepId: 'earlier-step' },
                    facts: { host: redact ? 'host-1' : host, text: 'safetext' },
                });
                expect(step.findings).toHaveLength(Math.min(32, stepFindingCount));
                expectCount(step, 'omittedFindingCount', stepFindingCount);
                for (const [findingIndex, entry] of step.findings.entries()) {
                    expect(entry).toMatchObject({
                        code: `step.${index}.${findingIndex}`,
                        severity: 'warning',
                        data: { host: redact ? 'host-1' : host, text: 'safetext' },
                        detail: { language: 'en', text: `Observed ${redact ? 'host-1' : host}` },
                    });
                    expect(entry.data?.list).toHaveLength(33);
                    expect(entry.data?.list).toContain('[2 more omitted]');
                }
            }
        }
        const omissionKind: ReportOmissionKind = kind === 'stepFindings' ? 'findings' : kind;
        const notice = englishReportText.omittedEntries(omissionKind, length - 32);
        if (length > 32) {
            expect(markdown).toContain(notice);
            const findingsSection = markdown.split('## Findings')[1]?.split('## Timings')[0];
            if (kind !== 'serverRows') {
                expect(findingsSection).toContain(notice);
            }
            if (kind === 'steps') {
                expect(markdown.split('## Timings')[1]).toContain(notice);
            }
        } else {
            expect(markdown).not.toContain('more steps not shown');
            expect(markdown).not.toContain('more findings not shown');
            expect(markdown).not.toContain('more server rows not shown');
        }
        expect(markdown).not.toContain('Retry');
        expect(json).not.toContain('\\u0000');
        expect(json.includes(host)).toBe(!redact);
        expect(markdown.includes(host)).toBe(!redact);
        expectFrozen(report);
        expectFrozen(snapshot);
        expect({ source, summary }).toEqual(before);
        expect(Object.isFrozen(owner)).toBe(false);
        expect(Object.isFrozen(summary.serverRows)).toBe(false);
        expect(Object.isFrozen(payload)).toBe(false);
    });

    it.each(['steps', 'stepFindings', 'findings'] as const)(
        'preserves a headline code omitted from %s and explains the incomplete excerpt',
        (kind): void => {
            const count = 33;
            const source = run({
                checkId: 'custom',
                status: 'fail',
                durationMs: 1,
                facts: {},
                findings: kind === 'findings' ? Array.from({ length: count }, (_, i): Finding<string> => finding(`code.${i}`)) : [],
                steps: kind === 'findings' ? [] : Array.from({ length: kind === 'steps' ? count : 1 }, (_, index): CheckStepResult<string> => ({
                    stepId: `step-${index}`,
                    status: 'fail',
                    durationMs: 1,
                    facts: {},
                    findings: Array.from(
                        { length: kind === 'stepFindings' ? count : 1 },
                        (_, i): Finding<string> => finding(`code.${kind === 'steps' ? index : i}`),
                    ),
                })),
            });
            const report = buildReport(source, {
                summary: { outcome: 'failed', headline: { checkId: 'custom', code: 'code.32' } },
            });
            const omittedEntries = vi.fn((omissionKind: ReportOmissionKind, count: number): string =>
                `Localized ${omissionKind} ${count} | omitted`,
            );
            const describeFinding = vi.fn(englishReportText.describeFinding);
            const markdown = renderMarkdown(report, {
                text: { ...englishReportText, omittedEntries, describeFinding },
                redact,
            });
            const headline = markdown.split('\n').find((line): boolean => line.startsWith('**Failed**'));
            expect(headline).toContain('`code\\.32`');
            expect(headline).toContain(`Localized ${kind === 'steps' ? 'steps' : 'findings'} 1 \\| omitted`);
            expect(omittedEntries).toHaveBeenCalledWith(kind === 'steps' ? 'steps' : 'findings', 1);
            expect(describeFinding.mock.calls.every(([entry]): boolean => entry.code !== 'code.32')).toBe(true);
        },
    );
});

describe('structural report copy boundaries', (): void => {
    it('never trusts omission metadata for empty or absent structural lists', (): void => {
        const owner: CheckResult<string> = {
            checkId: 'custom',
            status: 'pass',
            durationMs: 1,
            findings: [],
            facts: {},
            omittedFindingCount: 123,
            omittedStepCount: 456,
        };
        for (const steps of [undefined, [], [{
            stepId: 'empty',
            status: 'pass' as const,
            durationMs: 1,
            findings: [],
            facts: {},
            omittedFindingCount: 789,
        }]]) {
            const report = buildReport(run({ ...owner, ...(steps === undefined ? {} : { steps }) }), {
                summary: { outcome: 'connected', serverRows: [], omittedServerRowCount: 123 },
            });
            expect(report.results[0]).not.toHaveProperty('omittedStepCount');
            expect(report.results[0]).not.toHaveProperty('omittedFindingCount');
            expect(report.results[0].steps?.[0] ?? {}).not.toHaveProperty('omittedFindingCount');
            expect(report.summary).not.toHaveProperty('omittedServerRowCount');
            if (steps === undefined) {
                expect(report.results[0]).not.toHaveProperty('steps');
            }
        }
    });

    it('sanitizes retained step facts and finding data with their own payload limits', (): void => {
        let nested: unknown = 'leaf';
        for (let depth = 0; depth < 7; depth++) {
            nested = { child: nested };
        }
        const facts = { nested, deeper: { child: nested }, text: `\0${'a'.repeat(8193)}`, invalid: new Date() };
        const report = buildReport(run({
            checkId: 'custom',
            status: 'pass',
            durationMs: 1,
            facts: {},
            findings: [],
            steps: [{
                stepId: 'phase',
                status: 'pass',
                durationMs: 1,
                facts,
                findings: [{ ...finding('custom.observed'), data: facts, detail: { language: 'en', text: facts.text } }],
            }],
        }));
        const step = report.results[0].steps?.[0];
        expect(step?.facts).not.toHaveProperty('invalid');
        expect(step?.facts.text).toBe(`${'a'.repeat(8192)} [truncated 1 characters]`);
        expect(JSON.stringify(step?.facts.nested)).toContain('leaf');
        expect(JSON.stringify(step?.facts.deeper)).toContain('[depth limit]');
        expect(step?.findings[0].data).toEqual(step?.facts);
        expect(step?.findings[0].detail.text).toBe(`${'a'.repeat(8192)} [truncated 1 characters]`);
        expectFrozen(report);
        expect(Object.isFrozen(facts)).toBe(false);
    });
});
