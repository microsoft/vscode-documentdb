/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getSrvLookupTarget, isSrvConnectionString, rewriteSrvUri, SrvRewriteError } from './srvUriRewrite';

import { type SrvRecord } from 'node:dns';
import { type RewriteSrvUriInput } from './srvUriRewrite';

const srvHost = 'cluster.example.com';
const uri = `mongodb+srv://${srvHost}`;
const records: readonly SrvRecord[] = [
    { name: 'one.example.com', port: 27017, priority: 0, weight: 0 },
    { name: 'two.example.com', port: 27018, priority: 0, weight: 0 },
];

function input(overrides: Partial<RewriteSrvUriInput> = {}): RewriteSrvUriInput {
    return { connectionString: uri, srvRecords: records, txtRecords: undefined, ...overrides };
}

function params(connectionString: string): URLSearchParams {
    return new URLSearchParams(connectionString.split('?')[1]);
}

describe('isSrvConnectionString', (): void => {
    it.each([
        ['mongodb+srv://h', true],
        ['MONGODB+SRV://h', true],
        ['mongodb://h', false],
        [' mongodb+srv://h', false],
    ])('%s -> %s', (connectionString, expected): void => {
        expect(isSrvConnectionString(connectionString)).toBe(expected);
    });
});

describe('getSrvLookupTarget', (): void => {
    it.each([
        [uri, undefined, 'mongodb'],
        [`${uri}/db?SRVSERVICENAME=custom`, undefined, 'custom'],
        [`${uri}?srvServiceName=custom`, { srvServiceName: 'programmatic' }, 'programmatic'],
    ])('%s with %j uses service %s', (connectionString, options, service): void => {
        expect(getSrvLookupTarget(connectionString, options)).toEqual({
            srvHost,
            srvServiceName: service,
            srvQueryName: `_${service}._tcp.${srvHost}`,
        });
    });

    it.each(['mongodb://h', 'mongodb+srv://'])('rejects %s', (connectionString): void => {
        expect((): void => {
            getSrvLookupTarget(connectionString);
        }).toThrow(SrvRewriteError);
    });
});

describe('rewriteSrvUri', (): void => {
    it('keeps userinfo, path, query and fragment and adds implicit TLS', (): void => {
        const result = rewriteSrvUri(
            input({ connectionString: `mongodb+srv://u%40x:p%2Fw@${srvHost}/db?appName=%40x%40&retryWrites=false` }),
        );
        expect(result.connectionString).toBe(
            'mongodb://u%40x:p%2Fw@one.example.com:27017,two.example.com:27018/db?appName=%40x%40&retryWrites=false&tls=true',
        );
        expect(result.tlsAdded).toBe(true);
    });

    it.each([
        ['?tls=false', undefined],
        ['?SSL=true', undefined],
        ['', { tls: false }],
    ])('keeps explicit TLS %s %j', (query, options): void => {
        const result = rewriteSrvUri(input({ connectionString: `${uri}${query}`, options }));
        expect(result.tlsAdded).toBe(false);
        expect(params(result.connectionString).get('tls')).not.toBe('true');
    });

    it('removes SRV-only options without mutating the caller options and honours srvMaxHosts', (): void => {
        const options = Object.freeze({ srvServiceName: 'custom', srvMaxHosts: 1, appName: 'keep' });
        const result = rewriteSrvUri(input({ connectionString: `${uri}?SRVSERVICENAME=x`, options }));
        expect(result.options).toEqual({ appName: 'keep' });
        expect(result.targets).toEqual(['one.example.com:27017']);
        expect(result.connectionString).not.toMatch(/srv/i);
    });

    it('applies TXT options the user did not set', (): void => {
        const result = rewriteSrvUri(
            input({
                connectionString: `mongodb+srv://u:p@${srvHost}/db?REPLICASET=mine`,
                srvRecords: records.slice(0, 1),
                txtRecords: [['authSource=admin&replica', 'Set=rs&loadBalanced=true']],
            }),
        );
        expect(result.txtApplied).toEqual(['authSource', 'loadBalanced']);
        const query = params(result.connectionString);
        expect(query.get('authSource')).toBe('admin');
        expect(query.get('REPLICASET')).toBe('mine');
        expect(query.get('loadBalanced')).toBe('true');
    });

    it.each([`${uri}?authMechanism=MONGODB-X509`, `${uri}?authSource=mine`])(
        'does not apply TXT authSource for %s',
        (connectionString): void => {
            const result = rewriteSrvUri(input({ connectionString, txtRecords: [['authSource=admin']] }));
            expect(result.txtApplied).toEqual([]);
        },
    );

    it('does not apply TXT authSource for OIDC set in options', (): void => {
        const result = rewriteSrvUri(
            input({ options: { authMechanism: 'MONGODB-OIDC' }, txtRecords: [['authSource=admin']] }),
        );
        expect(result.txtApplied).toEqual([]);
    });

    it.each([
        ['no addresses', { srvRecords: [] }, 'noAddresses'],
        ['other domain', { srvRecords: [{ ...records[0], name: 'one.fake-example.com' }] }, 'parentDomainMismatch'],
        ['multiple TXT', { txtRecords: [['authSource=a'], ['authSource=b']] }, 'txtInvalid'],
        ['unsupported TXT key', { txtRecords: [['tls=false']] }, 'txtInvalid'],
        ['empty TXT value', { txtRecords: [['replicaSet=']] }, 'txtInvalid'],
    ] as const)('rejects %s', (_name, overrides, kind): void => {
        expect((): void => {
            rewriteSrvUri(input(overrides));
        }).toThrow(expect.objectContaining({ kind }) as Error);
    });
});
