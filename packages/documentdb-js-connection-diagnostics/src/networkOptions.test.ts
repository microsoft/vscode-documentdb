/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';

import {
    createConnectionStringCheck,
    describeNetworkOptions,
    resolveNetworkOptions,
    runDiagnostics,
} from './index.js';

import { type Check, type CheckOutcome, type CheckResult, type NetworkOptionLayer, type RunContext } from './index.js';

function context(
    connectionString: string,
    layers: readonly NetworkOptionLayer[] = [],
    srvFacts?: Record<string, unknown>,
): RunContext {
    return {
        runId: 'test',
        input: { connectionString, networkOptionLayers: layers },
        targets: [],
        io: { clock: { now: (): number => 0, setTimeout: (): unknown => 0, clearTimeout: (): void => {} } },
        setTargets: (): void => {},
        addCleanup: (): void => {},
        effectiveTimeout: (): { timeoutMs: number; source: 'check' } => ({ timeoutMs: 10000, source: 'check' }),
        getResult: (id): CheckResult<string> | undefined =>
            id === 'srv' && srvFacts
                ? {
                      checkId: 'srv',
                      status: 'pass',
                      findings: [],
                      facts: srvFacts,
                      durationMs: 0,
                  }
                : undefined,
    };
}

const srv = {
    tlsImplied: true,
    txtOptions: [
        { name: 'authSource', value: 'txtDb' },
        { name: 'loadBalanced', value: 'true' },
    ],
};

describe('effective network options', (): void => {
    it('applies TXT, URI, auth handler and settings in order with per-option origins', (): void => {
        const effective = resolveNetworkOptions(
            context(
                'mongodb+srv://db.test/?authSource=uriDb&loadBalanced=false&tls=false',
                [
                    { origin: 'authHandler', options: { tls: true, authSource: 'handlerDb', connectTimeoutMS: 200 } },
                    { origin: 'setting', options: { authSource: 'settingDb', connectTimeoutMS: 100 } },
                ],
                srv,
            ),
        );
        expect(effective).toEqual({
            values: { authSource: 'settingDb', loadBalanced: false, tls: true, connectTimeoutMS: 100 },
            origins: { authSource: 'setting', loadBalanced: 'uri', tls: 'authHandler', connectTimeoutMS: 'setting' },
        });
        expect(resolveNetworkOptions(context('mongodb+srv://db.test', [], srv))).toEqual({
            values: { tls: true, authSource: 'txtDb', loadBalanced: true },
            origins: { tls: 'srvDefault', authSource: 'txt', loadBalanced: 'txt' },
        });
    });

    it('recognizes case-insensitive keys, ssl aliases, compressors and positive integer timeouts', (): void => {
        const effective = resolveNetworkOptions(
            context(
                'mongodb://db.test/?SSL=true&sslAllowInvalidCertificates=false&SSLAllowInvalidHostnames=true&connectTimeoutMS=123&compressors=zlib,snappy&serverApiVersion=1&authMechanism=PLAIN&proxyHost=proxy.test',
            ),
        );
        expect(effective.values).toEqual({
            tls: true,
            tlsAllowInvalidCertificates: false,
            tlsAllowInvalidHostnames: true,
            connectTimeoutMS: 123,
            compressors: ['zlib', 'snappy'],
            serverApiVersion: '1',
            authMechanism: 'PLAIN',
            proxyHost: 'proxy.test',
        });
        expect(new Set(Object.values(effective.origins))).toEqual(new Set(['uri']));
    });

    it.each(['0', '-1', '1.5', 'Infinity', '1e3', '9007199254740992'])(
        'ignores invalid timeout %s and non-boolean strings',
        (timeout): void => {
            expect(
                resolveNetworkOptions(context(`mongodb://db.test/?tls=1&tlsInsecure=TRUE&connectTimeoutMS=${timeout}`))
                    .values,
            ).toEqual({});
        },
    );

    it('never describes password values, including URI-encoded secrets', async (): Promise<void> => {
        const uri = 'mongodb://db.test/?tls=true&tlsCertificateKeyFilePassword=never%2Bshare&tlsCAFile=ca.pem';
        const effective = resolveNetworkOptions(context(uri));
        expect(effective.values.tlsCertificateKeyFilePassword).toBe('never+share');
        expect(describeNetworkOptions(effective)).toContainEqual({
            name: 'tlsCertificateKeyFilePassword',
            valueSupplied: true,
            origin: 'uri',
        });
        const run = await runDiagnostics({
            input: { connectionString: uri },
            checks: [createConnectionStringCheck()],
        });
        expect(run.results[0].facts.effectiveNetworkOptions).toEqual(describeNetworkOptions(effective));
        expect(JSON.stringify(run)).not.toContain('never');
    });

    it('returns only layers for an unparseable URI, ignoring prior SRV facts', (): void => {
        expect(
            resolveNetworkOptions(
                context('not a uri with secret', [{ origin: 'setting', options: { tls: false } }], srv),
            ),
        ).toEqual({ values: { tls: false }, origins: { tls: 'setting' } });
    });

    it('resolves TXT when queried after the SRV check, without changing connection string facts', async (): Promise<void> => {
        const srvCheck: Check<RunContext, string> = {
            id: 'srv',
            scope: 'run',
            run: async (): Promise<CheckOutcome<string>> => ({ status: 'pass', findings: [], facts: srv }),
        };
        const inspect: Check<RunContext, string> = {
            id: 'inspect',
            scope: 'run',
            run: async (ctx): Promise<CheckOutcome<string>> => ({
                status: 'pass',
                findings: [],
                facts: { effective: describeNetworkOptions(resolveNetworkOptions(ctx)) },
            }),
        };
        const run = await runDiagnostics({
            input: { connectionString: 'mongodb+srv://db.test' },
            checks: [createConnectionStringCheck(), srvCheck, inspect],
        });
        expect(run.results[0].facts.effectiveNetworkOptions).toEqual([]);
        expect(run.results[2].facts.effective).toContainEqual({
            name: 'tls',
            value: true,
            valueSupplied: true,
            origin: 'srvDefault',
        });
    });
});
