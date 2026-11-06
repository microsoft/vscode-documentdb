/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';

import { buildReport, DEFAULT_TIMEOUTS, englishReportText, renderJson, renderMarkdown } from '../index.js';

import {
    type CheckResult,
    type DiagnosticsReport,
    type Finding,
    type FindingText,
    type ReportSectionId,
    type ReportText,
} from '../index.js';

function finding(code = 'consumer.observed', detail = 'English detail'): Finding<string> {
    return { code, severity: 'info', detail: { language: 'en', text: detail } };
}

function result(checkId: string, overrides: Partial<CheckResult<string>> = {}): CheckResult<string> {
    return { checkId, status: 'pass', durationMs: 12, facts: {}, findings: [], ...overrides };
}

function fixture(
    results: readonly CheckResult<string>[] = [],
    overrides: Partial<DiagnosticsReport<string>> = {},
): DiagnosticsReport<string> {
    return {
        ...buildReport({
            runId: 'markdown-run',
            startedAt: 0,
            finishedAt: 100,
            durationMs: 100,
            timeoutProfile: 'default',
            timeouts: DEFAULT_TIMEOUTS,
            targets: [],
            results,
            coverage: {
                limited: false,
                timedOut: [],
                notStartedCount: 0,
                omittedTargetCount: 0,
                retryWouldHelp: false,
            },
        }),
        ...overrides,
    };
}

describe('JSON generator attribution', () => {
    it.each([false, true])('appends trusted attribution after redaction (redact=%s)', (redact): void => {
        const report = fixture([], { connectionName: 'DocumentDB' });
        const generatedBy = {
            description: 'DocumentDB extension for Visual Studio Code',
            marketplaceUrl: 'https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-documentdb',
            extensionVersion: '1.2.3',
        };
        const json = renderJson(report, { redact, generatedBy });
        expect(JSON.parse(json)).toMatchObject({
            connectionName: redact ? 'connection-1' : 'DocumentDB',
            redacted: redact,
            generatedBy,
        });
        expect(json).not.toContain('"identifierKeys"');
        expect(json.indexOf('"generatedBy"')).toBeGreaterThan(json.indexOf('"redacted"'));
        expect(report).not.toHaveProperty('generatedBy');
        expect(renderJson(report, { redact })).not.toContain('"generatedBy"');
    });
});

const customSections: Readonly<Record<string, ReportSectionId>> = {
    prepare: 'preparation',
    authenticate: 'authentication',
    access: 'serverAndAccess',
};

const options = {
    text: englishReportText,
    redact: false,
    sectionOf: (checkId: string): ReportSectionId | undefined => customSections[checkId],
};

function fullFixture(): DiagnosticsReport<string> {
    return fixture(
        [
            result('extra', { findings: [finding('consumer.extra')] }),
            result('access'),
            result('authenticate'),
            result('hello'),
            result('tls'),
            result('tcp'),
            result('dns'),
            result('srv'),
            result('prepare'),
            result('connectionString'),
            result('environment', {
                findings: [finding()],
                facts: { versions: { node: '22.18.0' } },
                steps: [
                    {
                        stepId: 'environment.phase',
                        status: 'pass',
                        durationMs: 3,
                        facts: { observed: true },
                        findings: [finding('consumer.phase')],
                    },
                ],
            }),
        ],
        {
            summary: {
                outcome: 'connected',
                headline: { checkId: 'environment', code: 'consumer.observed' },
                serverRows: [{ label: 'Server', value: 'DocumentDB 0.107' }],
                location: 'This computer',
                notes: ['Observed without reconnecting'],
                nextSteps: ['Share this report'],
            },
            coverage: {
                limited: true,
                timedOut: [{ checkId: 'tcp', target: 'host.test:27017', timeoutMs: 10000, source: 'check' }],
                notStartedCount: 2,
                omittedTargetCount: 3,
                retryWouldHelp: true,
            },
            clockOffset: { target: 'host.test:27017', offsetMs: 300001, uncertaintyMs: 5 },
        },
    );
}

describe('renderMarkdown', (): void => {
    it('renders all sections in fixed order with consumer-supplied headings and finding text', (): void => {
        const text: ReportText<string> = {
            ...englishReportText,
            title: 'Consumer report',
            sectionTitle: (section): string => `Section ${section}`,
            describeFinding: (value): FindingText => ({
                title: `Title ${value.code}`,
                explanation: 'Consumer explanation',
                nextStep: 'Consumer action',
            }),
        };
        const markdown = renderMarkdown(fullFixture(), { ...options, text });
        expect(markdown.split('\n').filter((line): boolean => /^#{1,2} /.test(line))).toEqual([
            '# Consumer report',
            ...[
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
            ].map((section): string => `## Section ${section}`),
        ]);
        expect(markdown).toContain('**Connected** · Environment · Title consumer\\.observed');
        expect(markdown).toContain('Location: This computer');
        expect(markdown).toContain('Run ID: markdown\\-run');
        expect(markdown).toContain('Started at: 1970\\-01\\-01T00:00:00\\.000Z');
        expect(markdown).toContain('Finished at: 1970\\-01\\-01T00:00:00\\.100Z');
        expect(markdown).toContain('| Server | DocumentDB 0\\.107 |');
        expect(markdown).toContain('Observed without reconnecting');
        expect(markdown).toContain('- Share this report');
        expect(markdown).toContain('- Retry with longer timeouts');
        expect(markdown).toContain('| Each network probe | 10000 ms |');
        expect(markdown).toContain('| TCP (`tcp`) | host\\.test:27017 | 10000 ms | Check |');
        expect(markdown).toContain('Not started: 2');
        expect(markdown).toContain('Omitted targets: 3 more omitted');
        expect(markdown).toContain('Clock offset: 300001 ms · Uncertainty: 5 ms');
        expect(markdown).toContain('Consumer explanation | Consumer action |');
        const names = markdown.split('\n').filter((line): boolean => line.startsWith('### '));
        expect(names.filter((line): boolean => line.includes('(`tls`)') || line.includes('(`tcp`)'))).toEqual([
            '### TLS (`tls`)',
            '### TCP (`tcp`)',
        ]);
        const findings = markdown.split('## Section findings')[1]?.split('## Section timings')[0];
        expect(findings?.indexOf('consumer\\.extra')).toBeLessThan(findings?.indexOf('consumer\\.observed') ?? 0);
        expect(findings?.indexOf('consumer\\.observed')).toBeLessThan(findings?.indexOf('consumer\\.phase') ?? 0);
        expect(markdown.endsWith('\n')).toBe(true);
        expect(markdown.endsWith('\n\n')).toBe(false);
    });

    it('uses deterministic UTC ISO timestamps by default, including nested and step facts', (): void => {
        const source = '2026-11-02T16:12:08.123+01:00';
        const iso = '2026-11-02T15:12:08.123Z';
        const markdown = renderMarkdown(
            fixture([
                result('tls', {
                    facts: { certificate: { validFrom: source, validTo: source } },
                    steps: [
                        {
                            stepId: 'inspect',
                            status: 'pass',
                            durationMs: 1,
                            facts: { checkedAt: source },
                            findings: [],
                        },
                    ],
                }),
                result('environment', { facts: { localTime: source, checkedAt: [source, Date.parse(source)] } }),
                result('hello', { facts: { serverTime: source } }),
            ]),
            options,
        ).replace(/\\/g, '');
        for (const field of ['certificate.validFrom', 'certificate.validTo', 'checkedAt', 'localTime', 'serverTime']) {
            expect(markdown).toContain(`| ${field} | ${iso} |`);
        }
        expect(markdown).toContain(`| checkedAt | ${iso}, ${iso} |`);
        expect(englishReportText.formatTimestamp(0)).toBe('1970-01-01T00:00:00.000Z');
        expect(englishReportText.formatTimestamp(new Date(iso))).toBe(iso);
    });

    it.each([false, true])('formats every absolute timestamp with injected text (redact=%s)', (redact): void => {
        const iso = '2026-11-02T15:12:08.123Z';
        const timestamp = Date.parse(iso);
        const report = fixture(
            [
                result('environment', { facts: { localTime: iso, userName: '2026' } }),
                result('tls', { facts: { certificate: { validFrom: iso, validTo: iso } } }),
                result('hello', { facts: { serverTime: iso, clockOffsetMs: 5, clockUncertaintyMs: 2 } }),
                result('authenticate', {
                    facts: { earlierInSession: { ageSeconds: 120 } },
                    steps: [
                        {
                            stepId: 'token',
                            status: 'pass',
                            durationMs: 7,
                            facts: {
                                checkedAt: timestamp,
                                observations: [{ checkedAt: iso }],
                                startedAt: timestamp,
                                finishedAt: timestamp,
                            },
                            findings: [],
                        },
                    ],
                }),
            ],
            { startedAt: iso, finishedAt: iso },
        );
        const formatTimestamp = vi.fn((value: number | Date): string => {
            const date = value instanceof Date ? value : new Date(value);
            return `Localized [time] | <zone> (${date.toISOString()})`;
        });
        const markdown = renderMarkdown(report, {
            ...options,
            redact,
            text: { ...englishReportText, formatTimestamp },
        });
        const escaped = String.raw`Localized \[time\] \| \<zone\> \(2026\-11\-02T15:12:08\.123Z\)`;
        expect(markdown).toContain(`Started at: ${escaped}`);
        expect(markdown).toContain(`Finished at: ${escaped}`);
        for (const field of [
            String.raw`certificate\.validFrom`,
            String.raw`certificate\.validTo`,
            'localTime',
            'serverTime',
            'checkedAt',
            String.raw`observations\[0\]\.checkedAt`,
            'startedAt',
            'finishedAt',
        ]) {
            expect(markdown).toContain(`| ${field} | ${escaped} |`);
        }
        expect(formatTimestamp).toHaveBeenCalledTimes(10);
        expect(markdown).toContain(String.raw`| earlierInSession\.ageSeconds | 120 |`);
        expect(markdown).toContain('Duration: 7 ms');
        expect(markdown).toContain('| clockOffsetMs | 5 |');
        expect(markdown).toContain('| clockUncertaintyMs | 2 |');
        expect(markdown).toContain(`| userName | ${redact ? String.raw`user\-1` : '2026'} |`);
        expect(report.results[0]?.facts.localTime).toBe(iso);
        const json = renderJson(report, { redact });
        expect(json).not.toContain('Localized');
        const snapshot = JSON.parse(json) as DiagnosticsReport<string>;
        expect(snapshot.startedAt).toBe(iso);
        expect(snapshot.finishedAt).toBe(iso);
        expect(snapshot.results[0]?.facts.localTime).toBe(iso);
        expect(snapshot.results[1]?.facts.certificate).toEqual({ validFrom: iso, validTo: iso });
        expect(snapshot.results[2]?.facts.serverTime).toBe(iso);
        expect(snapshot.results[3]?.steps?.[0]?.facts.checkedAt).toBe(timestamp);
    });

    it('does not interpret other strings as timestamps, or format missing or invalid dates', (): void => {
        const formatTimestamp = vi.fn(englishReportText.formatTimestamp);
        const markdown = renderMarkdown(
            fixture([
                result('tls', {
                    facts: {
                        userName: '2026-11-02T15:12:08.123Z',
                        certificate: { validFrom: null, validTo: 'unknown' },
                        localTime: false,
                        checkedAt: Number.MAX_VALUE,
                        serverTime: '',
                    },
                }),
            ]),
            { ...options, text: { ...englishReportText, formatTimestamp } },
        );
        expect(formatTimestamp).toHaveBeenCalledTimes(2);
        expect(markdown).toContain(String.raw`| userName | 2026\-11\-02T15:12:08\.123Z |`);
        expect(markdown).toContain(String.raw`| certificate\.validFrom | null |`);
        expect(markdown).toContain(String.raw`| certificate\.validTo | unknown |`);
        expect(markdown).toContain('| localTime | false |');
        expect(markdown).toContain('| serverTime |  |');
    });

    it('omits empty sections without inventing an outcome or next step', (): void => {
        const markdown = renderMarkdown(fixture(), options);
        expect(markdown.split('\n').filter((line): boolean => line.startsWith('## '))).toEqual([
            '## Summary',
            '## Coverage and limits',
            '## Trace',
        ]);
        expect(markdown).not.toContain('**');
        expect(markdown).not.toContain('### ');
    });

    it('omits empty optional consumer prose and still ends with exactly one newline', (): void => {
        const markdown = renderMarkdown(fixture(), {
            text: { ...englishReportText, retryAdvice: (): string => '', traceNote: (): string => '' },
            redact: false,
        });
        expect(markdown).not.toContain('## Next steps');
        expect(markdown).not.toContain('## Trace');
        expect(markdown.endsWith('\n')).toBe(true);
        expect(markdown.endsWith('\n\n')).toBe(false);
    });

    it('finds the headline code across host results when the summary does not name a target', (): void => {
        const markdown = renderMarkdown(
            fixture(
                [
                    result('tls', { target: 'first.test:27017' }),
                    result('tls', { target: 'second.test:27017', findings: [finding('tls.observed')] }),
                ],
                { summary: { outcome: 'failed', headline: { checkId: 'tls', code: 'tls.observed' } } },
            ),
            {
                text: { ...englishReportText, describeFinding: (): FindingText => ({ title: 'Headline finding' }) },
                redact: false,
            },
        );
        expect(markdown).toContain('**Failed** · TLS · Headline finding');
        expect(markdown.replace(/\\/g, '')).toContain('### TLS (`tls`) (first.test:27017)');
    });

    it('uses consumer section overrides before built-in mappings and defaults unknown checks', (): void => {
        const markdown = renderMarkdown(fixture([result('tcp'), result('__proto__')]), {
            ...options,
            sectionOf: (id): ReportSectionId | undefined => (id === 'tcp' ? 'preparation' : undefined),
        });
        expect(markdown).toContain('## Preparation\n\n### TCP (`tcp`)');
        expect(markdown).not.toContain('## Transport');
        expect(markdown).toContain('## Additional checks');
    });

    it.each<ReportSectionId>(['summary', 'nextSteps', 'coverage', 'findings', 'timings', 'trace'])(
        'honors section overrides for %s without dropping a result',
        (sectionId): void => {
            const markdown = renderMarkdown(fixture([result('custom')]), {
                ...options,
                sectionOf: (): ReportSectionId => sectionId,
            });
            const sectionContent = markdown
                .split(`## ${englishReportText.sectionTitle(sectionId)}\n`)[1]
                ?.split('\n## ')[0];
            expect(sectionContent).toContain('### custom (`custom`)');
            expect(markdown).not.toContain('## Additional checks');
        },
    );

    it('shows skip reasons and originating checks and steps, including their timings', (): void => {
        const markdown = renderMarkdown(
            fixture([
                result('tls', {
                    status: 'skipped',
                    durationMs: 0,
                    skippedBecause: { reason: 'dependencyFailed', checkId: 'tcp' },
                    steps: [
                        {
                            stepId: 'tls.inspect',
                            status: 'skipped',
                            durationMs: 0,
                            facts: {},
                            findings: [],
                            skippedBecause: { reason: 'dependencySkipped', stepId: 'tls.verify' },
                        },
                    ],
                }),
            ]),
            options,
        );
        expect(markdown).toContain('Status: Skipped · Duration: 0 ms · Reason: Dependency failed (TCP (`tcp`))');
        expect(markdown).toContain('#### tls\\.inspect (`tls\\.inspect`)');
        expect(markdown).toContain('Reason: Dependency skipped (tls\\.verify (`tls\\.verify`))');
        expect(markdown).toContain('| TLS (`tls`) / tls\\.inspect (`tls\\.inspect`) | \\(none\\) | Skipped | 0 ms |');
    });

    it('renders step sub-headings, findings codes and flattened facts', (): void => {
        const markdown = renderMarkdown(
            fixture([
                result('consumer', {
                    facts: {
                        attempts: [{ address: '127.0.0.1', outcomes: ['connected', 'observed'] }],
                        emptyList: [],
                        emptyObject: {},
                        nested: { ok: true },
                        missing: null,
                    },
                    steps: [
                        {
                            stepId: 'phase',
                            status: 'warning',
                            durationMs: 4,
                            facts: { phaseFact: 'value' },
                            findings: [finding()],
                        },
                    ],
                }),
            ]),
            options,
        );
        expect(markdown).toContain('| attempts\\[0\\]\\.address | 127\\.0\\.0\\.1 |');
        expect(markdown).toContain('| attempts\\[0\\]\\.outcomes | connected, observed |');
        expect(markdown).toContain('| emptyList | \\(none\\) |');
        expect(markdown).toContain('| emptyObject | \\(none\\) |');
        expect(markdown).toContain('| nested\\.ok | true |');
        expect(markdown).toContain('| missing | null |');
        expect(markdown).toContain(
            '#### phase (`phase`)\n\nStatus: Warning · Duration: 4 ms\n\nCode: `consumer\\.observed`',
        );
        expect(markdown).toContain('| phaseFact | value |');
        expect(markdown).toContain('## Findings');
    });

    it('renders null diagnostic timeouts as consumer text and explains connection-limited retries', (): void => {
        const report = fixture([], {
            timeouts: { ...DEFAULT_TIMEOUTS, runTimeoutMs: null },
            timeoutProfile: 'noDiagnosticTimeouts',
            coverage: {
                limited: true,
                timedOut: [{ checkId: 'tcp', timeoutMs: 20, source: 'connection' }],
                notStartedCount: 0,
                omittedTargetCount: 0,
                retryWouldHelp: false,
            },
        });
        const markdown = renderMarkdown(report, options);
        expect(markdown).toContain('Timeout profile: No diagnostic timeouts');
        expect(markdown).toContain('| Whole run | None |');
        expect(markdown).toContain('change that connection setting before a longer retry can help');
        expect(markdown).toContain('| TCP (`tcp`) | \\(none\\) | 20 ms | Connection |');
    });

    it('redacts identifiers before the consumer describes findings, and keeps originals otherwise', (): void => {
        const host = 'node.cluster.test';
        const identifiers = [
            host,
            '10.11.12.13',
            'alice',
            'sales',
            'private-replica',
            'Private Organization',
            'Private connection',
        ];
        const report = fixture(
            [
                result('tls', {
                    target: `${host}:27017`,
                    facts: {
                        host,
                        address: '10.11.12.13',
                        userName: 'alice',
                        database: 'sales',
                        setName: 'private-replica',
                        certificate: {
                            subject: { CN: host, O: 'Private Organization' },
                            subjectAltNames: [`DNS:${host}`],
                            issuerChain: [{ CN: 'Public Root CA' }],
                        },
                    },
                    findings: [{ ...finding('consumer.identity', `Observed ${host} for alice`), data: { host } }],
                }),
            ],
            {
                connectionName: 'Private connection',
                targets: [`${host}:27017`],
                summary: {
                    outcome: 'failed',
                    headline: { checkId: 'tls', target: `${host}:27017`, code: 'consumer.identity' },
                    location: host,
                    notes: ['Private connection'],
                    nextSteps: [`Connect to ${host}`],
                    serverRows: [{ label: 'Server', value: host }],
                },
                clockOffset: { target: `${host}:27017`, offsetMs: 3, uncertaintyMs: 1 },
                coverage: {
                    limited: true,
                    timedOut: [{ checkId: 'tls', target: `${host}:27017`, timeoutMs: 10, source: 'run' }],
                    omittedTargetCount: 0,
                    notStartedCount: 0,
                    retryWouldHelp: true,
                },
            },
        );
        const describeFinding = vi.fn(
            (value: Finding<string>, owner: CheckResult<string>): FindingText => ({
                title: String(value.data?.host),
                explanation: owner.target,
                nextStep: value.detail.text,
            }),
        );
        const text: ReportText<string> = { ...englishReportText, describeFinding };
        const redacted = renderMarkdown(report, { text, redact: true });
        for (const identifier of identifiers) {
            expect(redacted.replace(/\\/g, '')).not.toContain(identifier);
        }
        expect(describeFinding).toHaveBeenCalled();
        expect(describeFinding.mock.calls[0]?.[0].data?.host).toMatch(/^host-\d+$/);
        expect(redacted).toContain('host\\-1:27017');
        expect(redacted).toContain('Public Root CA');
        const complete = renderMarkdown(report, { text, redact: false }).replace(/\\/g, '');
        for (const identifier of identifiers) {
            expect(complete).toContain(identifier);
        }
        expect(report.results[0]?.target).toBe(`${host}:27017`);
    });

    it('escapes report and consumer text so they cannot inject Markdown or change table columns', (): void => {
        const injection = '# Heading\r\n[link](http://x) ![img](x) <script> |\n``` & \\ *_{}+-.!~';
        const report = fixture(
            [
                result('tls', {
                    target: injection,
                    facts: { certificate: { subject: { CN: injection } }, value: injection, [injection]: injection },
                    findings: [finding('consumer.`code`', injection)],
                    steps: [
                        { stepId: injection, status: 'pass', durationMs: 1, facts: { field: injection }, findings: [] },
                    ],
                }),
            ],
            {
                runId: injection,
                summary: {
                    outcome: 'failed',
                    headline: { checkId: 'tls', target: injection, code: 'consumer.`code`' },
                    serverRows: [{ label: injection, value: injection }],
                    notes: [injection],
                    nextSteps: [injection],
                    location: injection,
                },
            },
        );
        const text: ReportText<string> = {
            ...englishReportText,
            title: injection,
            describeFinding: (): FindingText => ({ title: injection, explanation: injection, nextStep: injection }),
        };
        const markdown = renderMarkdown(report, { text, redact: false });
        expect(markdown).not.toMatch(/(?<!\\)\]\(/);
        expect(markdown).not.toContain('<script>');
        expect(markdown).not.toContain('```');
        expect(markdown).toContain('\\<script\\>');
        expect(markdown).toContain('&amp;');
        expect(markdown).not.toContain('\r');
        expect(markdown.split('\n').filter((line): boolean => line.startsWith('#')).length).toBe(10);
        expect(markdown.split('\n').some((line): boolean => line === '# Heading')).toBe(false);
        for (const block of markdown.split('\n\n')) {
            if (!block.startsWith('| ')) {
                continue;
            }
            const counts = block.split('\n').map((line): number => (line.match(/(?<!\\)\|/g) ?? []).length);
            expect(new Set(counts).size).toBe(1);
        }
        expect(markdown).toContain('`consumer\\.code`');
    });

    it('never accesses detail.text itself and uses the consumer callback for the headline and findings', (): void => {
        const secretSentinel = 'DETAIL_TEXT_MUST_NOT_BE_READ';
        const getText = vi.fn((): string => secretSentinel);
        const value: Finding<string> = {
            code: 'consumer.custom',
            severity: 'warning',
            detail: {
                language: 'en',
                get text(): string {
                    return getText();
                },
            },
        };
        const owner = result('custom', { findings: [value] });
        const report = fixture([], {
            results: [owner],
            summary: { outcome: 'failed', headline: { checkId: 'custom', code: value.code } },
        });
        const describeFinding = vi.fn(
            (): FindingText => ({ title: 'Translated title', explanation: 'Translated explanation' }),
        );
        const rendered = renderMarkdown(report, { text: { ...englishReportText, describeFinding }, redact: false });
        expect(getText).not.toHaveBeenCalled();
        expect(rendered).not.toContain(secretSentinel);
        expect(describeFinding).toHaveBeenCalledTimes(2);
        expect(describeFinding).toHaveBeenCalledWith(value, owner);
        expect(rendered).toContain('**Failed** · custom · Translated title');
    });

    it('returns identical output for repeated calls without mutating the snapshot', (): void => {
        const report = fullFixture();
        const before = JSON.stringify(report);
        for (const redact of [false, true]) {
            expect(renderMarkdown(report, { ...options, redact })).toBe(renderMarkdown(report, { ...options, redact }));
        }
        expect(JSON.stringify(report)).toBe(before);
    });
});
