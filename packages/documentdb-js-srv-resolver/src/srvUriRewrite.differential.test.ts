/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MongoClient } from 'mongodb';
import * as dns from 'node:dns';

import { rewriteSrvUri } from './srvUriRewrite';

import { type MongoClientOptions } from 'mongodb';
import { type SrvRecord } from 'node:dns';

interface DriverResolver {
    resolveSRVRecord(options: MongoClient['options']): Promise<readonly { toString(): string }[]>;
}

// eslint-disable-next-line import/no-internal-modules, @typescript-eslint/no-require-imports -- differential test against the driver's own SRV resolution
const { resolveSRVRecord } = require('mongodb/lib/connection_string') as DriverResolver;
const srvHost = 'cluster.example.com';
const baseUri = `mongodb+srv://${srvHost}`;
const credentialUri = `mongodb+srv://u:p%40ss%3Aw%2Frd%2525@${srvHost}`;
const oneTarget: readonly SrvRecord[] = [{ name: 'one.example.com', port: 27017, priority: 0, weight: 0 }];
const twoTargets: readonly SrvRecord[] = [
    ...oneTarget,
    { name: 'two.example.com', port: 27018, priority: 10, weight: 20 },
];
const oidcOptions: MongoClientOptions = {
    authMechanismProperties: {
        OIDC_CALLBACK: async (): Promise<{ accessToken: string }> => ({ accessToken: 'test-token' }),
    },
};

interface Fixture {
    readonly name: string;
    readonly uri: string;
    readonly options?: MongoClientOptions;
    readonly srvRecords?: readonly SrvRecord[];
    readonly txtRecords?: readonly (readonly string[])[];
    readonly noTxtCode?: 'ENODATA' | 'ENOTFOUND';
    readonly error?: string;
}

const fixtures: Fixture[] = [
    { name: 'no path', uri: baseUri },
    { name: 'database path', uri: `${baseUri}/db` },
    { name: 'encoded database path', uri: `${baseUri}/db%20name` },
    { name: 'special userinfo, no path', uri: credentialUri },
    {
        name: 'special userinfo, database path and TXT authSource',
        uri: `${credentialUri}/db`,
        txtRecords: [['authSource=authDb']],
    },
    { name: 'encoded appName without userinfo', uri: `${baseUri}?appName=%40x%40` },
    { name: 'encoded appName with userinfo', uri: `${credentialUri}/db?appName=%40x%40` },
    { name: 'raw appName with real userinfo', uri: `${credentialUri}/db?appName=@x@` },
    { name: 'URI authSource', uri: `${credentialUri}/db?authSource=userDb`, txtRecords: [['authSource=txtDb']] },
    {
        name: 'case-insensitive authSource',
        uri: `${credentialUri}/db?authsource=userDb`,
        txtRecords: [['authSource=txtDb']],
    },
    {
        name: 'options authSource',
        uri: `${credentialUri}/db`,
        options: { authSource: 'userDb' },
        txtRecords: [['authSource=txtDb']],
    },
    { name: 'no credentials with TXT authSource', uri: `${baseUri}/db`, txtRecords: [['authSource=txtDb']] },
    {
        name: 'authSource alone does not retain credentials',
        uri: `${baseUri}/db?authSource=userDb`,
        txtRecords: [['authSource=txtDb']],
    },
    {
        name: 'options credentials with TXT authSource',
        uri: `${baseUri}/db`,
        options: { auth: { username: 'u', password: 'p' } },
        txtRecords: [['authSource=txtDb']],
    },
    {
        name: 'properties alone retain credentials',
        uri: baseUri,
        options: { authMechanismProperties: { SERVICE_NAME: 'custom' } },
        txtRecords: [['authSource=txtDb']],
    },
    {
        name: 'empty properties do not retain credentials',
        uri: baseUri,
        options: { authMechanismProperties: {} },
        txtRecords: [['authSource=txtDb']],
    },
    {
        name: 'URI properties retain credentials',
        uri: `${baseUri}?authMechanismProperties=SERVICE_NAME:custom`,
        txtRecords: [['authSource=txtDb']],
    },
    {
        name: 'OIDC URI mechanism',
        uri: `${baseUri}/db?authMechanism=MONGODB-OIDC`,
        options: oidcOptions,
        txtRecords: [['authSource=txtDb']],
    },
    {
        name: 'OIDC options mechanism',
        uri: `${baseUri}/db`,
        options: { ...oidcOptions, authMechanism: 'MONGODB-OIDC' },
        txtRecords: [['authSource=txtDb']],
    },
    {
        name: 'OIDC options mechanism overrides URI',
        uri: `${baseUri}?authMechanism=MONGODB-X509`,
        options: { ...oidcOptions, authMechanism: 'MONGODB-OIDC' },
        txtRecords: [['authSource=txtDb']],
    },
    {
        name: 'OIDC case-insensitive URI mechanism',
        uri: `${baseUri}?AUTHMECHANISM=mongodb-oidc`,
        options: oidcOptions,
        txtRecords: [['authSource=txtDb']],
    },
    { name: 'X509 URI mechanism', uri: `${baseUri}/db?authMechanism=MONGODB-X509`, txtRecords: [['authSource=txtDb']] },
    {
        name: 'X509 options mechanism',
        uri: `${baseUri}/db`,
        options: { authMechanism: 'MONGODB-X509' },
        txtRecords: [['authSource=txtDb']],
    },
    { name: 'AWS URI mechanism', uri: `${baseUri}/db?authMechanism=MONGODB-AWS`, txtRecords: [['authSource=txtDb']] },
    {
        name: 'AWS options mechanism',
        uri: `${baseUri}/db`,
        options: { authMechanism: 'MONGODB-AWS' },
        txtRecords: [['authSource=txtDb']],
    },
    {
        name: 'GSSAPI URI mechanism',
        uri: `mongodb+srv://u@${srvHost}/db?authMechanism=GSSAPI`,
        txtRecords: [['authSource=txtDb']],
    },
    {
        name: 'GSSAPI options mechanism',
        uri: baseUri,
        options: { auth: { username: 'u', password: '' }, authMechanism: 'GSSAPI' },
        txtRecords: [['authSource=txtDb']],
    },
    {
        name: 'PLAIN accepts TXT authSource unlike external mechanisms',
        uri: `mongodb+srv://u:p@${srvHost}/db?authMechanism=PLAIN`,
        txtRecords: [['authSource=txtDb']],
    },
    { name: 'URI replicaSet beats TXT', uri: `${baseUri}?replicaSet=userRs`, txtRecords: [['replicaSet=txtRs']] },
    {
        name: 'options replicaSet beats URI and TXT',
        uri: `${baseUri}?replicaSet=uriRs`,
        options: { replicaSet: 'userRs' },
        txtRecords: [['replicaSet=txtRs']],
    },
    { name: 'TXT replicaSet', uri: baseUri, txtRecords: [['replicaSet=txtRs']] },
    { name: 'one-target URI loadBalanced', uri: `${baseUri}?loadBalanced=true`, srvRecords: oneTarget },
    {
        name: 'two-target URI loadBalanced',
        uri: `${baseUri}?loadBalanced=true`,
        error: 'loadBalanced option only supported with a single host in the URI',
    },
    {
        name: 'TXT loadBalanced overrides false URI value',
        uri: `${baseUri}?LOADBALANCED=false`,
        srvRecords: oneTarget,
        txtRecords: [['loadBalanced=true']],
    },
    {
        name: 'TXT false does not override true URI loadBalanced',
        uri: `${baseUri}?loadBalanced=true`,
        srvRecords: oneTarget,
        txtRecords: [['loadBalanced=false']],
    },
    { name: 'TXT other loadBalanced values are ignored', uri: baseUri, txtRecords: [['loadBalanced=not-a-boolean']] },
    { name: 'SRV max hosts in URI at full-list boundary', uri: `${baseUri}?srvMaxHosts=1` },
    { name: 'case-insensitive SRV max hosts in URI', uri: `${baseUri}?SRVMAXHOSTS=1` },
    { name: 'SRV max hosts only in options', uri: baseUri, options: { srvMaxHosts: 1 } },
    { name: 'options SRV max hosts overrides URI', uri: `${baseUri}?srvMaxHosts=1`, options: { srvMaxHosts: 2 } },
    { name: 'numeric SRV max hosts truncates fractions', uri: baseUri, options: { srvMaxHosts: 1.9 } },
    { name: 'numeric SRV max hosts accepts NaN like the driver', uri: baseUri, options: { srvMaxHosts: Number.NaN } },
    {
        name: 'invalid URI SRV max hosts',
        uri: `${baseUri}?srvMaxHosts=invalid`,
        error: 'Expected srvMaxHosts to be stringified int value, got: invalid',
    },
    {
        name: 'negative SRV max hosts',
        uri: baseUri,
        options: { srvMaxHosts: -1 },
        error: 'srvMaxHosts can only be a positive int value, got: -1',
    },
    {
        name: 'invalid directConnection wins over invalid SRV max hosts',
        uri: `${baseUri}?directConnection=invalid&srvMaxHosts=invalid`,
        error: 'directConnection must be either "true" or "false"',
    },
    {
        name: 'invalid loadBalanced wins over invalid SRV max hosts',
        uri: `${baseUri}?loadBalanced=invalid&srvMaxHosts=invalid`,
        error: 'loadBalanced must be either "true" or "false"',
    },
    { name: 'SRV service name in URI', uri: `${baseUri}?srvServiceName=custom` },
    { name: 'case-insensitive SRV service name', uri: `${baseUri}?SRVSERVICENAME=custom` },
    { name: 'SRV service name only in options', uri: baseUri, options: { srvServiceName: 'custom' } },
    {
        name: 'options SRV service name overrides URI',
        uri: `${baseUri}?srvServiceName=uriService`,
        options: { srvServiceName: 'custom' },
    },
    { name: 'both SRV options only in object', uri: baseUri, options: { srvMaxHosts: 1, srvServiceName: 'custom' } },
    { name: 'ssl=false URI', uri: `${baseUri}?ssl=false` },
    { name: 'tls=false URI', uri: `${baseUri}?tls=false` },
    { name: 'uppercase TLS=false URI', uri: `${baseUri}?TLS=false` },
    { name: 'ssl=false options', uri: baseUri, options: { ssl: false } },
    { name: 'tls=false options', uri: baseUri, options: { tls: false } },
    {
        name: 'targets with trailing dots',
        uri: baseUri,
        srvRecords: twoTargets.map((r): SrvRecord => ({ ...r, name: `${r.name}.` })),
    },
    {
        name: 'parent with trailing dot',
        uri: `${baseUri}.`,
        srvRecords: twoTargets.map((r): SrvRecord => ({ ...r, name: `${r.name}.` })),
    },
    {
        name: 'only one target trailing dot is stripped for validation',
        uri: baseUri,
        srvRecords: [{ ...oneTarget[0], name: 'one.example.com..' }],
        error: 'Server record does not share hostname with parent URI',
    },
    { name: 'two-label parent domain', uri: 'mongodb+srv://example.com' },
    {
        name: 'same-level target for two-label parent',
        uri: 'mongodb+srv://example.com',
        srvRecords: [{ ...oneTarget[0], name: 'example.com' }],
        error: 'Server record does not have at least one more domain level than parent URI',
    },
    {
        name: 'parent-domain mismatch',
        uri: baseUri,
        srvRecords: [{ ...oneTarget[0], name: 'one.other.com' }],
        error: 'Server record does not share hostname with parent URI',
    },
    {
        name: 'deceptive parent-domain suffix',
        uri: baseUri,
        srvRecords: [{ ...oneTarget[0], name: 'one.fake-example.com' }],
        error: 'Server record does not share hostname with parent URI',
    },
    {
        name: 'parent-domain comparison is case-sensitive',
        uri: baseUri,
        srvRecords: [{ ...oneTarget[0], name: 'one.EXAMPLE.com' }],
        error: 'Server record does not share hostname with parent URI',
    },
    {
        name: 'missing port defaults to 27017',
        uri: baseUri,
        srvRecords: [{ ...oneTarget[0], port: undefined as unknown as number }],
    },
    {
        name: 'zero port',
        uri: baseUri,
        srvRecords: [{ ...oneTarget[0], port: 0 }],
        error: 'Invalid port (zero) with hostname',
    },
    {
        name: 'no addresses before invalid TXT',
        uri: baseUri,
        srvRecords: [],
        txtRecords: [['tls=true']],
        error: 'No addresses found at host',
    },
    {
        name: 'parent-domain mismatch before invalid TXT',
        uri: baseUri,
        srvRecords: [{ ...oneTarget[0], name: 'one.other.com' }],
        txtRecords: [['tls=true']],
        error: 'Server record does not share hostname with parent URI',
    },
    {
        name: 'multiple TXT records',
        uri: baseUri,
        txtRecords: [['authSource=a'], ['replicaSet=b']],
        error: 'Multiple text records not allowed',
    },
    { name: 'TXT fragments are joined', uri: credentialUri, txtRecords: [['authSource=auth', 'Db&replica', 'Set=rs']] },
    {
        name: 'duplicate valid TXT keys use first value',
        uri: credentialUri,
        txtRecords: [['authSource=first&authSource=second']],
    },
    { name: 'empty successful TXT record', uri: baseUri, txtRecords: [[]] },
    {
        name: 'empty successful TXT answer matches the driver rejection',
        uri: baseUri,
        txtRecords: [],
        error: "Cannot read properties of undefined (reading 'join')",
    },
    {
        name: 'empty TXT authSource',
        uri: credentialUri,
        txtRecords: [['authSource=']],
        error: 'Cannot have empty URI params in DNS TXT Record',
    },
    {
        name: 'empty TXT replicaSet',
        uri: baseUri,
        txtRecords: [['replicaSet=']],
        error: 'Cannot have empty URI params in DNS TXT Record',
    },
    {
        name: 'empty TXT loadBalanced',
        uri: baseUri,
        txtRecords: [['loadBalanced=']],
        error: 'Cannot have empty URI params in DNS TXT Record',
    },
    {
        name: 'invalid TXT key',
        uri: baseUri,
        txtRecords: [['tls=true']],
        error: 'Text record may only set any of: authSource, replicaSet, loadBalanced',
    },
    {
        name: 'TXT keys are case-sensitive',
        uri: credentialUri,
        txtRecords: [['authsource=txtDb']],
        error: 'Text record may only set any of: authSource, replicaSet, loadBalanced',
    },
    {
        name: 'invalid TXT key before empty TXT value',
        uri: baseUri,
        txtRecords: [['tls=true&authSource=']],
        error: 'Text record may only set any of: authSource, replicaSet, loadBalanced',
    },
    {
        name: 'full-target loadBalanced check before multiple TXT',
        uri: `${baseUri}?loadBalanced=true`,
        txtRecords: [['authSource=a'], ['replicaSet=b']],
        error: 'loadBalanced option only supported with a single host in the URI',
    },
    {
        name: 'TXT replicaSet conflict before loadBalanced host count',
        uri: `${baseUri}?srvMaxHosts=1`,
        txtRecords: [['replicaSet=rs&loadBalanced=true']],
        error: 'Cannot combine replicaSet option with srvMaxHosts',
    },
    {
        name: 'TXT loadBalanced with replicaSet',
        uri: `${baseUri}?replicaSet=rs`,
        srvRecords: oneTarget,
        txtRecords: [['loadBalanced=true']],
        error: 'loadBalanced option not supported with a replicaSet option',
    },
    {
        name: 'URI directConnection rejection',
        uri: `${baseUri}?directConnection=true`,
        error: 'SRV URI does not support directConnection',
    },
    {
        name: 'URI loadBalanced with directConnection',
        uri: `${baseUri}?loadBalanced=true&directConnection=true`,
        error: 'loadBalanced option not supported when directConnection is provided',
    },
    {
        name: 'URI loadBalanced with replicaSet and maxHosts',
        uri: `${baseUri}?loadBalanced=true&replicaSet=rs&srvMaxHosts=1`,
        error: 'loadBalanced option not supported with a replicaSet option',
    },
    {
        name: 'options loadBalanced is rejected by preflight',
        uri: baseUri,
        options: { loadBalanced: true },
        error: 'loadBalanced is only a valid option in the URI',
    },
];

for (const noTxtCode of ['ENODATA', 'ENOTFOUND'] as const) {
    fixtures.push({ name: `absent TXT ${noTxtCode}`, uri: credentialUri, noTxtCode });
}
for (const maxLocation of ['URI', 'options'] as const) {
    for (const replicaLocation of ['URI', 'options', 'TXT'] as const) {
        const query: string[] = [];
        const options: MongoClientOptions = {};
        if (maxLocation === 'URI') {
            query.push('srvMaxHosts=1');
        } else {
            options.srvMaxHosts = 1;
        }
        if (replicaLocation === 'URI') {
            query.push('REPLICASET=rs');
        } else if (replicaLocation === 'options') {
            options.replicaSet = 'rs';
        }
        fixtures.push({
            name: `srvMaxHosts in ${maxLocation} with replicaSet in ${replicaLocation}`,
            uri: `${baseUri}${query.length ? `?${query.join('&')}` : ''}`,
            options,
            txtRecords: replicaLocation === 'TXT' ? [['replicaSet=rs']] : undefined,
            noTxtCode: 'ENODATA',
            error:
                replicaLocation === 'TXT'
                    ? 'Cannot combine replicaSet option with srvMaxHosts'
                    : 'Cannot use srvMaxHosts option with replicaSet',
        });
    }
}
for (const srvRecords of [oneTarget, twoTargets]) {
    for (const maxLocation of ['none', 'URI', 'options'] as const) {
        fixtures.push({
            name: `TXT loadBalanced, ${srvRecords.length} targets, srvMaxHosts in ${maxLocation}`,
            uri: `${baseUri}${maxLocation === 'URI' ? '?srvMaxHosts=1' : ''}`,
            options: maxLocation === 'options' ? { srvMaxHosts: 1 } : undefined,
            srvRecords,
            txtRecords: [['loadBalanced=true']],
            error:
                srvRecords.length > 1
                    ? 'loadBalanced option only supported with a single host in the URI'
                    : maxLocation !== 'none'
                      ? 'Cannot limit srv hosts with loadBalanced enabled'
                      : undefined,
        });
    }
}

interface ParsedState {
    readonly tls: boolean | undefined;
    readonly replicaSet: string | undefined;
    readonly loadBalanced: boolean | undefined;
    readonly authSource: string | undefined;
    readonly authMechanism: string | undefined;
    readonly hosts: readonly string[];
    readonly dbName: string | undefined;
    readonly appName: string | undefined;
}

function state(options: MongoClient['options'], hosts: readonly string[]): ParsedState {
    return {
        tls: options.tls,
        replicaSet: options.replicaSet,
        loadBalanced: options.loadBalanced,
        authSource: options.credentials?.source,
        authMechanism: options.credentials?.mechanism,
        hosts: [...hosts].sort(),
        dbName: options.dbName,
        appName: options.appName,
    };
}

type Outcome = { readonly ok: true; readonly state: ParsedState } | { readonly ok: false; readonly error: unknown };

async function driverOutcome(fixture: Fixture): Promise<Outcome> {
    try {
        const options = new MongoClient(fixture.uri, fixture.options).options;
        const hosts = await resolveSRVRecord(options);
        return {
            ok: true,
            state: state(
                options,
                hosts.map((host): string => host.toString()),
            ),
        };
    } catch (error) {
        return { ok: false, error };
    }
}

function rewriteOutcome(fixture: Fixture): Outcome {
    try {
        const result = rewriteSrvUri({
            connectionString: fixture.uri,
            options: fixture.options,
            srvRecords: fixture.srvRecords ?? twoTargets,
            txtRecords: fixture.noTxtCode && !fixture.txtRecords ? undefined : (fixture.txtRecords ?? [[]]),
            sampleSrvMaxHosts: false,
        });
        const options = new MongoClient(result.connectionString, result.options).options;
        return {
            ok: true,
            state: state(
                options,
                options.hosts.map((host): string => host.toString()),
            ),
        };
    } catch (error) {
        return { ok: false, error };
    }
}

describe('SRV rewrite differential against the installed MongoDB API driver', (): void => {
    afterEach((): void => {
        jest.restoreAllMocks();
    });

    it.each(fixtures)('$name', async (fixture): Promise<void> => {
        const srvRecords = fixture.srvRecords ?? twoTargets;
        const resolve = jest
            .spyOn(dns.promises, 'resolve')
            .mockImplementation(async (_hostname: string, rrtype?: string): Promise<SrvRecord[] | string[][]> => {
                if (rrtype === 'SRV') {
                    return srvRecords.map((record): SrvRecord => ({ ...record }));
                }
                if (rrtype === 'TXT') {
                    if (fixture.noTxtCode && !fixture.txtRecords) {
                        throw Object.assign(new Error(`queryTxt ${fixture.noTxtCode}`), { code: fixture.noTxtCode });
                    }
                    return (fixture.txtRecords ?? [[]]).map((record): string[] => [...record]);
                }
                throw new Error('Unexpected DNS record type');
            });
        const expected = await driverOutcome(fixture);
        const actual = rewriteOutcome(fixture);
        if (fixture.error) {
            expect(expected.ok).toBe(false);
            expect(actual.ok).toBe(false);
            if (expected.ok || actual.ok || !(expected.error instanceof Error) || !(actual.error instanceof Error)) {
                throw new Error('Expected both paths to reject');
            }
            expect(expected.error.message).toBe(fixture.error);
            expect(actual.error).toBeInstanceOf(expected.error.constructor);
            expect(actual.error.message).toBe(expected.error.message);
        } else {
            if (!expected.ok) {
                throw expected.error;
            }
            if (!actual.ok) {
                throw actual.error;
            }
            expect(actual.state).toEqual(expected.state);
            const parsed = new MongoClient(fixture.uri, fixture.options).options;
            expect(resolve).toHaveBeenCalledWith(parsed.srvHost, 'TXT');
            expect(resolve).toHaveBeenCalledWith(`_${parsed.srvServiceName}._tcp.${parsed.srvHost}`, 'SRV');
        }
    });

    it('raw appName without userinfo fails driver preflight before any fallback', (): void => {
        const resolve = jest.spyOn(dns.promises, 'resolve');
        expect((): void => {
            new MongoClient(`${baseUri}/?appName=@x@`);
        }).toThrow('Username contains unescaped characters cluster.example.com/?appName=');
        expect(resolve).not.toHaveBeenCalled();
    });
});
