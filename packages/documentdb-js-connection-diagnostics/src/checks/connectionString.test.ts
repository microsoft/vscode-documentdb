/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';

import { createBuiltInChecks, createConnectionStringCheck, runDiagnostics } from '../index.js';
import { URI_OPTIONS } from './uriOptions.js';

import {
    type BuiltInFindingCode,
    type CheckOutcome,
    type DiagnosticsEvent,
    type DiagnosticsRun,
    type WireCompressor,
} from '../index.js';

async function runUri(
    connectionString: string,
    availableCompressors?: readonly WireCompressor[],
): Promise<DiagnosticsRun<BuiltInFindingCode>> {
    return runDiagnostics({
        input: { connectionString, ...(availableCompressors === undefined ? {} : { availableCompressors }) },
        checks: [createConnectionStringCheck()],
        io: {
            environment: {
                versions: {},
                platform: 'test',
                release: 'test',
                arch: 'test',
                env: {},
                timeZone: 'Etc/UTC',
            },
        },
    });
}

interface FindingCase {
    readonly code: BuiltInFindingCode;
    readonly positive: string;
    readonly negative: string;
    readonly status: 'fail' | 'warning' | 'pass';
}

const findingCases: readonly FindingCase[] = [
    { code: 'cs.unparseable', positive: 'https://example.test', negative: 'mongodb://example.test', status: 'fail' },
    {
        code: 'cs.srvWithPort',
        positive: 'mongodb+srv://example.test:27017',
        negative: 'mongodb+srv://example.test',
        status: 'fail',
    },
    {
        code: 'cs.srvMultipleHosts',
        positive: 'mongodb+srv://a.example,b.example',
        negative: 'mongodb+srv://example.test',
        status: 'fail',
    },
    {
        code: 'cs.unknownOption',
        positive: 'mongodb://example.test/?mysteryOption=yes',
        negative: 'mongodb://example.test/?retryWrites=true',
        status: 'fail',
    },
    {
        code: 'cs.optionIgnoredByDriver',
        positive: 'mongodb://example.test/?fsync=true',
        negative: 'mongodb://example.test/?journal=true',
        status: 'warning',
    },
    {
        code: 'cs.conflictingTlsOptions',
        positive: 'mongodb://example.test/?ssl=true&tls=false',
        negative: 'mongodb://example.test/?ssl=true&tls=true',
        status: 'fail',
    },
    {
        code: 'cs.tlsVerificationDisabled',
        positive: 'mongodb://example.test/?tlsInsecure=true',
        negative: 'mongodb://example.test/?tlsInsecure=false',
        status: 'warning',
    },
    {
        code: 'cs.directConnectionWithMultipleHosts',
        positive: 'mongodb://a,b/?directConnection=true',
        negative: 'mongodb://a/?directConnection=true',
        status: 'fail',
    },
    {
        code: 'cs.unencodedReservedCharacter',
        positive: 'mongodb://user:pass%zz@example.test',
        negative: 'mongodb://user:pass%25zz@example.test',
        status: 'fail',
    },
    {
        code: 'cs.authSourceUnusual',
        positive: 'mongodb://example.test/?authSource=custom',
        negative: 'mongodb://example.test/?authSource=admin',
        status: 'pass',
    },
    {
        code: 'cs.compressorUnavailable',
        positive: 'mongodb://example.test/?compressors=snappy,zlib',
        negative: 'mongodb://example.test/?compressors=zlib',
        status: 'warning',
    },
];

describe('connection string findings', (): void => {
    it('never publishes ambiguous authority fragments or probes them', async (): Promise<void> => {
        const events: DiagnosticsEvent<BuiltInFindingCode>[] = [];
        const networkOperation = vi.fn(async (): Promise<never> => {
            throw new Error('Unexpected network operation');
        });
        const getServers = vi.fn((): string[] => []);
        const run = await runDiagnostics({
            input: { connectionString: 'mongodb://alice:hunter@2pass@db.contoso.com:27017/db' },
            checks: createBuiltInChecks(),
            onEvent: (event): void => {
                events.push(event);
            },
            io: {
                environment: {
                    versions: {},
                    platform: 'test',
                    release: 'test',
                    arch: 'test',
                    env: {},
                    timeZone: 'Etc/UTC',
                },
                dns: {
                    lookup: networkOperation,
                    resolve4: networkOperation,
                    resolve6: networkOperation,
                    resolveCname: networkOperation,
                    resolveSrv: networkOperation,
                    resolveTxt: networkOperation,
                    resolveSrvFallback: networkOperation,
                    resolveTxtFallback: networkOperation,
                    getServers,
                },
                net: { connect: networkOperation, connectTls: networkOperation },
            },
        });
        const result = run.results.find((entry): boolean => entry.checkId === 'connectionString');
        expect(result).toMatchObject({
            status: 'fail',
            findings: [expect.objectContaining({ code: 'cs.unencodedReservedCharacter' })],
        });
        for (const json of [JSON.stringify(result), JSON.stringify(events), JSON.stringify(run.targets)]) {
            expect(json).not.toContain('hunter');
            expect(json).not.toContain('2pass');
        }
        expect(result?.facts).not.toHaveProperty('hosts');
        expect(result?.facts).not.toHaveProperty('userName');
        expect(result?.facts).not.toHaveProperty('database');
        expect(result?.facts).not.toHaveProperty('options');
        expect(run.targets).toEqual([]);
        expect(events.filter((event): boolean => event.type === 'hostPhaseStarted')).toEqual([
            expect.objectContaining({ targets: [] }),
        ]);
        expect(
            events.some((event): boolean => event.type === 'checkStarted' && ['dns', 'tcp'].includes(event.checkId)),
        ).toBe(false);
        expect(networkOperation).not.toHaveBeenCalled();
        expect(getServers).not.toHaveBeenCalled();
    });

    it.each(findingCases)(
        'reports $code only in its positive case',
        async ({ code, positive, negative, status }): Promise<void> => {
            const result = (await runUri(positive)).results[0];
            expect(result.findings.map((entry): string => entry.code)).toContain(code);
            expect(result.status).toBe(status);
            expect(
                result.findings.every(
                    (entry): boolean => entry.detail.language === 'en' && entry.detail.text.length > 0,
                ),
            ).toBe(true);
            const clean = (await runUri(negative)).results[0];
            expect(clean.findings.map((entry): string => entry.code)).not.toContain(code);
            expect(clean.status).toBe('pass');
        },
    );

    it.each([
        ['mongodb://user@name:pass@example.test', 'username', '@'],
        ['mongodb://user:pa@ss@example.test', 'password', '@'],
        ['mongodb://user:name:pass@example.test', 'username', ':'],
        ['mongodb://user/name:pass@example.test', 'username', '/'],
        ['mongodb://user:pa/ss@example.test', 'password', '/'],
        ['mongodb://user%xx:pass@example.test', 'username', '%'],
        ['mongodb://user:pass%xx@example.test', 'password', '%'],
        ['mongodb://user%2:pass@example.test', 'username', '%'],
        ['mongodb://user:pass%@example.test', 'password', '%'],
    ])('detects an unencoded reserved character in %s', async (uri, part, character): Promise<void> => {
        const result = (await runUri(uri)).results[0];
        expect(result.status).toBe('fail');
        expect(result.findings).toContainEqual(
            expect.objectContaining({
                code: 'cs.unencodedReservedCharacter',
                severity: 'error',
                data: { part, character },
            }),
        );
    });

    it.each([
        'mongodb://user%40name:pa%40ss@example.test',
        'mongodb://user%3Aname:pa%3Ass@example.test',
        'mongodb://user%2Fname:pa%2fss@example.test',
        'mongodb://user%25name:pa%25ss@example.test',
        'mongodb://user%23name:pa%3Fss@example.test',
    ])('accepts percent-encoded reserved characters in %s', async (uri): Promise<void> => {
        const result = (await runUri(uri)).results[0];
        expect(result.status).toBe('pass');
        expect(result.findings).toEqual([]);
    });

    it('reports both SRV host errors even when parsing fails, without a duplicate generic error', async (): Promise<void> => {
        const run = await runUri('mongodb+srv://a:27017,b:27018');
        expect(run.results[0].findings.map((entry): string => entry.code)).toEqual([
            'cs.srvMultipleHosts',
            'cs.srvWithPort',
        ]);
        expect(run.targets).toEqual([]);
    });

    it.each([
        ['not-a-uri-with-private-password', 'invalidScheme'],
        ['mongodb://', 'invalidHost'],
        ['mongodb://a,,b', 'invalidHost'],
        ['mongodb://example.test:not-a-port', 'invalidPort'],
        ['mongodb://example.test:70000', 'invalidPort'],
        ['mongodb://user:password%FF@example.test', 'other'],
        ['mongodb://example.test/database%FF', 'other'],
    ])('classifies parse failure without echoing errors: %s', async (uri, reason): Promise<void> => {
        const result = (await runUri(uri)).results[0];
        expect(result.status).toBe('fail');
        expect(result.findings).toEqual([expect.objectContaining({ code: 'cs.unparseable', data: { reason } })]);
        expect(JSON.stringify(result)).not.toContain(uri);
    });

    it.each([
        ['sslCertificateKeyFile', 'tlsCertificateKeyFile'],
        ['sslCAFile', 'tlsCAFile'],
        ['sslPEMKeyFile', 'tlsCertificateKeyFile'],
        ['sslPEMKeyPassword', 'tlsCertificateKeyFilePassword'],
        ['sslCert', 'tlsCertificateKeyFile'],
        ['sslInvalidCertificates', 'tlsAllowInvalidCertificates'],
        ['sslInvalidHostNameAllowed', 'tlsAllowInvalidHostnames'],
        ['retryWrite', 'retryWrites'],
        ['ReTrYwRiTe', 'retryWrites'],
    ])('suggests the supported spelling for %s', async (option, suggestion): Promise<void> => {
        const result = (await runUri(`mongodb://example.test/?${option}=private-option-value`)).results[0];
        expect(result.findings).toContainEqual(
            expect.objectContaining({
                code: 'cs.unknownOption',
                severity: 'error',
                data: { option, suggestion },
            }),
        );
        expect(JSON.stringify(result)).not.toContain('private-option-value');
    });

    it('does not suggest a remote spelling or mistake object properties for known options', async (): Promise<void> => {
        const result = (await runUri('mongodb://example.test/?completelyUnrelatedSetting=secret&toString=secret'))
            .results[0];
        expect(result.findings[0].data).toEqual({ option: 'completelyUnrelatedSetting' });
        expect(result.findings).toHaveLength(2);
        expect(result.findings.every((entry): boolean => entry.code === 'cs.unknownOption')).toBe(true);
        expect(JSON.stringify(result)).not.toContain('secret');
    });

    it.each([
        ['fsync', 'journal'],
        ['j', 'journal'],
        ['wtimeout', 'wtimeoutMS'],
        ['WTIMEOUT', 'wtimeoutMS'],
    ])('warns about the driver-deprecated %s option', async (option, replacement): Promise<void> => {
        const result = (await runUri(`mongodb://example.test/?${option}=1`)).results[0];
        expect(result.findings).toContainEqual(
            expect.objectContaining({
                code: 'cs.optionIgnoredByDriver',
                severity: 'warning',
                data: { option, replacement },
            }),
        );
    });

    it('does not treat a commented future deprecation as a current driver deprecation', async (): Promise<void> => {
        const result = (await runUri('mongodb://example.test/?socketTimeoutMS=1&waitQueueTimeoutMS=1')).results[0];
        expect(result.findings).toEqual([]);
    });

    it('matches option keys case-insensitively without changing the user spelling in facts', async (): Promise<void> => {
        const result = (await runUri('mongodb://example.test/?ReTrYwRiTeS=true&TLSinsecure=true&AUTHSOURCE=custom'))
            .results[0];
        expect(result.status).toBe('warning');
        expect(result.findings.map((entry): string => entry.code)).toEqual([
            'cs.tlsVerificationDisabled',
            'cs.authSourceUnusual',
        ]);
        expect(result.facts.options).toContainEqual({
            name: 'ReTrYwRiTeS',
            value: 'true',
            valueSupplied: true,
            known: true,
            sensitive: false,
        });
    });

    it.each(['ssl=true&tls=false', 'ssl=false&tls=true', 'SSL=true&TLS=false'])(
        'detects TLS/SSL disagreement: %s',
        async (query): Promise<void> => {
            expect((await runUri(`mongodb://example.test/?${query}`)).results[0].findings[0].code).toBe(
                'cs.conflictingTlsOptions',
            );
        },
    );

    it.each(['ssl=true', 'tls=false', 'ssl=false&tls=false'])(
        'does not invent a TLS/SSL conflict: %s',
        async (query): Promise<void> => {
            expect((await runUri(`mongodb://example.test/?${query}`)).results[0].findings).toEqual([]);
        },
    );

    it('lists every enabled verification bypass, and no disabled ones', async (): Promise<void> => {
        const result = (
            await runUri(
                'mongodb://example.test/?tlsInsecure=true&tlsAllowInvalidCertificates=true&tlsAllowInvalidHostnames=true',
            )
        ).results[0];
        expect(result.findings[0].data).toEqual({
            options: ['tlsInsecure', 'tlsAllowInvalidCertificates', 'tlsAllowInvalidHostnames'],
        });
        const clean = (
            await runUri(
                'mongodb://example.test/?tlsInsecure=false&tlsAllowInvalidCertificates=false&tlsAllowInvalidHostnames=false',
            )
        ).results[0];
        expect(clean.findings).toEqual([]);
    });

    it('permits multiple hosts without directConnection', async (): Promise<void> => {
        expect((await runUri('mongodb://a,b/?directConnection=false')).results[0].findings).toEqual([]);
    });

    it.each(['admin', '$external'])(
        'recognizes the usual authentication source %s',
        async (authSource): Promise<void> => {
            expect(
                (await runUri(`mongodb://example.test/?authSource=${encodeURIComponent(authSource)}`)).results[0]
                    .findings,
            ).toEqual([]);
        },
    );

    it('warns only about unavailable compressors and preserves the requested order', async (): Promise<void> => {
        const result = (await runUri('mongodb://example.test/?compressors=snappy,zlib', ['zlib'])).results[0];
        expect(result.findings).toEqual([
            expect.objectContaining({
                code: 'cs.compressorUnavailable',
                severity: 'warning',
                data: { compressor: 'snappy', available: ['zlib'] },
                detail: {
                    language: 'en',
                    text: expect.stringContaining('remove it from compressors or put zlib first') as unknown,
                },
            }),
        ]);
        expect(result.facts).toMatchObject({ compressors: ['snappy', 'zlib'], availableCompressors: ['zlib'] });
    });

    it('uses injected compressor availability, including an explicit empty list', async (): Promise<void> => {
        const uri = 'mongodb://example.test/?compressors=zstd,snappy,zlib';
        expect((await runUri(uri, ['zstd', 'snappy', 'zlib'])).results[0].findings).toEqual([]);
        expect((await runUri(uri, [])).results[0].findings).toHaveLength(3);
    });

    it('gives errors precedence over warnings', async (): Promise<void> => {
        const result = (await runUri('mongodb://a,b/?tlsInsecure=true&directConnection=true')).results[0];
        expect(result.status).toBe('fail');
        expect(result.findings.map((entry): string => entry.severity)).toEqual(['warning', 'error']);
    });
});

describe('connection string facts and targets', (): void => {
    it('publishes the non-SRV targets with explicit and default ports', async (): Promise<void> => {
        const run = await runUri('mongodb://a:1,b');
        expect(run.targets).toEqual([
            { host: 'a', port: 1, source: 'uri' },
            { host: 'b', port: 27017, source: 'uri' },
        ]);
        expect(run.results[0].facts).toEqual({
            scheme: 'mongodb',
            hosts: [
                { host: 'a', port: 1 },
                { host: 'b', port: 27017 },
            ],
            database: null,
            userName: null,
            passwordPresent: false,
            options: [],
            compressors: [],
            availableCompressors: ['zlib'],
            effectiveNetworkOptions: [],
        });
    });

    it('does not publish SRV targets or fabricate a port', async (): Promise<void> => {
        const run = await runUri('mongodb+srv://example.test/database');
        expect(run.targets).toEqual([]);
        expect(run.results[0].facts).toMatchObject({
            scheme: 'mongodb+srv',
            hosts: [{ host: 'example.test' }],
            database: 'database',
        });
    });

    it('leaves already published targets untouched for an SRV URI', async (): Promise<void> => {
        const existing = { host: 'prepared.example', port: 27017, source: 'uri' as const };
        const run = await runDiagnostics({
            input: { connectionString: 'mongodb+srv://example.test' },
            checks: [
                {
                    id: 'existingTargets',
                    scope: 'run',
                    run: async (context): Promise<CheckOutcome<BuiltInFindingCode>> => {
                        context.setTargets([existing]);
                        return { status: 'pass', findings: [], facts: {} };
                    },
                },
                createConnectionStringCheck(),
            ],
        });
        expect(run.targets).toEqual([existing]);
        expect(run.results[1].status).toBe('pass');
    });

    it('decodes the user name and database without retaining the password', async (): Promise<void> => {
        const result = (await runUri('mongodb://user%40name:private%2Fpassword@example.test/db%20name')).results[0];
        expect(result.facts).toMatchObject({ userName: 'user@name', database: 'db name', passwordPresent: true });
        expect(JSON.stringify(result)).not.toContain('private/password');
        expect(JSON.stringify(result)).not.toContain('private%2Fpassword');
    });

    it('supports bracketed IPv6 endpoints without passing brackets to the target', async (): Promise<void> => {
        const run = await runUri('mongodb://[::1]:27018,[2001:db8::1]');
        expect(run.results[0].status).toBe('pass');
        expect(run.targets).toEqual([
            { host: '::1', port: 27018, source: 'uri' },
            { host: '2001:db8::1', port: 27017, source: 'uri' },
        ]);
    });

    it('treats a value containing an at sign as an option, not userinfo', async (): Promise<void> => {
        const result = (await runUri('mongodb://example.test/?appName=contact%40example.test')).results[0];
        expect(result.status).toBe('pass');
        expect(result.facts.userName).toBeNull();
    });

    it('does not misclassify an at sign in a query when the public parser rejects it', async (): Promise<void> => {
        const result = (await runUri('mongodb://example.test/?appName=contact@example.test')).results[0];
        expect(result.findings.map((entry): string => entry.code)).toEqual(['cs.unparseable']);
    });

    it('retains known non-secret values including certificate file paths', async (): Promise<void> => {
        const result = (
            await runUri('mongodb://example.test/?tlsCertificateKeyFile=%2Fprivate%2Fclient.pem&tlsCAFile=%2Fca.pem')
        ).results[0];
        expect(result.facts.options).toEqual([
            {
                name: 'tlsCertificateKeyFile',
                value: '/private/client.pem',
                valueSupplied: true,
                known: true,
                sensitive: false,
            },
            { name: 'tlsCAFile', value: '/ca.pem', valueSupplied: true, known: true, sensitive: false },
        ]);
    });

    it('classifies the static table secrets and only current driver-deprecated options', (): void => {
        for (const name of [
            'tlsCertificateKeyFilePassword',
            'proxyPassword',
            'authMechanismProperties',
            'auth',
            'key',
            'pfx',
            'passphrase',
        ]) {
            expect(URI_OPTIONS[name].sensitive).toBe(true);
        }
        expect(URI_OPTIONS.tlsCertificateKeyFile.sensitive).toBe(false);
        expect(
            Object.entries(URI_OPTIONS)
                .filter(([, descriptor]): boolean => descriptor.deprecated === true)
                .map(([name]): string => name),
        ).toEqual(['fsync', 'j', 'wtimeout']);
    });

    it.each([false, true])(
        'excludes passwords and sensitive/unknown option values (encoded: %s)',
        async (encoded): Promise<void> => {
            const encode = (value: string): string =>
                encoded
                    ? [...value].map((character): string => `%${character.charCodeAt(0).toString(16)}`).join('')
                    : value;
            const password = 'private-password';
            const query = [
                `tLsCeRtIfIcAtEkEyFiLePaSsWoRd=${encode('s3cr3t')}`,
                `PROXYPASSWORD=${encode('pr0xy')}`,
                `foo=${encode('hunter2')}`,
                `authMechanismProperties=${encode('AWS_SESSION_TOKEN:private-token')}`,
                `password=${encode('option-password')}`,
            ].join('&');
            const run = await runUri(`mongodb://user:${encode(password)}@example.test/?${query}`);
            const result = run.results[0];
            expect(result.status).toBe('fail');
            const json = JSON.stringify(run);
            for (const secret of [password, 's3cr3t', 'pr0xy', 'hunter2', 'private-token', 'option-password']) {
                expect(json).not.toContain(secret);
                expect(json).not.toContain(encode(secret));
            }
            const options = result.facts.options as readonly {
                readonly name: string;
                readonly value?: string;
                readonly valueSupplied: boolean;
            }[];
            expect(options).toHaveLength(5);
            expect(options.every((option): boolean => !Object.hasOwn(option, 'value') && option.valueSupplied)).toBe(
                true,
            );
        },
    );

    it('also excludes all credentials when parsing fails', async (): Promise<void> => {
        const uri =
            'mongodb://user:private-password%FF@example.test/?tlsCertificateKeyFilePassword=s3cr3t&proxyPassword=pr0xy&foo=hunter2';
        const run = await runUri(uri);
        const json = JSON.stringify(run);
        for (const secret of ['private-password', 's3cr3t', 'pr0xy', 'hunter2']) {
            expect(json).not.toContain(secret);
        }
        expect(run.results[0].findings[0].code).toBe('cs.unparseable');
    });

    it('does not include identifiers or option values in English details', async (): Promise<void> => {
        const result = (
            await runUri(
                'mongodb://private-user:private-password@private-host/?authSource=private-database&tlsInsecure=true&foo=private-value',
            )
        ).results[0];
        const text = result.findings.map((entry): string => entry.detail.text).join('\n');
        for (const excluded of [
            'private-user',
            'private-password',
            'private-host',
            'private-database',
            'private-value',
        ]) {
            expect(text).not.toContain(excluded);
        }
    });
});
