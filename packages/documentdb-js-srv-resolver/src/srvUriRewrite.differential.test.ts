/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MongoClient } from 'mongodb';
import * as dns from 'node:dns';
import { createRequire } from 'node:module';

import { rewriteSrvUri } from './srvUriRewrite.js';

import { type MongoClientOptions } from 'mongodb';
import { type SrvRecord } from 'node:dns';

interface DriverResolver {
    resolveSRVRecord: (options: MongoClient['options']) => Promise<readonly { toString(): string }[]>;
}

// Differential test against the driver's own SRV resolution, which the package does not export.
const { resolveSRVRecord } = createRequire(import.meta.url)('mongodb/lib/connection_string') as DriverResolver;
const srvHost = 'cluster.example.com';
const baseUri = `mongodb+srv://${srvHost}`;
const credentialUri = `mongodb+srv://u:p%40ss%3Aw%2Frd%2525@${srvHost}`;
const oneTarget: readonly SrvRecord[] = [{ name: 'one.example.com', port: 27017, priority: 0, weight: 0 }];
const twoTargets: readonly SrvRecord[] = [
    ...oneTarget,
    { name: 'two.example.com', port: 27018, priority: 10, weight: 20 },
];
const oidcOptions: MongoClientOptions = {
    authMechanism: 'MONGODB-OIDC',
    authMechanismProperties: {
        OIDC_CALLBACK: async (): Promise<{ accessToken: string }> => ({ accessToken: 'test-token' }),
    },
};

interface Fixture {
    readonly name: string;
    readonly uri: string;
    readonly options?: MongoClientOptions;
    readonly srvRecords?: readonly SrvRecord[];
    /** `undefined` means the TXT lookup returned ENODATA. */
    readonly txtRecords?: readonly (readonly string[])[];
    readonly error?: string;
}

const fixtures: readonly Fixture[] = [
    { name: 'no path, no TXT', uri: baseUri },
    { name: 'encoded database path', uri: `${baseUri}/db%20name` },
    { name: 'special userinfo with TXT authSource', uri: `${credentialUri}/db`, txtRecords: [['authSource=authDb']] },
    { name: 'raw @ in query after userinfo', uri: `${credentialUri}/db?appName=@x@` },
    { name: 'URI authSource beats TXT', uri: `${credentialUri}/db?authsource=userDb`, txtRecords: [['authSource=t']] },
    { name: 'TXT authSource without credentials', uri: `${baseUri}/db`, txtRecords: [['authSource=txtDb']] },
    { name: 'OIDC ignores TXT authSource', uri: baseUri, options: oidcOptions, txtRecords: [['authSource=txtDb']] },
    {
        name: 'X509 ignores TXT authSource',
        uri: `${baseUri}?authMechanism=MONGODB-X509`,
        txtRecords: [['authSource=t']],
    },
    { name: 'TXT replicaSet', uri: baseUri, txtRecords: [['replicaSet=txtRs']] },
    {
        name: 'options replicaSet beats TXT',
        uri: baseUri,
        options: { replicaSet: 'mine' },
        txtRecords: [['replicaSet=t']],
    },
    {
        name: 'TXT loadBalanced overrides false URI value',
        uri: `${baseUri}?LOADBALANCED=false`,
        srvRecords: oneTarget,
        txtRecords: [['loadBalanced=true']],
    },
    { name: 'SRV service name in options', uri: baseUri, options: { srvServiceName: 'custom' } },
    { name: 'tls=false', uri: `${baseUri}?tls=false` },
    { name: 'ssl=false option', uri: baseUri, options: { ssl: false } },
    {
        name: 'targets with trailing dots',
        uri: baseUri,
        srvRecords: twoTargets.map((r) => ({ ...r, name: `${r.name}.` })),
    },
    {
        name: 'deceptive parent-domain suffix',
        uri: baseUri,
        srvRecords: [{ ...oneTarget[0], name: 'one.fake-example.com' }],
        error: 'Server record does not share hostname with parent URI',
    },
    {
        name: 'same-level target for two-label parent',
        uri: 'mongodb+srv://example.com',
        srvRecords: [{ ...oneTarget[0], name: 'example.com' }],
        error: 'Server record does not have at least one more domain level than parent URI',
    },
    { name: 'no addresses', uri: baseUri, srvRecords: [], error: 'No addresses found at host' },
    {
        name: 'multiple TXT records',
        uri: baseUri,
        txtRecords: [['authSource=a'], ['replicaSet=b']],
        error: 'Multiple text records not allowed',
    },
    {
        name: 'invalid TXT key',
        uri: baseUri,
        txtRecords: [['tls=true']],
        error: 'Text record may only set any of: authSource, replicaSet, loadBalanced',
    },
    {
        name: 'empty TXT value',
        uri: baseUri,
        txtRecords: [['replicaSet=']],
        error: 'Cannot have empty URI params in DNS TXT Record',
    },
    {
        name: 'loadBalanced with two targets',
        uri: `${baseUri}?loadBalanced=true`,
        error: 'loadBalanced option only supported with a single host in the URI',
    },
];

interface ParsedState {
    readonly tls: boolean | undefined;
    readonly replicaSet: string | undefined;
    readonly loadBalanced: boolean | undefined;
    readonly authSource: string | undefined;
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
        return { ok: true, state: state(options, hosts.map(String)) };
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
            txtRecords: fixture.txtRecords,
        });
        const options = new MongoClient(result.connectionString, result.options).options;
        return { ok: true, state: state(options, options.hosts.map(String)) };
    } catch (error) {
        return { ok: false, error };
    }
}

describe('SRV rewrite differential against the installed MongoDB API driver', (): void => {
    beforeEach((): void => {
        const error = new Error('Driver DNS queries must use the mocked resolve function');
        vi.spyOn(dns.promises, 'resolveSrv').mockRejectedValue(error);
        vi.spyOn(dns.promises, 'resolveTxt').mockRejectedValue(error);
    });

    afterEach((): void => {
        vi.restoreAllMocks();
    });

    it.each(fixtures)('$name', async (fixture): Promise<void> => {
        const srvRecords = fixture.srvRecords ?? twoTargets;
        vi.spyOn(dns.promises, 'resolve').mockImplementation(
            async (_hostname: string, rrtype?: string): Promise<SrvRecord[] | string[][]> => {
                if (rrtype === 'SRV') {
                    return srvRecords.map((record): SrvRecord => ({ ...record }));
                }
                if (rrtype === 'TXT') {
                    if (fixture.txtRecords === undefined) {
                        throw Object.assign(new Error('queryTxt ENODATA'), { code: 'ENODATA' });
                    }
                    return fixture.txtRecords.map((record): string[] => [...record]);
                }
                throw new Error(`Unexpected DNS record type: ${rrtype}`);
            },
        );
        const expected = await driverOutcome(fixture);
        const actual = rewriteOutcome(fixture);
        if (fixture.error) {
            expect(expected).toMatchObject({ ok: false, error: { message: fixture.error } });
            expect(actual).toMatchObject({ ok: false, error: { message: fixture.error } });
        } else {
            expect(actual).toEqual(expected);
        }
    });
});
