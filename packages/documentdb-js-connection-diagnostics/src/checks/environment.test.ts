/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';

import { buildReport, createEnvironmentCheck, renderJson, runDiagnostics } from '../index.js';

import { type BuiltInFindingCode, type EnvironmentSource, type DiagnosticsRun } from '../index.js';

const source: EnvironmentSource = {
    versions: { node: '22.18.0', ares: '1.34.6', openssl: '3.0.16' },
    platform: 'test-platform',
    release: 'test-release',
    arch: 'test-arch',
    env: {},
    timeZone: 'Etc/UTC',
};

async function runEnvironment(
    overrides: Partial<EnvironmentSource> = {},
): Promise<DiagnosticsRun<BuiltInFindingCode>> {
    return runDiagnostics({
        input: { connectionString: 'mongodb://example.test' },
        checks: [createEnvironmentCheck()],
        io: {
            environment: { ...source, ...overrides },
            clock: {
                now: (): number => Date.parse('2026-10-29T12:00:00.000Z'),
                setTimeout: (callback, ms): unknown => globalThis.setTimeout(callback, ms),
                clearTimeout: (handle): void =>
                    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
            },
        },
    });
}

describe('environment check', (): void => {
    it('collects only the selected injected facts and the injected local clock', async (): Promise<void> => {
        const run = await runEnvironment();
        expect(run.results[0]).toMatchObject({
            checkId: 'environment',
            status: 'pass',
            findings: [],
            facts: {
                nodeVersion: '22.18.0',
                aresVersion: '1.34.6',
                opensslVersion: '3.0.16',
                platform: 'test-platform',
                release: 'test-release',
                arch: 'test-arch',
                timeZone: 'Etc/UTC',
                localTime: '2026-10-29T12:00:00.000Z',
                proxy: { variables: [] },
            },
        });
    });

    it('represents unavailable versions and time zone without inventing values', async (): Promise<void> => {
        const run = await runEnvironment({ versions: {}, timeZone: undefined });
        expect(run.results[0].facts).toMatchObject({
            nodeVersion: null,
            aresVersion: null,
            opensslVersion: null,
            timeZone: null,
        });
    });

    it.each(['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'])(
        'safely parses %s with credentials and never includes either credential',
        async (variable): Promise<void> => {
            const value = 'http://private-user:private-password@proxy.example:8080';
            const run = await runEnvironment({ env: { [variable]: value } });
            expect(run.results[0].facts.proxy).toEqual({
                variables: [
                    {
                        variable,
                        scheme: 'http',
                        host: 'proxy.example',
                        port: 8080,
                        authenticationPresent: true,
                    },
                ],
            });
            expect(run.results[0].findings).toContainEqual(
                expect.objectContaining({
                    code: 'env.proxyConfigured',
                    severity: 'info',
                    data: { variables: [variable] },
                }),
            );
            const json = JSON.stringify(run);
            expect(json).not.toContain('private-user');
            expect(json).not.toContain('private-password');
            expect(json).not.toContain(value);
            expect(run.results[0].status).toBe('pass');
        },
    );

    it('does not expose percent-encoded proxy credentials', async (): Promise<void> => {
        const run = await runEnvironment({
            env: { HTTPS_PROXY: 'https://private%40user:private%2Fpassword@proxy.example:444' },
        });
        const json = JSON.stringify(run);
        for (const secret of ['private%40user', 'private@user', 'private%2Fpassword', 'private/password']) {
            expect(json).not.toContain(secret);
        }
        expect(run.results[0].facts.proxy).toEqual({
            variables: [
                {
                    variable: 'HTTPS_PROXY',
                    scheme: 'https',
                    host: 'proxy.example',
                    port: 444,
                    authenticationPresent: true,
                },
            ],
        });
    });

    it.each([
        ['proxy.corp.example:8080', 'proxy.corp.example', 8080, false],
        ['alice:pw@proxy:3128', 'proxy', 3128, true],
    ] as const)(
        'parses a scheme-less proxy without exposing credentials (%s)',
        async (value, host, port, authenticationPresent): Promise<void> => {
            const run = await runEnvironment({ env: { HTTPS_PROXY: value } });
            expect(run.results[0].facts.proxy).toEqual({
                variables: [
                    {
                        variable: 'HTTPS_PROXY',
                        scheme: 'http',
                        host,
                        port,
                        authenticationPresent,
                    },
                ],
            });
            expect(JSON.stringify(run)).not.toContain('alice');
            expect(JSON.stringify(run)).not.toContain('pw');
        },
    );

    it.each(['http', 'https', 'socks', 'socks4', 'socks4a', 'socks5', 'socks5h'])(
        'accepts the supported %s proxy scheme',
        async (scheme): Promise<void> => {
            const run = await runEnvironment({ env: { HTTPS_PROXY: `${scheme}://proxy.example:3128` } });
            expect(run.results[0].facts.proxy).toEqual({
                variables: [
                    {
                        variable: 'HTTPS_PROXY',
                        scheme,
                        host: 'proxy.example',
                        port: 3128,
                        authenticationPresent: false,
                    },
                ],
            });
        },
    );

    it('classifies the nested proxy host for identifier redaction', async (): Promise<void> => {
        const run = await runEnvironment({ env: { HTTPS_PROXY: 'http://proxy.corp.example:8080' } });
        const report = buildReport(run);
        const json = renderJson(report, { redact: true });
        expect(json).not.toContain('proxy.corp.example');
        expect(json).toContain('"host": "proxy-1"');
        expect(renderJson(report, { redact: false })).toContain('proxy.corp.example');
    });

    it('records all configured proxy variables in a stable order', async (): Promise<void> => {
        const names = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];
        const run = await runEnvironment({
            env: Object.fromEntries(names.map((name): [string, string] => [name, 'http://proxy.example:8080'])),
        });
        expect(run.results[0].findings[0].data).toEqual({ variables: names });
    });

    it.each([
        'http://[invalid-private-password',
        '',
        'ftp://proxy.example:3128',
        'file:///private-proxy',
        'alice://proxy:3128',
        'socks://',
    ])('reports an unparseable proxy without copying its input (%j)', async (value): Promise<void> => {
        const run = await runEnvironment({ env: { HTTPS_PROXY: value } });
        expect(run.results[0].facts.proxy).toEqual({ variables: [{ variable: 'HTTPS_PROXY', parseFailed: true }] });
        expect(run.results[0].status).toBe('pass');
        if (value) {
            expect(JSON.stringify(run)).not.toContain(value);
        }
    });

    it('records a proxy with no authentication or explicit port without inventing a port', async (): Promise<void> => {
        const run = await runEnvironment({ env: { HTTP_PROXY: 'http://proxy.example' } });
        expect(run.results[0].facts.proxy).toEqual({
            variables: [
                {
                    variable: 'HTTP_PROXY',
                    scheme: 'http',
                    host: 'proxy.example',
                    port: null,
                    authenticationPresent: false,
                },
            ],
        });
    });

    it.each(['NO_PROXY', 'no_proxy'])(
        'trims %s, drops empty entries and caps it at 32',
        async (variable): Promise<void> => {
            const entries = Array.from({ length: 36 }, (_, index): string => `host${index}.example`);
            const run = await runEnvironment({ env: { [variable]: ` , ${entries.join(' , ')} ,, ` } });
            expect(run.results[0].facts.proxy).toEqual({
                variables: [],
                noProxy: { entries: entries.slice(0, 32), omittedCount: 4 },
            });
            expect(run.results[0].findings).toEqual([]);
            expect(run.results[0].status).toBe('pass');
        },
    );

    it('uses the uppercase bypass setting when both spellings are present', async (): Promise<void> => {
        const run = await runEnvironment({ env: { NO_PROXY: 'upper.example', no_proxy: 'lower.example' } });
        expect(run.results[0].facts.proxy).toEqual({
            variables: [],
            noProxy: { entries: ['upper.example'], omittedCount: 0 },
        });
    });

    it.each([
        ['1.34.6', false],
        ['1.34.7', true],
        ['1.35.0', true],
        ['2.0.0', true],
        ['1.34.10', true],
        ['garbage', false],
        ['1.34', false],
        ['1.34.7-preview', false],
    ] as const)('classifies c-ares %s without failing the check', async (ares, affected): Promise<void> => {
        const run = await runEnvironment({ versions: { ...source.versions, ares } });
        const result = run.results[0];
        expect(result.findings.some((entry): boolean => entry.code === 'env.caresRejectsCompressedSrv')).toBe(affected);
        if (affected) {
            expect(result.findings).toContainEqual(
                expect.objectContaining({
                    code: 'env.caresRejectsCompressedSrv',
                    severity: 'info',
                    data: { aresVersion: ares },
                }),
            );
        }
        expect(result.status).toBe('pass');
        expect(
            result.findings.every((entry): boolean => entry.severity === 'info' && entry.detail.language === 'en'),
        ).toBe(true);
    });
});
