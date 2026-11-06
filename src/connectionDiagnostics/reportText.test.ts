/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    buildReport,
    DEFAULT_TIMEOUTS,
    renderMarkdown,
    skipReasons,
    type CheckResult,
    type DiagnosticsRun,
    type ReportLabelKey,
    type ReportSectionId,
} from '@documentdb-js/connection-diagnostics';
import * as os from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { createExtensionReportAttribution, createExtensionReportText, renderExtensionReportFooter } from './reportText';
import { type FindingCode } from './types';

vi.mock('../extensionVariables', () => ({
    ext: {
        context: {
            extensionMode: 1,
            extension: { packageJSON: { version: '1.2.3' } },
        },
    },
}));

const sentinel = 'ENGLISH_DETAIL_MUST_NOT_BE_USED';
const checkLabels: Readonly<Record<string, string>> = {
    environment: 'Diagnosis setup',
    extensionEnvironment: 'Diagnosis setup',
    connectionString: 'Connection settings',
    credentials: 'Connection settings',
    prepare: 'Connection settings',
    srv: 'Server address (DNS)',
    dns: 'Server address (DNS)',
    tcp: 'Network connection (TCP)',
    tls: 'Secure connection (TLS)',
    hello: 'Server greeting',
    authenticate: 'Authentication',
    connectionAccess: 'Database access',
    serverFacts: 'Database access',
    contextHints: 'Context hints',
};

function fixtureRun(coverage: Partial<DiagnosticsRun<FindingCode>['coverage']> = {}): DiagnosticsRun<FindingCode> {
    return {
        runId: 'fixture-run',
        startedAt: Date.UTC(2026, 9, 29, 12),
        finishedAt: Date.UTC(2026, 9, 29, 12, 0, 10),
        durationMs: 10000,
        timeoutProfile: 'default',
        timeouts: DEFAULT_TIMEOUTS,
        targets: [{ host: 'cluster.example', port: 27017, source: 'uri' }],
        coverage: {
            limited: true,
            retryWouldHelp: true,
            notStartedCount: 0,
            omittedTargetCount: 1,
            timedOut: [{ checkId: 'tcp', source: 'check', timeoutMs: 10000 }],
            ...coverage,
        },
        results: Object.keys(checkLabels).map(
            (checkId): CheckResult<FindingCode> => ({
                checkId,
                status: checkId === 'tcp' ? 'fail' : 'pass',
                durationMs: 10,
                facts: {},
                findings:
                    checkId === 'tcp'
                        ? [
                              {
                                  code: 'check.timeout',
                                  severity: 'error',
                                  data: { operation: 'tcp', timeoutMs: 10000, source: 'check' },
                                  detail: { language: 'en', text: sentinel },
                              },
                          ]
                        : [],
            }),
        ),
    };
}

function fixtureMarkdown(run: DiagnosticsRun<FindingCode> = fixtureRun()): string {
    return renderMarkdown(
        buildReport(run, {
            summary: { outcome: 'failed', headline: { checkId: 'tcp', code: 'check.timeout' } },
        }),
        { text: createExtensionReportText(), redact: false },
    );
}

describe('localized connectivity report text', () => {
    it.each([
        ['steps', '{0} more steps not shown'],
        ['findings', '{0} more findings not shown'],
        ['serverRows', '{0} more server rows not shown'],
    ] as const)('localizes %s omissions with their count', (kind, template): void => {
        const localize = vi.spyOn(vscode.l10n, 't').mockImplementation((message, ...args): string => {
            const value = typeof message === 'string' ? message : message.message;
            return `Localized: ${value.replace('{0}', String(args[0]))}`;
        });
        try {
            const text = createExtensionReportText();
            expect(text.omittedEntries(kind, 7)).toBe(`Localized: ${template.replace('{0}', '7')}`);
            expect(localize).toHaveBeenCalledWith(template, 7);
        } finally {
            localize.mockRestore();
        }
    });

    it.each([false, true])('renders localized structural omissions without timeout advice (redact=%s)', (redact): void => {
        const source = fixtureRun({
            limited: false,
            timedOut: [],
            retryWouldHelp: false,
            omittedTargetCount: 0,
        });
        const findings = source.results.find((result): boolean => result.checkId === 'tcp')?.findings ?? [];
        const report = buildReport({
            ...source,
            results: [{
                checkId: 'tcp',
                status: 'fail',
                durationMs: 1,
                facts: {},
                findings: Array.from({ length: 33 }, () => findings[0]),
                steps: Array.from({ length: 34 }, (_, index) => ({
                    stepId: `step-${index}`,
                    status: 'pass',
                    durationMs: 1,
                    facts: {},
                    findings: Array.from({ length: 35 }, () => findings[0]),
                })),
            }],
        }, {
            summary: {
                outcome: 'failed',
                serverRows: Array.from({ length: 36 }, () => ({ label: 'Server', value: 'DocumentDB' })),
            },
        });
        const markdown = renderMarkdown(report, { text: createExtensionReportText(), redact });
        for (const [template, count] of [
            ['{0} more findings not shown', 1],
            ['{0} more findings not shown', 3],
            ['{0} more steps not shown', 2],
            ['{0} more server rows not shown', 4],
        ] as const) {
            expect(markdown).toContain(template.replace('{0}', String(count)));
            expect(vscode.l10n.t).toHaveBeenCalledWith(template, count);
        }
        expect(markdown).not.toContain('Choose Retry');
        expect(report.coverage).toEqual(source.coverage);
    });

    it('renders localized section titles, row names and findings without convenience English', () => {
        const markdown = fixtureMarkdown();
        expect(markdown).toContain('# Connection diagnostics');
        for (const section of [
            'Summary',
            'Next steps',
            'Coverage and limits',
            'Environment',
            'Connection configuration',
            'Name resolution',
            'Transport',
            'Wire protocol',
            'Additional checks',
            'Findings',
            'Timings',
            'Trace',
        ]) {
            expect(markdown).toContain(`## ${section}`);
            expect(vscode.l10n.t).toHaveBeenCalledWith(section);
        }
        for (const [checkId, label] of Object.entries(checkLabels)) {
            const escaped = label.replace(/[()]/g, '\\$&');
            expect(markdown).toContain(`${escaped} (\`${checkId}\`)`);
            expect(vscode.l10n.t).toHaveBeenCalledWith(label);
        }
        // WI-27: a timed-out TCP probe reads as a network timeout; the code stays check.timeout.
        expect(markdown).toContain('Network connection timed out');
        expect(markdown).toContain('`check\\.timeout`');
        expect(markdown).not.toContain(sentinel);
        expect(markdown).toContain('Retry with longer timeouts');
        expect(markdown).toContain('Retry without diagnostic timeouts may wait until cancelled');
        expect(markdown).toContain('The DocumentDB output channel lines for this run carry run ID fixture\\-run\\.');
    });

    it('reports the connection timeout setting rather than Retry buttons when retries cannot help', () => {
        const run = fixtureRun({
            retryWouldHelp: false,
            omittedTargetCount: 0,
            timedOut: [{ checkId: 'tcp', source: 'connection', timeoutMs: 10000 }],
        });
        const connectionRun: DiagnosticsRun<FindingCode> = {
            ...run,
            results: run.results.map(
                (result): CheckResult<FindingCode> =>
                    result.checkId === 'tcp'
                        ? {
                              ...result,
                              findings: result.findings.map((finding) => ({
                                  ...finding,
                                  data: { ...finding.data, source: 'connection' },
                              })),
                          }
                        : result,
            ),
        };
        const markdown = fixtureMarkdown(connectionRun).replace(/\\/g, '');
        expect(markdown).toContain('Network connection timed out');
        expect(markdown).toContain('The TCP connection attempt timed out without connecting.');
        expect(markdown).toContain('Increase the timeout configured on this connection, then run the diagnosis again.');
        expect(markdown).toContain('A firewall or IP allowlist may be blocking this connection.');
        expect(markdown).not.toContain('Choose Retry with longer timeouts');
        expect(markdown).not.toContain('Retry without diagnostic timeouts');
    });

    it('localizes sections for extension checks when the renderer groups them there', () => {
        const sections: Readonly<Record<string, ReportSectionId>> = {
            prepare: 'preparation',
            authenticate: 'authentication',
            connectionAccess: 'serverAndAccess',
        };
        const markdown = renderMarkdown(buildReport(fixtureRun()), {
            text: createExtensionReportText(),
            redact: false,
            sectionOf: (checkId): ReportSectionId | undefined => sections[checkId],
        });
        for (const title of ['Preparation', 'Authentication', 'Server and access']) {
            expect(markdown).toContain(`## ${title}`);
        }
    });

    it('uses localization rather than the package English defaults', () => {
        const localize = vi.spyOn(vscode.l10n, 't').mockImplementation((message, ...args): string => {
            const template = typeof message === 'string' ? message : message.message;
            return `Localized: ${template.replace(/\{(\d+)\}/g, (_match: string, index: string): string => String(args[Number(index)]))}`;
        });
        try {
            const markdown = fixtureMarkdown();
            expect(markdown).toContain('# Localized: Connection diagnostics');
            expect(markdown).toContain('## Localized: Coverage and limits');
            expect(markdown).toContain('Localized: Network connection \\(TCP\\)');
            expect(markdown).toContain('Localized: Network connection timed out');
            expect(markdown).toContain('Localized: Choose Retry with longer timeouts');
            expect(markdown).toContain('Localized: Status');
        } finally {
            localize.mockRestore();
        }
    });

    it('returns unknown check IDs unchanged, including inherited names', () => {
        const text = createExtensionReportText();
        for (const checkId of ['customCheck', 'auth.token', 'toString', '__proto__']) {
            expect(text.checkLabel(checkId)).toBe(checkId);
        }
    });

    it('localizes every section, label, status, skip reason, outcome and timeout profile', () => {
        const text = createExtensionReportText();
        const sections: readonly ReportSectionId[] = [
            'summary',
            'nextSteps',
            'coverage',
            'environment',
            'connectionConfiguration',
            'preparation',
            'nameResolution',
            'transport',
            'wireProtocol',
            'authentication',
            'serverAndAccess',
            'additionalChecks',
            'findings',
            'timings',
            'trace',
        ];
        const labels: readonly ReportLabelKey[] = [
            'check',
            'target',
            'status',
            'duration',
            'reason',
            'code',
            'severity',
            'title',
            'field',
            'value',
            'runId',
            'startedAt',
            'finishedAt',
            'location',
            'timeoutProfile',
            'timeout',
            'configuredTimeout',
            'source',
            'omittedTargets',
            'notStarted',
            'timedOut',
            'explanation',
            'nextStep',
            'clockOffset',
            'uncertainty',
            'none',
            'milliseconds',
            'runTimeoutMs',
            'preparationTimeoutMs',
            'srvTimeoutMs',
            'probeTimeoutMs',
            'authenticationTimeoutMs',
            'postConnectTimeoutMs',
            'info',
            'warning',
            'error',
            'checkTimeoutSource',
            'runTimeoutSource',
            'connectionTimeoutSource',
        ];
        const values = [
            text.title,
            ...sections.map(text.sectionTitle),
            ...labels.map(text.label),
            ...(['pass', 'warning', 'fail', 'skipped'] as const).map(text.statusLabel),
            ...skipReasons.map(text.skipReasonLabel),
            ...(['connected', 'failed', 'notTested'] as const).map(text.outcomeLabel),
            ...(['default', 'longer', 'noDiagnosticTimeouts'] as const).map(text.timeoutProfileLabel),
        ];
        for (const value of values) {
            expect(value.trim()).not.toBe('');
            expect(vscode.l10n.t).toHaveBeenCalledWith(value);
        }
        expect(text.omitted(3)).toBe('3 more omitted');
        expect(text.traceNote('run-123')).toBe(
            'The DocumentDB output channel lines for this run carry run ID run-123.',
        );
    });

    it('requires changing a limiting connection timeout before a longer retry can help', () => {
        const connectionTimeout = { checkId: 'authenticate', source: 'connection', timeoutMs: 3000 } as const;
        for (const retryWouldHelp of [true, false]) {
            const run = fixtureRun({ retryWouldHelp, timedOut: [connectionTimeout] });
            const advice = createExtensionReportText().retryAdvice(run.coverage);
            expect(advice).toContain('Change that connection setting before a longer retry can help.');
            expect(fixtureMarkdown(run)).toContain('A connection\\-configured timeout limited this run');
            expect(advice?.includes('Retry without diagnostic timeouts')).toBe(retryWouldHelp);
        }
    });

    it('does not recommend a timeout retry when coverage was not timeout-limited', () => {
        const coverage = fixtureRun({
            limited: false,
            timedOut: [],
            retryWouldHelp: false,
            omittedTargetCount: 0,
        }).coverage;
        expect(createExtensionReportText().retryAdvice(coverage)).toBeUndefined();
        const run = fixtureRun(coverage);
        const completedRun: DiagnosticsRun<FindingCode> = {
            ...run,
            results: run.results.map(
                (result): CheckResult<FindingCode> => ({ ...result, status: 'pass', findings: [] }),
            ),
        };
        expect(fixtureMarkdown(completedRun)).not.toContain('Retry with longer timeouts');
    });
});

describe('report attribution', () => {
    it('identifies the extension, Marketplace listing and versions without running environment checks', () => {
        expect(createExtensionReportAttribution()).toEqual({
            description: 'This report was generated using the DocumentDB extension for Visual Studio Code.',
            marketplaceUrl: 'https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-documentdb',
            extensionVersion: '1.2.3',
            extensionChannel: 'stable',
            vscodeVersion: vscode.version,
            nodeVersion: process.version,
            osInfo: `${os.type()} ${os.arch()} ${os.release()}`,
        });
        const footer = renderExtensionReportFooter();
        expect(footer).toContain('## About this report');
        expect(footer).toContain(
            '[Get the extension on Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-documentdb)',
        );
        expect(footer.replaceAll('\\', '')).toContain('Extension version: 1.2.3');
        expect(footer.replaceAll('\\', '')).toContain('Extension channel: stable');
        expect(footer.replaceAll('\\', '')).toContain(`VS Code version: ${vscode.version}`);
        expect(footer.replaceAll('\\', '')).toContain(`Node.js: ${process.version}`);
        expect(footer.replaceAll('\\', '')).toContain(`OS: ${os.type()} ${os.arch()} ${os.release()}`);
        expect(footer).not.toContain('Discovery');
        expect(footer).not.toContain('Migration');
    });

    it('localizes and escapes footer prose without escaping the trusted Marketplace link', () => {
        const localize = vi.spyOn(vscode.l10n, 't').mockImplementation((message, ...args): string => {
            const template = typeof message === 'string' ? message : message.message;
            return `[Localized] ${template.replace(/\{(\d+)\}/g, (_match: string, index: string): string => String(args[Number(index)]))}`;
        });
        try {
            const footer = renderExtensionReportFooter();
            expect(footer).toContain(String.raw`## \[Localized\] About this report`);
            expect(footer).toContain(String.raw`\[Localized\] This report was generated using`);
            expect(footer).toContain(
                String.raw`[\[Localized\] Get the extension on Visual Studio Marketplace](https://`,
            );
            expect(footer).toContain(String.raw`\[Localized\] Extension version\: 1\.2\.3`);
        } finally {
            localize.mockRestore();
        }
    });
});

describe('report timestamps', () => {
    const originalLanguage = Object.getOwnPropertyDescriptor(vscode.env, 'language');
    const date = new Date('2026-11-02T15:12:08.123Z');
    const options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'long' };

    afterEach(() => {
        if (originalLanguage) {
            Object.defineProperty(vscode.env, 'language', originalLanguage);
        } else {
            Reflect.deleteProperty(vscode.env, 'language');
        }
    });

    it('uses the VS Code locale and local zone with identical UTC ISO suffixes', () => {
        const humanParts: string[] = [];
        for (const locale of ['en-US', 'de']) {
            Object.defineProperty(vscode.env, 'language', { value: locale, configurable: true });
            const text = createExtensionReportText();
            const human = new Intl.DateTimeFormat(locale, options).format(date);
            const formatted = text.formatTimestamp(date);
            expect(formatted).toBe(`${human} (2026-11-02T15:12:08.123Z)`);
            expect(text.formatTimestamp(date.getTime())).toBe(formatted);
            humanParts.push(human);
        }
        expect(humanParts[0]).not.toBe(humanParts[1]);
    });

    it('falls back to the default locale when the VS Code language tag is invalid', () => {
        Object.defineProperty(vscode.env, 'language', { value: 'not_a_locale', configurable: true });
        const human = new Intl.DateTimeFormat(undefined, options).format(date);
        expect(createExtensionReportText().formatTimestamp(date)).toBe(`${human} (2026-11-02T15:12:08.123Z)`);
    });
});
