/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MongoAPIError, MongoClient, MongoParseError } from 'mongodb';

import {
    getSrvLookupTarget,
    getSrvRewriteErrorKind,
    isSrvConnectionString,
    rewriteSrvUri,
} from './srvUriRewrite';

import type { SrvRecord } from 'node:dns';
import type { MongoClientOptions } from 'mongodb';
import type { RewriteSrvUriInput, SrvRewriteErrorKind } from './srvUriRewrite';

const srvHost = 'cluster.example.com';
const uri = `mongodb+srv://${srvHost}`;
const records: readonly SrvRecord[] = [
    { name: 'one.example.com', port: 27017, priority: 0, weight: 0 },
    { name: 'two.example.com', port: 27018, priority: 0, weight: 0 },
    { name: 'three.example.com', port: 27019, priority: 0, weight: 0 },
];

function input(overrides: Partial<RewriteSrvUriInput> = {}): RewriteSrvUriInput {
    return { connectionString: uri, srvRecords: records, txtRecords: undefined, ...overrides };
}

describe('isSrvConnectionString', (): void => {
    it.each([
        ['mongodb+srv://cluster.example.com', true],
        ['MONGODB+SRV://cluster.example.com', true],
        ['MoNgOdB+SrV://cluster.example.com', true],
        ['mongodb://cluster.example.com', false],
        ['mongodb+srv:/cluster.example.com', false],
        [' mongodb+srv://cluster.example.com', false],
        ['', false],
    ])('recognizes %s as %s', (connectionString, expected): void => {
        expect(isSrvConnectionString(connectionString)).toBe(expected);
    });
});

describe('getSrvLookupTarget', (): void => {
    it.each([
        { name: 'default service', connectionString: uri, options: undefined, service: 'mongodb' },
        {
            name: 'URI service',
            connectionString: `${uri}/db?srvServiceName=custom`,
            options: undefined,
            service: 'custom',
        },
        {
            name: 'case-insensitive URI key',
            connectionString: `${uri}?SRVSERVICENAME=custom`,
            options: undefined,
            service: 'custom',
        },
        {
            name: 'options service',
            connectionString: uri,
            options: { srvServiceName: 'programmatic' },
            service: 'programmatic',
        },
        {
            name: 'options take precedence',
            connectionString: `${uri}?srvServiceName=custom`,
            options: { srvServiceName: 'programmatic' },
            service: 'programmatic',
        },
    ])('$name', ({ connectionString, options, service }): void => {
        expect(getSrvLookupTarget(connectionString, options)).toEqual({
            srvHost,
            srvServiceName: service,
            srvQueryName: `_${service}._tcp.${srvHost}`,
        });
    });

    it('preserves the SRV hostname and its trailing dot', (): void => {
        expect(getSrvLookupTarget('MONGODB+SRV://u:p%40ss@cluster.example.com./db?TLS=false').srvHost)
            .toBe('cluster.example.com.');
    });

    it('leaves other validation to driver preflight', (): void => {
        expect(getSrvLookupTarget(`${uri}?srvMaxHosts=invalid&authMechanism=invalid`)).toEqual({
            srvHost,
            srvServiceName: 'mongodb',
            srvQueryName: `_mongodb._tcp.${srvHost}`,
        });
    });

    it.each(['mongodb://cluster.example.com', 'https://cluster.example.com', 'mongodb+srv://', 'mongodb+srv:///db'])(
        'rejects %s',
        (connectionString): void => {
            expect((): void => { getSrvLookupTarget(connectionString); }).toThrow(MongoParseError);
        },
    );
});

describe('rewriteSrvUri', (): void => {
    it.each([
        'u:p%40ss%3Aw%2Frd%2525@',
        'u%40ser:p%40ss%3aw%2frd%2525@',
        'u:p%2525%2F%3A%40@',
        'u:@',
        'u@',
    ])('preserves userinfo bytes verbatim: %s', (userinfo): void => {
        const result = rewriteSrvUri(input({ connectionString: `mongodb+srv://${userinfo}${srvHost}/db` }));
        expect(result.connectionString.startsWith(`mongodb://${userinfo}`)).toBe(true);
        expect(result.connectionString).toContain('/db?tls=true');
    });

    it.each(['', '/db', '/db%20name'])('preserves the path %s', (path): void => {
        const result = rewriteSrvUri(input({ connectionString: `${uri}${path}` }));
        expect(result.connectionString).toBe(`mongodb://${records.map((r): string => `${r.name}:${r.port}`).join(',')}${path}?tls=true`);
    });

    it('preserves other query parameters, including repeated read preference tags and encoded appName', (): void => {
        const result = rewriteSrvUri(input({
            connectionString: `${uri}/db?appName=%40x%40&readPreference=secondary&readPreferenceTags=a%3Ab&readPreferenceTags=c%3Ad&retryWrites=false`,
        }));
        const params = new URLSearchParams(result.connectionString.split('?')[1]);
        expect(params.get('appName')).toBe('@x@');
        expect(params.get('readPreference')).toBe('secondary');
        expect(params.getAll('readPreferenceTags')).toEqual(['a:b', 'c:d']);
        expect(params.get('retryWrites')).toBe('false');
    });

    it.each([
        { query: '', options: undefined, added: true, tls: true },
        { query: '?tls=false', options: undefined, added: false, tls: false },
        { query: '?TLS=true', options: undefined, added: false, tls: true },
        { query: '?ssl=false', options: undefined, added: false, tls: false },
        { query: '?SSL=true', options: undefined, added: false, tls: true },
        { query: '', options: { tls: false }, added: false, tls: false },
        { query: '', options: { ssl: false }, added: false, tls: false },
        { query: '?tls=true', options: { tls: true }, added: false, tls: true },
    ])('adds TLS only when implicit: $query, $options', ({ query, options, added, tls }): void => {
        const result = rewriteSrvUri(input({ connectionString: `${uri}${query}`, options }));
        expect(result.tlsAdded).toBe(added);
        expect(new MongoClient(result.connectionString, result.options).options.tls).toBe(tls);
    });

    it('removes case-insensitive SRV query keys and option keys without mutating caller options', (): void => {
        const options: MongoClientOptions = Object.freeze({
            srvServiceName: 'custom',
            srvMaxHosts: 1,
            tls: false,
            auth: Object.freeze({ username: 'u', password: 'p' }),
            readPreference: 'secondary',
        });
        const before = { ...options, auth: { ...options.auth } };
        const result = rewriteSrvUri(input({
            connectionString: `${uri}/db?SRVMAXHOSTS=2&SRVSERVICENAME=uriService&appName=keep`,
            options,
            random: (): number => 0,
        }));
        expect(options).toEqual(before);
        expect(result.options).not.toBe(options);
        expect(result.options).toEqual({
            tls: false,
            auth: options.auth,
            readPreference: 'secondary',
        });
        expect(result.removedParams).toEqual(['srvMaxHosts', 'srvServiceName']);
        expect(result.targets).toEqual(['one.example.com:27017']);
        expect(result.connectionString).not.toMatch(/srvmaxhosts|srvservicename/i);
        expect(new MongoClient(result.connectionString, result.options).options.appName).toBe('keep');
    });

    it('copies options unchanged when no SRV options need removal', (): void => {
        const options: MongoClientOptions = { appName: 'keep', tls: false };
        const result = rewriteSrvUri(input({ options }));
        expect(result.options).toEqual(options);
        expect(options).toEqual({ appName: 'keep', tls: false });
        expect(result.removedParams).toEqual([]);
    });

    it('keeps trailing-dot targets exactly as the MongoDB API driver HostAddress does', (): void => {
        const result = rewriteSrvUri(input({
            srvRecords: [{ ...records[0], name: 'One.example.com.' }],
        }));
        expect(result.targets).toEqual(['one.example.com.:27017']);
    });

    it('defaults a missing SRV port to 27017', (): void => {
        const result = rewriteSrvUri(input({
            srvRecords: [{ ...records[0], port: undefined as unknown as number }],
        }));
        expect(result.targets).toEqual(['one.example.com:27017']);
    });

    it('reports TXT keys, sorted applied options, and trace-only values', (): void => {
        const result = rewriteSrvUri(input({
            connectionString: `mongodb+srv://u:p@${srvHost}/db`,
            srvRecords: records.slice(0, 1),
            txtRecords: [['loadBalanced=false&replicaSet=rs&auth', 'Source=authDb']],
        }));
        expect(result.txtKeys).toEqual(['loadBalanced', 'replicaSet', 'authSource']);
        expect(result.txtApplied).toEqual(['authSource', 'replicaSet']);
        expect(result.txtSkipped).toEqual([]);
        expect(result.txtReplicaSet).toBe('rs');
        expect(result.txtLoadBalanced).toBe('false');
    });

    it('reports loadBalanced=true from TXT as applied', (): void => {
        const result = rewriteSrvUri(input({ srvRecords: records.slice(0, 1), txtRecords: [['loadBalanced=true']] }));
        expect(result.txtApplied).toEqual(['loadBalanced']);
        expect(result.txtLoadBalanced).toBe('true');
    });

    it('does not apply TXT authSource without credentials', (): void => {
        const result = rewriteSrvUri(input({ txtRecords: [['authSource=authDb']] }));
        expect(result.txtApplied).toEqual([]);
        expect(result.txtSkipped).toEqual(['authSource:noCredentials']);
        expect(new MongoClient(result.connectionString).options.credentials).toBeUndefined();
    });

    it('reports user-specified TXT overrides as skipped', (): void => {
        const result = rewriteSrvUri(input({
            connectionString: `mongodb+srv://u:p@${srvHost}?AUTHSOURCE=userDb&REPLICASET=userRs`,
            txtRecords: [['authSource=txtDb&replicaSet=txtRs']],
        }));
        expect(result.txtSkipped).toEqual(['authSource:userSet', 'replicaSet:userSet']);
        expect(result.txtApplied).toEqual([]);
        expect(result.txtReplicaSet).toBe('txtRs');
    });

    it('reports external authentication TXT authSource as skipped', (): void => {
        const result = rewriteSrvUri(input({
            connectionString: `${uri}?authMechanism=MONGODB-X509`,
            txtRecords: [['authSource=txtDb']],
        }));
        expect(result.txtSkipped).toEqual(['authSource:$external']);
        expect(result.txtApplied).toEqual([]);
    });

    it('reports absent TXT without fabricated values', (): void => {
        const result = rewriteSrvUri(input());
        expect(result.txtKeys).toEqual([]);
        expect(result.txtApplied).toEqual([]);
        expect(result.txtSkipped).toEqual([]);
        expect(result.txtReplicaSet).toBeUndefined();
        expect(result.txtLoadBalanced).toBeUndefined();
    });

    it.each([0, 1, 2, 3, 10])('samples min(srvMaxHosts, targets) for limit %i', (limit): void => {
        const srvRecords = Object.freeze(records.map((record): SrvRecord => Object.freeze({ ...record })));
        const result = rewriteSrvUri(input({
            connectionString: `${uri}?srvMaxHosts=${limit}`,
            srvRecords,
            random: (): number => 0,
        }));
        expect(result.srvTargetCount).toBe(3);
        expect(result.targets).toHaveLength(limit === 0 ? 3 : Math.min(limit, 3));
        expect(new Set(result.targets).size).toBe(result.targets.length);
        for (const target of result.targets) {
            expect(records.map((record): string => `${record.name}:${record.port}`)).toContain(target);
        }
        expect(srvRecords).toEqual(records);
    });

    it('matches the driver partial shuffle with an injected random source', (): void => {
        const random = jest.fn((): number => 0);
        const result = rewriteSrvUri(input({ connectionString: `${uri}?srvMaxHosts=2`, random }));
        expect(result.targets).toEqual(['three.example.com:27019', 'one.example.com:27017']);
        expect(random).toHaveBeenCalledTimes(2);
    });

    it('does not shuffle when the limit is at least the target count', (): void => {
        const random = jest.fn((): number => { throw new Error('unexpected shuffle'); });
        expect(rewriteSrvUri(input({ options: { srvMaxHosts: 3 }, random })).targets)
            .toEqual(records.map((record): string => `${record.name}:${record.port}`));
        expect(random).not.toHaveBeenCalled();
    });

    it('can disable sampling for the driver resolution differential boundary', (): void => {
        const random = jest.fn((): number => { throw new Error('unexpected shuffle'); });
        const result = rewriteSrvUri(input({ options: { srvMaxHosts: 1 }, sampleSrvMaxHosts: false, random }));
        expect(result.targets).toHaveLength(3);
        expect(random).not.toHaveBeenCalled();
    });
});

interface ErrorFixture {
    readonly name: string;
    readonly overrides: Partial<RewriteSrvUriInput>;
    readonly errorClass: typeof MongoAPIError | typeof MongoParseError | typeof TypeError;
    readonly message: string;
    readonly kind: SrvRewriteErrorKind;
}

const errorFixtures: readonly ErrorFixture[] = [
    {
        name: 'no addresses',
        overrides: { srvRecords: [] },
        errorClass: MongoAPIError,
        message: 'No addresses found at host',
        kind: 'noAddresses',
    },
    {
        name: 'parent domain mismatch',
        overrides: { srvRecords: [{ ...records[0], name: 'one.other.com' }] },
        errorClass: MongoAPIError,
        message: 'Server record does not share hostname with parent URI',
        kind: 'parentDomainMismatch',
    },
    {
        name: 'missing extra domain level',
        overrides: { connectionString: 'mongodb+srv://example.com', srvRecords: [{ ...records[0], name: 'example.com' }] },
        errorClass: MongoAPIError,
        message: 'Server record does not have at least one more domain level than parent URI',
        kind: 'parentDomainMismatch',
    },
    {
        name: 'empty successful TXT answer',
        overrides: { txtRecords: [] },
        errorClass: TypeError,
        message: "Cannot read properties of undefined (reading 'join')",
        kind: 'txtInvalid',
    },
    {
        name: 'multiple TXT records',
        overrides: { txtRecords: [['authSource=a'], ['authSource=b']] },
        errorClass: MongoParseError,
        message: 'Multiple text records not allowed',
        kind: 'txtInvalid',
    },
    {
        name: 'unsupported TXT key',
        overrides: { txtRecords: [['tls=true']] },
        errorClass: MongoParseError,
        message: 'Text record may only set any of: authSource, replicaSet, loadBalanced',
        kind: 'txtInvalid',
    },
    {
        name: 'empty TXT value',
        overrides: { txtRecords: [['authSource=']] },
        errorClass: MongoParseError,
        message: 'Cannot have empty URI params in DNS TXT Record',
        kind: 'txtInvalid',
    },
    {
        name: 'TXT replicaSet conflict',
        overrides: { options: { srvMaxHosts: 1 }, txtRecords: [['replicaSet=rs']] },
        errorClass: MongoParseError,
        message: 'Cannot combine replicaSet option with srvMaxHosts',
        kind: 'optionConflict',
    },
    {
        name: 'preflight replicaSet conflict',
        overrides: { options: { srvMaxHosts: 1, replicaSet: 'rs' } },
        errorClass: MongoParseError,
        message: 'Cannot use srvMaxHosts option with replicaSet',
        kind: 'optionConflict',
    },
    {
        name: 'load-balanced full target list',
        overrides: { connectionString: `${uri}?loadBalanced=true` },
        errorClass: MongoParseError,
        message: 'loadBalanced option only supported with a single host in the URI',
        kind: 'optionConflict',
    },
    {
        name: 'load-balanced replicaSet',
        overrides: { connectionString: `${uri}?loadBalanced=true&replicaSet=rs` },
        errorClass: MongoParseError,
        message: 'loadBalanced option not supported with a replicaSet option',
        kind: 'optionConflict',
    },
    {
        name: 'load-balanced directConnection',
        overrides: { connectionString: `${uri}?loadBalanced=true&directConnection=true` },
        errorClass: MongoParseError,
        message: 'loadBalanced option not supported when directConnection is provided',
        kind: 'optionConflict',
    },
    {
        name: 'load-balanced srvMaxHosts',
        overrides: { connectionString: `${uri}?loadBalanced=true&srvMaxHosts=1` },
        errorClass: MongoParseError,
        message: 'Cannot limit srv hosts with loadBalanced enabled',
        kind: 'optionConflict',
    },
];

describe('getSrvRewriteErrorKind', (): void => {
    it.each(errorFixtures)('classifies $name without modifying the error', ({ overrides, errorClass, message, kind }): void => {
        let caught: unknown;
        try {
            rewriteSrvUri(input(overrides));
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(errorClass);
        if (!(caught instanceof Error)) {
            throw new Error('Expected an error');
        }
        expect(caught.message).toBe(message);
        const keys = Reflect.ownKeys(caught);
        const descriptors = Object.getOwnPropertyDescriptors(caught);
        expect(getSrvRewriteErrorKind(caught)).toBe(kind);
        expect(Reflect.ownKeys(caught)).toEqual(keys);
        expect(Object.getOwnPropertyDescriptors(caught)).toEqual(descriptors);
        expect(caught).not.toHaveProperty('srvRewriteErrorKind');
    });

    it.each([undefined, null, 'No addresses found at host', {}, new MongoAPIError('No addresses found at host')])(
        'does not classify an unrelated error or non-error',
        (error): void => {
            expect(getSrvRewriteErrorKind(error)).toBeUndefined();
        },
    );
});
