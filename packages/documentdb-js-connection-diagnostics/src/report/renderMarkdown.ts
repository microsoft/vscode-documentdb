/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { redactReport } from './redact.js';
import { reportTimestamp } from './timestamps.js';

import { type CheckResult, type CheckStepResult, type DiagnosticsTimeouts } from '../types.js';
import { type RenderOptions, type ReportLabelKey, type ReportSectionId } from './text.js';
import { type DiagnosticsReport } from './types.js';

const checkSections: readonly ReportSectionId[] = [
    'environment',
    'connectionConfiguration',
    'preparation',
    'nameResolution',
    'transport',
    'wireProtocol',
    'authentication',
    'serverAndAccess',
    'additionalChecks',
];

const timeoutFields: readonly (keyof DiagnosticsTimeouts)[] = [
    'runTimeoutMs',
    'preparationTimeoutMs',
    'srvTimeoutMs',
    'probeTimeoutMs',
    'authenticationTimeoutMs',
    'postConnectTimeoutMs',
];

const builtInSections: Readonly<Record<string, ReportSectionId>> = {
    environment: 'environment',
    connectionString: 'connectionConfiguration',
    srv: 'nameResolution',
    dns: 'nameResolution',
    tcp: 'transport',
    tls: 'transport',
    hello: 'wireProtocol',
};

function escapeText(value: string): string {
    return value
        .replace(/[\r\n]+/g, ' ')
        .replace(/&/g, '&amp;')
        .replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&');
}

function codeSpan(value: string): string {
    return `\`${escapeText(value.replace(/`/g, ''))}\``;
}

function flattenFacts(
    facts: Readonly<Record<string, unknown>>,
    formatValue: (value: unknown, key: string) => string,
): string[][] {
    const rows: string[][] = [];
    function visit(value: unknown, path: string, key: string): void {
        if (Array.isArray(value)) {
            const entries = value as readonly unknown[];
            if (entries.length === 0) {
                rows.push([path, '—']);
            } else if (entries.every((entry): boolean => entry === null || typeof entry !== 'object')) {
                rows.push([path, entries.map((entry): string => formatValue(entry, key)).join(', ')]);
            } else {
                entries.forEach((entry, index): void => visit(entry, `${path}[${index}]`, key));
            }
        } else if (value !== null && typeof value === 'object') {
            const entries = Object.entries(value);
            if (entries.length === 0) {
                rows.push([path, '—']);
            }
            for (const [key, child] of entries) {
                visit(child, path ? `${path}.${key}` : key, key);
            }
        } else {
            rows.push([path, formatValue(value, key)]);
        }
    }
    for (const [key, value] of Object.entries(facts)) {
        visit(value, key, key);
    }
    return rows;
}

export function renderMarkdown<TCode extends string>(
    report: DiagnosticsReport<TCode>,
    options: RenderOptions<TCode>,
): string {
    const snapshot = options.redact ? redactReport(report) : report;
    const { text } = options;
    const grouped = new Map<ReportSectionId, CheckResult<TCode>[]>();
    for (const result of snapshot.results) {
        const sectionId =
            options.sectionOf?.(result.checkId) ??
            (Object.hasOwn(builtInSections, result.checkId) ? builtInSections[result.checkId] : 'additionalChecks');
        const results = grouped.get(sectionId) ?? [];
        results.push(result);
        grouped.set(sectionId, results);
    }
    const blocks: string[] = [`# ${escapeText(text.title)}`];
    const label = (key: ReportLabelKey): string => escapeText(text.label(key));
    const duration = (ms: number): string => `${escapeText(String(ms))} ${label('milliseconds')}`;
    function section(id: ReportSectionId): void {
        blocks.push(`## ${escapeText(text.sectionTitle(id))}`);
    }
    function table(headers: readonly string[], rows: readonly (readonly string[])[]): void {
        if (rows.length === 0) {
            return;
        }
        blocks.push(
            [
                `| ${headers.join(' | ')} |`,
                `| ${headers.map((): string => '---').join(' | ')} |`,
                ...rows.map((row): string => `| ${row.join(' | ')} |`),
            ].join('\n'),
        );
    }
    function factsTable(facts: Readonly<Record<string, unknown>>): void {
        table(
            [label('field'), label('value')],
            flattenFacts(facts, (value, key): string => {
                const date = reportTimestamp(value, key);
                return date === undefined ? String(value) : text.formatTimestamp(date);
            }).map((row): string[] => row.map(escapeText)),
        );
    }
    function checkName(checkId: string): string {
        return `${escapeText(text.checkLabel(checkId))} (${codeSpan(checkId)})`;
    }
    function statusLine(result: CheckResult<TCode> | CheckStepResult<TCode>): string {
        const parts = [
            `${label('status')}: ${escapeText(text.statusLabel(result.status))}`,
            `${label('duration')}: ${duration(result.durationMs)}`,
        ];
        if (result.status === 'skipped' && result.skippedBecause) {
            const skipped = result.skippedBecause;
            const origin = 'checkId' in skipped ? skipped.checkId : 'stepId' in skipped ? skipped.stepId : undefined;
            parts.push(
                `${label('reason')}: ${escapeText(text.skipReasonLabel(skipped.reason))}${origin === undefined ? '' : ` (${checkName(origin)})`}`,
            );
        }
        return parts.join(' · ');
    }
    function renderResult(result: CheckResult<TCode>): void {
        blocks.push(
            `### ${checkName(result.checkId)}${result.target === undefined ? '' : ` — ${escapeText(result.target)}`}`,
        );
        blocks.push(statusLine(result));
        factsTable(result.facts);
        for (const step of result.steps ?? []) {
            blocks.push(`#### ${checkName(step.stepId)}`);
            blocks.push(statusLine(step));
            if (step.findings.length > 0) {
                blocks.push(
                    `${label('code')}: ${step.findings.map((finding): string => codeSpan(finding.code)).join(', ')}`,
                );
            }
            factsTable(step.facts);
        }
    }

    function renderSectionResults(sectionId: ReportSectionId): void {
        for (const result of grouped.get(sectionId) ?? []) {
            renderResult(result);
        }
    }

    section('summary');
    const { summary } = snapshot;
    if (summary) {
        const headline = summary.headline;
        const parts: string[] = [`**${escapeText(text.outcomeLabel(summary.outcome))}**`];
        if (headline) {
            parts.push(escapeText(text.checkLabel(headline.checkId)));
            if (headline.target !== undefined) {
                parts.push(escapeText(headline.target));
            }
            if (headline.code !== undefined) {
                const result = snapshot.results.find(
                    (candidate): boolean =>
                        candidate.checkId === headline.checkId &&
                        (headline.target === undefined || candidate.target === headline.target) &&
                        (candidate.findings.some((finding): boolean => finding.code === headline.code) ||
                            (candidate.steps ?? []).some((step): boolean =>
                                step.findings.some((finding): boolean => finding.code === headline.code),
                            )),
                );
                const finding =
                    result &&
                    [
                        ...result.findings,
                        ...(result.steps ?? []).flatMap((step): typeof step.findings => step.findings),
                    ].find((candidate): boolean => candidate.code === headline.code);
                if (result && finding) {
                    parts.push(escapeText(text.describeFinding(finding, result).title));
                }
            }
        }
        blocks.push(parts.join(' — '));
        if (summary.location !== undefined) {
            blocks.push(`${label('location')}: ${escapeText(summary.location)}`);
        }
    }
    blocks.push(`${label('runId')}: ${escapeText(snapshot.runId)}`);
    blocks.push(`${label('startedAt')}: ${escapeText(text.formatTimestamp(new Date(snapshot.startedAt)))}`);
    blocks.push(`${label('finishedAt')}: ${escapeText(text.formatTimestamp(new Date(snapshot.finishedAt)))}`);
    table(
        [label('field'), label('value')],
        (summary?.serverRows ?? []).map((row): string[] => [escapeText(row.label), escapeText(row.value)]),
    );
    for (const note of summary?.notes ?? []) {
        blocks.push(escapeText(note));
    }
    renderSectionResults('summary');

    const retry = text.retryAdvice(snapshot.coverage);
    const nextSteps = [...(summary?.nextSteps ?? []), ...(retry ? [retry] : [])];
    if (nextSteps.length > 0 || grouped.has('nextSteps')) {
        section('nextSteps');
        if (nextSteps.length > 0) {
            blocks.push(nextSteps.map((step): string => `- ${escapeText(step)}`).join('\n'));
        }
        renderSectionResults('nextSteps');
    }

    section('coverage');
    blocks.push(`${label('timeoutProfile')}: ${escapeText(text.timeoutProfileLabel(snapshot.timeoutProfile))}`);
    table(
        [label('field'), label('configuredTimeout')],
        timeoutFields.map((key): string[] => [
            label(key),
            snapshot.timeouts[key] === null ? label('none') : duration(snapshot.timeouts[key]),
        ]),
    );
    if (snapshot.coverage.timedOut.length > 0) {
        blocks.push(label('timedOut'));
        table(
            [label('check'), label('target'), label('timeout'), label('source')],
            snapshot.coverage.timedOut.map((operation): string[] => [
                checkName(operation.checkId),
                escapeText(operation.target ?? '—'),
                duration(operation.timeoutMs),
                label(`${operation.source}TimeoutSource`),
            ]),
        );
    }
    blocks.push(`${label('notStarted')}: ${escapeText(String(snapshot.coverage.notStartedCount))}`);
    blocks.push(
        `${label('omittedTargets')}: ${snapshot.coverage.omittedTargetCount === 0 ? '0' : escapeText(text.omitted(snapshot.coverage.omittedTargetCount))}`,
    );
    if (snapshot.clockOffset) {
        const offset = snapshot.clockOffset;
        blocks.push(
            `${label('clockOffset')}: ${duration(offset.offsetMs)} · ${label('uncertainty')}: ${duration(offset.uncertaintyMs)} · ${label('target')}: ${escapeText(offset.target)}`,
        );
    }

    renderSectionResults('coverage');

    for (const sectionId of checkSections) {
        const results = grouped.get(sectionId);
        if (!results?.length) {
            continue;
        }
        section(sectionId);
        renderSectionResults(sectionId);
    }

    const findings = snapshot.results.flatMap((result): string[][] =>
        [...result.findings, ...(result.steps ?? []).flatMap((step): typeof step.findings => step.findings)].map(
            (finding): string[] => {
                const description = text.describeFinding(finding, result);
                return [
                    checkName(result.checkId),
                    escapeText(result.target ?? '—'),
                    codeSpan(finding.code),
                    label(finding.severity),
                    escapeText(description.title),
                    escapeText(description.explanation ?? '—'),
                    escapeText(description.nextStep ?? '—'),
                ];
            },
        ),
    );
    if (findings.length > 0 || grouped.has('findings')) {
        section('findings');
        const findingColumns: readonly ReportLabelKey[] = [
            'check',
            'target',
            'code',
            'severity',
            'title',
            'explanation',
            'nextStep',
        ];
        table(findingColumns.map(label), findings);
        renderSectionResults('findings');
    }
    if (snapshot.results.length > 0) {
        section('timings');
        table(
            [label('check'), label('target'), label('status'), label('duration')],
            snapshot.results.flatMap((result): string[][] => [
                [
                    checkName(result.checkId),
                    escapeText(result.target ?? '—'),
                    escapeText(text.statusLabel(result.status)),
                    duration(result.durationMs),
                ],
                ...(result.steps ?? []).map((step): string[] => [
                    `${checkName(result.checkId)} / ${checkName(step.stepId)}`,
                    escapeText(result.target ?? '—'),
                    escapeText(text.statusLabel(step.status)),
                    duration(step.durationMs),
                ]),
            ]),
        );
        renderSectionResults('timings');
    }
    const traceNote = text.traceNote(snapshot.runId);
    if (traceNote || grouped.has('trace')) {
        section('trace');
        if (traceNote) {
            blocks.push(escapeText(traceNote));
        }
        renderSectionResults('trace');
    }
    return `${blocks.join('\n\n').trimEnd()}\n`;
}
