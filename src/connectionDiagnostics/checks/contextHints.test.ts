/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    buildReport,
    DEFAULT_TIMEOUTS,
    renderJson,
    renderMarkdown,
    type CheckResult,
    type RunContext,
} from '@documentdb-js/connection-diagnostics';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorExplanationService } from '../../services/errorExplanationService';
import { type RunOwnedClient } from '../auth/runOwnedClient';
import { diagnosticsIdentifierKeys } from '../identifierKeys';
import { type DiagnosticsSetup } from '../input';
import { createExtensionReportText } from '../reportText';
import { type DiagnosticsTarget } from '../types';
import { createContextHintsCheck } from './contextHints';

const password = 'P@ss-word:1';
const uri = `mongodb://user:${encodeURIComponent(password)}@private.example:27017/`;
const setup: DiagnosticsSetup = {
    input: { connectionString: uri },
    chosenAuthMethod: undefined,
    credentialState: 'available',
    connectionProperties: undefined,
    transientCredentials: {
        clusterId: 'stable-id',
        connectionString: uri,
        connectionStringWithPassword: uri,
        nativeAuthConfig: { connectionUser: 'user', connectionPassword: password },
    },
};
const target: DiagnosticsTarget = {
    clusterId: 'stable-id',
    displayName: 'Fixture',
    sourceView: 'connections',
    getCredentials: async (): Promise<undefined> => undefined,
};
const earlierChecks = [
    { id: 'tcp', scope: 'host' },
    { id: 'authenticate', scope: 'run' },
] as const;

function result(checkId: string, status: 'fail' | 'warning' | 'pass' | 'skipped' = 'fail'): CheckResult<string> {
    return {
        checkId,
        status,
        durationMs: 1,
        facts: { host: 'private.example' },
        findings: [
            {
                code: checkId === 'tcp' ? 'tcp.refused' : 'auth.failed',
                severity: 'error',
                detail: { language: 'en', text: 'SECRET private.example' },
            },
        ],
    };
}

function context(results: readonly CheckResult<string>[] = []): RunContext {
    return {
        input: setup.input,
        targets: [{ host: 'private.example', port: 27017, source: 'uri' }],
        getResult: (id: string): CheckResult<string> | undefined =>
            results.find((entry): boolean => entry.checkId === id),
    } as unknown as RunContext;
}

afterEach((): void => {
    vi.restoreAllMocks();
});

describe('contextHints', (): void => {
    it.each(['pass', 'warning', 'skipped'] as const)(
        'is not applicable without a failure, including %s outcomes',
        async (status): Promise<void> => {
            const explain = vi.spyOn(ErrorExplanationService, 'explain');
            const check = createContextHintsCheck(
                target,
                (): DiagnosticsSetup => setup,
                (): RunOwnedClient => ({}),
                earlierChecks,
            );
            expect(check.dependsOn).toBeUndefined();
            expect(
                await check.run(
                    context([result('tcp', status), result('authenticate', status)]),
                    new AbortController().signal,
                ),
            ).toEqual({ status: 'skipped', skippedBecause: { reason: 'notApplicable' }, facts: {}, findings: [] });
            expect(explain).not.toHaveBeenCalled();
        },
    );

    describe('public Azure private-link address context', (): void => {
        const hint =
            'This name resolved to a public address. If the cluster allows only private access, connect from its virtual network or a network that resolves the private endpoint (VPN, peering or a private DNS zone).';
        const host = { host: 'private.example', port: 27017, source: 'uri' as const };
        const other = { host: 'other.example', port: 27017, source: 'uri' as const };
        const alias: CheckResult<string> = {
            ...result('dns', 'pass'),
            target: 'private.example:27017',
            findings: [
                {
                    code: 'dns.privateEndpointPublicAddress',
                    severity: 'info',
                    detail: { language: 'en', text: 'Public Azure alias.' },
                },
            ],
        };

        async function run(
            results: CheckResult<string>[],
            multiple = false,
            provider?: string,
        ): Promise<Readonly<Record<string, unknown>>> {
            vi.spyOn(ErrorExplanationService, 'explain').mockResolvedValue(
                provider ? { providerId: 'fixture', message: provider } : undefined,
            );
            const ctx = {
                ...context(),
                targets: multiple ? [host, other] : [host],
                getResult: (id: string, target?: { host: string; port: number }): CheckResult<string> | undefined =>
                    results.find(
                        (entry): boolean =>
                            entry.checkId === id &&
                            (target === undefined || entry.target === `${target.host}:${target.port}`),
                    ),
            } as RunContext;
            const check = createContextHintsCheck(
                target,
                (): DiagnosticsSetup => setup,
                (): RunOwnedClient => ({}),
                [
                    { id: 'dns', scope: 'host' },
                    { id: 'tcp', scope: 'host' },
                    { id: 'tls', scope: 'host' },
                    { id: 'hello', scope: 'host' },
                    { id: 'authenticate', scope: 'run' },
                ],
            );
            return (await check.run(ctx, new AbortController().signal)).facts;
        }

        it('adds no hint when the connection succeeds, even with a failed seed', async (): Promise<void> => {
            expect(
                await run([alias, { ...result('tcp'), target: alias.target }, result('authenticate', 'pass')]),
            ).not.toHaveProperty('privateAccessHint');
            expect(
                await run([alias, { ...result('tcp', 'pass'), target: alias.target }, result('authenticate', 'pass')]),
            ).not.toHaveProperty('privateAccessHint');
        });

        it.each([
            'tcp.refused',
            'tcp.timeout',
            'tcp.unreachable',
            'tcp.reset',
            'tls.handshakeRejectedByServer',
            'hello.noReply',
        ])('adds the conditional hint only for the matching host on %s', async (code): Promise<void> => {
            const failure = {
                ...result(code.split('.')[0] ?? 'tcp'),
                target: alias.target,
                findings: [{ code, severity: 'error' as const, detail: { language: 'en' as const, text: 'Failed.' } }],
            };
            expect(await run([alias, failure])).toMatchObject({ providerId: null, privateAccessHint: hint });
            expect(await run([alias, failure])).not.toHaveProperty('explanation');
            expect(await run([alias, { ...failure, target: 'other.example:27017' }], true)).not.toHaveProperty(
                'privateAccessHint',
            );
            expect(await run([{ ...alias, findings: [] }, failure])).not.toHaveProperty('privateAccessHint');
        });

        it('keeps the sanitized provider explanation separate from the private-access hint', async (): Promise<void> => {
            expect(
                await run([alias, { ...result('tcp'), target: alias.target }], false, `Check access from WSL. ${password}`),
            ).toMatchObject({
                providerId: 'fixture',
                explanation: 'Check access from WSL. [secret omitted]',
                privateAccessHint: hint,
            });
        });

        it('correlates a later server-selection failure with the affected host, including auth steps', async (): Promise<void> => {
            const failure = {
                ...result('authenticate'),
                findings: [
                    {
                        code: 'auth.serverSelectionTimeout',
                        severity: 'error' as const,
                        detail: { language: 'en' as const, text: 'Timed out.' },
                    },
                ],
            };
            expect(await run([alias, failure])).toHaveProperty('privateAccessHint', hint);
            expect(await run([alias, failure], true)).not.toHaveProperty('privateAccessHint');
            for (const [address, expected] of [
                ['private.example:27017', hint],
                ['other.example:27017', undefined],
            ]) {
                const facts = { serverErrors: [{ address, errorName: 'MongoNetworkError', errorCode: 'ETIMEDOUT' }] };
                expect(
                    (
                        await run(
                            [
                                alias,
                                {
                                    ...failure,
                                    steps: [
                                        {
                                            stepId: 'auth.serverAuthentication',
                                            status: 'fail',
                                            durationMs: 1,
                                            facts,
                                            findings: failure.findings,
                                        },
                                    ],
                                    findings: [],
                                },
                            ],
                            true,
                        )
                    ).privateAccessHint,
                ).toBe(expected);
            }
        });

        it("does not borrow another member's network error when this host rejected credentials or a certificate", async (): Promise<void> => {
            for (const errorCode of [18, 'ERR_TLS_CERT_ALTNAME_INVALID']) {
                expect(
                    await run(
                        [
                            alias,
                            {
                                ...result('authenticate'),
                                findings: [
                                    {
                                        code: 'auth.serverSelectionTimeout',
                                        severity: 'error',
                                        detail: { language: 'en', text: 'Timed out.' },
                                    },
                                ],
                                facts: {
                                    serverErrors: [
                                        { address: 'private.example:27017', errorName: 'MongoNetworkError', errorCode },
                                        {
                                            address: 'other.example:27017',
                                            errorName: 'MongoNetworkError',
                                            errorCode: 'ETIMEDOUT',
                                        },
                                    ],
                                },
                            },
                        ],
                        true,
                    ),
                ).not.toHaveProperty('privateAccessHint');
            }
        });

        it.each([{ errorCode: 'EHOSTUNREACH' }, { errorName: 'MongoNetworkError' }])(
            'uses structured network error facts for a later failed step: %j',
            async (facts): Promise<void> => {
                expect(await run([alias, { ...result('authenticate'), findings: [], facts }])).toHaveProperty(
                    'privateAccessHint',
                    hint,
                );
            },
        );

        it('includes a TCP check timeout but not an unrelated authentication timeout', async (): Promise<void> => {
            const finding = {
                code: 'check.timeout',
                severity: 'error' as const,
                detail: { language: 'en' as const, text: 'Timed out.' },
            };
            expect(await run([alias, { ...result('tcp'), target: alias.target, findings: [finding] }])).toHaveProperty(
                'privateAccessHint',
                hint,
            );
            expect(
                await run([alias, { ...result('authenticate'), findings: [{ ...finding, code: 'auth.tokenFailed' }] }]),
            ).not.toHaveProperty('privateAccessHint');
        });

        it.each(['auth.failed', 'tls.expired', 'tls.hostnameMismatch', 'cs.unparseable'])(
            'does not imply private-only access for %s',
            async (code): Promise<void> => {
                const checkId = code.startsWith('auth.') ? 'authenticate' : code.startsWith('tls.') ? 'tls' : 'tcp';
                expect(
                    await run([
                        alias,
                        {
                            ...result(checkId),
                            target: checkId === 'authenticate' ? undefined : alias.target,
                            findings: [{ code, severity: 'error', detail: { language: 'en', text: 'Failed.' } }],
                        },
                    ]),
                ).not.toHaveProperty('privateAccessHint');
            },
        );
    });

    it('passes the original authentication error and diagnostics source with the stable identity', async (): Promise<void> => {
        const authError = new Error('Original secret-bearing driver error');
        const holder: RunOwnedClient = { authError };
        const explain = vi
            .spyOn(ErrorExplanationService, 'explain')
            .mockResolvedValue({ providerId: 'fixture', message: 'Check private.example.' });
        const check = createContextHintsCheck(
            target,
            (): DiagnosticsSetup => setup,
            (): RunOwnedClient => holder,
            earlierChecks,
        );
        expect(await check.run(context([result('authenticate')]), new AbortController().signal)).toEqual({
            status: 'pass',
            findings: [],
            facts: { providerId: 'fixture', explanation: 'Check private.example.' },
        });
        expect(explain).toHaveBeenCalledExactlyOnceWith({
            clusterId: 'stable-id',
            error: authError,
            source: 'connectionDiagnostics',
        });
        expect(holder.authError).toBe(authError);
    });

    it('uses the first failing check code, not its raw detail or hostname, as a fallback error', async (): Promise<void> => {
        const explain = vi.spyOn(ErrorExplanationService, 'explain').mockResolvedValue(undefined);
        const check = createContextHintsCheck(
            target,
            (): DiagnosticsSetup => setup,
            (): RunOwnedClient => ({}),
            earlierChecks,
        );
        expect(await check.run(context([result('authenticate'), result('tcp')]), new AbortController().signal)).toEqual(
            { status: 'pass', findings: [], facts: { providerId: null } },
        );
        const request = explain.mock.calls[0][0];
        expect(request).toMatchObject({ clusterId: 'stable-id', source: 'connectionDiagnostics' });
        expect(request.error).toBeInstanceOf(Error);
        expect((request.error as Error).message).toBe('tcp.refused');
    });

    it('provides a minimal fallback even when the failing check has no finding', async (): Promise<void> => {
        const explain = vi.spyOn(ErrorExplanationService, 'explain').mockResolvedValue(undefined);
        const check = createContextHintsCheck(
            target,
            (): DiagnosticsSetup => setup,
            (): RunOwnedClient => ({}),
            earlierChecks,
        );
        await check.run(context([{ ...result('authenticate'), findings: [] }]), new AbortController().signal);
        expect((explain.mock.calls[0][0].error as Error).message).toBe('check.failed');
    });

    it('excludes raw connection strings, passwords and URI userinfo but keeps hostnames', async (): Promise<void> => {
        const message = `Check private.example and ${uri}. Password ${password}, encoded ${encodeURIComponent(password)}. Proxy https://other:other-secret@proxy.example:8080/path. Alternate mongodb://a:b@another.example/`;
        vi.spyOn(ErrorExplanationService, 'explain').mockResolvedValue({ providerId: 'fixture', message });
        const check = createContextHintsCheck(
            target,
            (): DiagnosticsSetup => setup,
            (): RunOwnedClient => ({}),
            earlierChecks,
        );
        const outcome = await check.run(context([result('tcp')]), new AbortController().signal);
        const serialized = JSON.stringify(outcome);
        for (const secret of [uri, password, encodeURIComponent(password), 'other-secret', 'other:', 'a:b@']) {
            expect(serialized).not.toContain(secret);
        }
        for (const host of ['private.example', 'proxy.example', 'another.example']) expect(serialized).toContain(host);
    });

    it('also sanitizes passwords supplied only by URI userinfo', async (): Promise<void> => {
        const uriSetup = { ...setup, transientCredentials: undefined };
        vi.spyOn(ErrorExplanationService, 'explain').mockResolvedValue({
            providerId: 'fixture',
            message: `${password} ${encodeURIComponent(password)} on private.example`,
        });
        const check = createContextHintsCheck(
            target,
            (): DiagnosticsSetup => uriSetup,
            (): RunOwnedClient => ({}),
            earlierChecks,
        );
        const outcome = await check.run(context([result('tcp')]), new AbortController().signal);
        expect(JSON.stringify(outcome)).not.toContain(password);
        expect(JSON.stringify(outcome)).not.toContain(encodeURIComponent(password));
        expect(JSON.stringify(outcome)).toContain('private.example');
    });

    it('caps explanations at 8 KiB including multibyte characters', async (): Promise<void> => {
        vi.spyOn(ErrorExplanationService, 'explain').mockResolvedValue({
            providerId: 'fixture',
            message: '€'.repeat(9000),
        });
        const check = createContextHintsCheck(
            target,
            (): DiagnosticsSetup => setup,
            (): RunOwnedClient => ({}),
            earlierChecks,
        );
        const outcome = await check.run(context([result('tcp')]), new AbortController().signal);
        expect(typeof outcome.facts.explanation).toBe('string');
        expect(Buffer.byteLength(String(outcome.facts.explanation), 'utf8')).toBeLessThanOrEqual(8192);
        expect(String(outcome.facts.explanation)).not.toContain('�');
    });

    it('R4: Hide identifiers replaces provider-named Kubernetes service and namespace everywhere', async (): Promise<void> => {
        const explanation =
            'The port-forward tunnel to "payments-db-svc" in namespace "acme-prod" looks active, but the service did not answer.';
        vi.spyOn(ErrorExplanationService, 'explain').mockResolvedValue({
            providerId: 'kubernetes-port-forward',
            message: explanation,
            identifiers: [
                { kind: 'service', value: 'payments-db-svc' },
                { kind: 'namespace', value: 'acme-prod' },
            ],
        });
        const check = createContextHintsCheck(
            target,
            (): DiagnosticsSetup => setup,
            (): RunOwnedClient => ({}),
            earlierChecks,
        );
        const outcome = await check.run(context([result('tcp')]), new AbortController().signal);
        expect(outcome.facts).toMatchObject({
            explanation,
            providerIdentifiers: { service: ['payments-db-svc'], namespace: ['acme-prod'] },
        });
        const report = buildReport(
            {
                runId: 'r4',
                startedAt: 0,
                finishedAt: 1,
                durationMs: 1,
                timeoutProfile: 'default',
                timeouts: DEFAULT_TIMEOUTS,
                targets: [{ host: '127.0.0.1', port: 27017, source: 'uri' }],
                results: [{ checkId: 'contextHints', durationMs: 1, ...outcome }],
                coverage: {
                    limited: false,
                    timedOut: [],
                    notStartedCount: 0,
                    omittedTargetCount: 0,
                    retryWouldHelp: false,
                },
            },
            {
                identifierKeys: diagnosticsIdentifierKeys,
                summary: { outcome: 'failed', nextSteps: [explanation] },
            },
        );
        const shared = [
            renderJson(report, { redact: true }),
            renderMarkdown(report, { text: createExtensionReportText(), redact: true }),
        ];
        for (const text of shared) {
            expect(text).not.toContain('payments-db-svc');
            expect(text).not.toContain('acme-prod');
            // Markdown escapes the placeholder hyphen.
            expect(text).toMatch(/service\\?-1/);
            expect(text).toMatch(/namespace\\?-1/);
        }
        expect(renderJson(report, { redact: false })).toContain('payments-db-svc');
    });
});
