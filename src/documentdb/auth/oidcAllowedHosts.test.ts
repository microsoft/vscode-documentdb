/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';

import {
    BUILT_IN_ENTRA_DESTINATION_SUFFIXES,
    EntraDestinationRejectedError,
    evaluateEntraDestination,
    getAzureCloudFromHosts,
    getOidcAllowedHosts,
    hasDocumentDBHost,
    isEntraDestinationHostAllowed,
    isEntraDestinationRejectedError,
    normalizeCustomHostnameSuffix,
} from './oidcAllowedHosts';

describe('hasDocumentDBHost', () => {
    it.each(['com', 'us', 'cn'])('recognizes DocumentDB service hosts under azure.%s', (tld) => {
        expect(hasDocumentDBHost([`CLUSTER.GLOBAL.mongocluster.cosmos.azure.${tld}:10255`])).toBe(true);
    });

    it.each([
        'cluster.mongocluster.cosmos.azure.us.evil.com',
        'xmongocluster.cosmos.azure.com',
        'cluster.mongocluster.cosmos.azure.tk',
        'cluster.other.azure.us',
        'cluster.mongo.cosmos.azure.com',
        '[::1]:27017',
    ])('does not recognize lookalikes, other services, or RU hosts: %s', (host) => {
        expect(hasDocumentDBHost([host])).toBe(false);
    });

    it('uses the hardened configured suffix with a dot boundary', () => {
        expect(hasDocumentDBHost(['CLUSTER.database.example.com:10255'], ' .DATABASE.EXAMPLE.COM ')).toBe(true);
        expect(hasDocumentDBHost(['notdatabase.example.com'], '.database.example.com')).toBe(false);
        expect(hasDocumentDBHost(['cluster.database.example.com.evil.com'], '.database.example.com')).toBe(false);
        expect(hasDocumentDBHost(['attacker.com.cn'], '.com.cn')).toBe(false);
        expect(hasDocumentDBHost([])).toBe(false);
    });
});

describe('getOidcAllowedHosts', () => {
    it('allows only the service suffix for a public-cloud host, not the full host', () => {
        const result = getOidcAllowedHosts('mongodb://asdf.xyz.mongocluster.cosmos.azure.com:10255/?ssl=true');
        expect(result).toEqual(['*.mongocluster.cosmos.azure.com']);
    });

    it('extends to sovereign-cloud TLDs', () => {
        expect(getOidcAllowedHosts('mongodb://cluster.mongocluster.cosmos.azure.us:10255/')).toEqual([
            '*.mongocluster.cosmos.azure.us',
        ]);
        expect(getOidcAllowedHosts('mongodb://cluster.mongocluster.cosmos.azure.cn:10255/')).toEqual([
            '*.mongocluster.cosmos.azure.cn',
        ]);
    });

    it('handles mongodb+srv:// seedlist connection strings', () => {
        expect(getOidcAllowedHosts('mongodb+srv://cluster.mongocluster.cosmos.azure.com/?tls=true')).toEqual([
            '*.mongocluster.cosmos.azure.com',
        ]);
    });

    it('does not widen the allowlist to an attacker-supplied host', () => {
        expect(getOidcAllowedHosts('mongodb://evil.com:10255/')).toEqual([]);
        expect(getOidcAllowedHosts('mongodb://node.azure.com.evil.com:10255/')).toEqual([]);
        expect(getOidcAllowedHosts('mongodb://node.azure.us.evil.com:10255/')).toEqual([]);
    });

    it('does not trust an azure second-level label under an unknown top-level domain', () => {
        expect(getOidcAllowedHosts('mongodb://db.azure.tk:10255/')).toEqual([]);
        expect(getOidcAllowedHosts('mongodb://db.azure.io:10255/')).toEqual([]);
        expect(getOidcAllowedHosts('mongodb://db.azure.co:10255/')).toEqual([]);
        expect(getOidcAllowedHosts('mongodb://db.azure.xyz:10255/')).toEqual([]);
    });

    it('does not let one known-cloud host carry an unknown-TLD host into the allowlist', () => {
        expect(
            getOidcAllowedHosts('mongodb://a.mongocluster.cosmos.azure.com:10255,b.azure.tk:10255/?replicaSet=rs0'),
        ).toEqual([]);
    });

    it('collapses multiple same-cloud hosts to a single suffix entry', () => {
        const result = getOidcAllowedHosts(
            'mongodb://a.mongocluster.cosmos.azure.com:10255,b.mongocluster.cosmos.azure.com:10255/?replicaSet=rs0',
        );
        expect(result).toEqual(['*.mongocluster.cosmos.azure.com']);
    });

    it('ignores ports when classifying the host', () => {
        expect(getOidcAllowedHosts('mongodb://cluster.mongocluster.cosmos.azure.com:27017/')).toEqual([
            '*.mongocluster.cosmos.azure.com',
        ]);
    });

    it('fails closed when the connection string cannot be parsed', () => {
        expect(getOidcAllowedHosts('not a connection string')).toEqual([]);
        expect(getOidcAllowedHosts('')).toEqual([]);
    });

    it('trusts a custom suffix only when configured and matching a hostname boundary', () => {
        const connectionString = 'mongodb://cluster.database.example.com:10255/';
        expect(getOidcAllowedHosts(connectionString)).toEqual([]);
        expect(getOidcAllowedHosts(connectionString, '.database.example.com')).toEqual(['*.database.example.com']);
        expect(getOidcAllowedHosts(connectionString, '.other.example.com')).toEqual([]);
        expect(getOidcAllowedHosts('mongodb://notdatabase.example.com/', '.database.example.com')).toEqual([]);
        expect(getOidcAllowedHosts('mongodb://database.example.com.evil.com/', '.database.example.com')).toEqual([]);
    });

    it('normalizes the custom suffix without trusting invalid or bare TLD values', () => {
        expect(normalizeCustomHostnameSuffix(' .DATABASE.EXAMPLE.COM ')).toBe('database.example.com');
        for (const value of [undefined, '', '.', 'com', '*.example.com', 'https://example.com', '..example.com']) {
            expect(normalizeCustomHostnameSuffix(value)).toBeUndefined();
        }
    });

    it.each(['.com.cn', '.co.uk', 'net.au', '.org.uk', '.gov.us', ' CO.ZA '])(
        'rejects the public suffix %s without widening the token allowlist',
        (suffix) => {
            expect(normalizeCustomHostnameSuffix(suffix)).toBeUndefined();
            const normalized = suffix.trim().toLowerCase().replace(/^\./, '');
            expect(getOidcAllowedHosts(`mongodb://attacker.${normalized}/`, suffix)).toEqual([]);
        },
    );

    it.each(['example.com', 'database.co.uk', 'service.com.cn'])('accepts the narrower custom suffix %s', (suffix) => {
        expect(normalizeCustomHostnameSuffix(` .${suffix.toUpperCase()} `)).toBe(suffix);
        expect(getOidcAllowedHosts(`mongodb://cluster.${suffix}/`, suffix)).toEqual([`*.${suffix}`]);
    });
});

describe('Entra destination policy', () => {
    it('ships only the three service-specific suffixes', () => {
        expect(BUILT_IN_ENTRA_DESTINATION_SUFFIXES).toEqual([
            'mongocluster.cosmos.azure.com',
            'mongocluster.cosmos.azure.us',
            'mongocluster.cosmos.azure.cn',
        ]);
    });

    it.each(BUILT_IN_ENTRA_DESTINATION_SUFFIXES)('allows service endpoint forms under %s', (suffix) => {
        for (const prefix of [
            'cluster',
            'cluster.global',
            'node-1',
            'cluster.privatelink',
            'c-legacy',
            'xn--bcher-kva',
        ]) {
            const host = `${prefix}.${suffix}`;
            expect(isEntraDestinationHostAllowed(host.toUpperCase(), [`*.${suffix}`])).toBe(true);
            expect(evaluateEntraDestination(`mongodb://${host}:10255/`)).toEqual({
                allowed: true,
                destinationClass: 'documentdbService',
                allowedHostPatterns: [`*.${suffix}`],
                firstHost: host,
                hostCount: 1,
            });
        }
    });

    it('deduplicates patterns while requiring every seed across clouds to be allowed', () => {
        const hosts = [
            'first.mongocluster.cosmos.azure.us:10255',
            'second.mongocluster.cosmos.azure.us:10255',
            'third.mongocluster.cosmos.azure.cn:10255',
        ];
        expect(evaluateEntraDestination(`mongodb://${hosts.join(',')}/`)).toMatchObject({
            allowed: true,
            destinationClass: 'documentdbService',
            allowedHostPatterns: ['*.mongocluster.cosmos.azure.us', '*.mongocluster.cosmos.azure.cn'],
            firstHost: 'first.mongocluster.cosmos.azure.us',
            hostCount: 3,
        });
    });

    it.each([
        'mongocluster.cosmos.azure.com',
        'xmongocluster.cosmos.azure.com',
        'cluster.mongocluster.cosmos.azure.com.evil.com',
        'cluster.mongocluster.cosmos.azure.tk',
        'cluster.mongocluster.cosmos.azure.com.',
        'cluster.mongo.cosmos.azure.com',
        'account.documents.azure.com',
        'app.eastus.cloudapp.azure.com',
        'app.usgovvirginia.cloudapp.usgovcloudapi.net',
        'app.chinaeast.cloudapp.chinacloudapi.cn',
        'evil.example',
        'xn--mongocluster-9db.cosmos.azure.com',
        '127.0.0.1',
        '2130706433',
        '[::1]',
        '[::ffff:127.0.0.1]',
        '.mongocluster.cosmos.azure.com',
        'cluster..mongocluster.cosmos.azure.com',
        '_cluster.mongocluster.cosmos.azure.com',
        '-cluster.mongocluster.cosmos.azure.com',
        'cluster-.mongocluster.cosmos.azure.com',
        'clüstér.mongocluster.cosmos.azure.com',
        'K.mongocluster.cosmos.azure.com',
        'cluster\n.mongocluster.cosmos.azure.com',
        'cluster.mongocluster.cosmos.azure.com:27017\n',
        'cluster.mongocluster.cosmos.azure.com:27017\r',
        'cluster.mongocluster.cosmos.azure.com:abc',
        'cluster.mongocluster.cosmos.azure.com:0',
        'cluster.mongocluster.cosmos.azure.com:65536',
        'cluster.mongocluster.cosmos.azure.com:',
        'cluster.mongocluster.cosmos.azure.com:27017:27018',
        `${'x'.repeat(64)}.mongocluster.cosmos.azure.com`,
        `${'x'.repeat(63)}.${'x'.repeat(63)}.${'x'.repeat(63)}.${'x'.repeat(63)}.mongocluster.cosmos.azure.com`,
    ])('rejects invalid or untrusted hosts without a fallback: %s', (host) => {
        expect(isEntraDestinationHostAllowed(host, ['*.mongocluster.cosmos.azure.com'])).toBe(false);
        expect(evaluateEntraDestination(`mongodb://${host}/`)).toMatchObject({
            allowed: false,
            allowedHostPatterns: [],
        });
    });

    it.each([
        '',
        'not a connection string',
        'https://cluster.mongocluster.cosmos.azure.com/',
        'mongodb:///',
        'mongodb://:27017/',
        'mongodb://cluster.mongocluster.cosmos.azure.com,,/',
        'mongodb://,cluster.mongocluster.cosmos.azure.com/',
        'mongodb+srv://cluster.mongocluster.cosmos.azure.com:27017/',
        'mongodb+srv://cluster.mongocluster.cosmos.azure.com,other.mongocluster.cosmos.azure.com/',
        'mongodb://cluster.mongocluster.cosmos.azure.com/#fragment',
    ])('rejects malformed or empty connections: %s', (connectionString) => {
        expect(evaluateEntraDestination(connectionString)).toMatchObject({
            allowed: false,
            destinationClass: 'other',
            allowedHostPatterns: [],
        });
    });

    it.each([
        'trusted.mongocluster.cosmos.azure.com,evil.example',
        'evil.example,trusted.mongocluster.cosmos.azure.com',
        'trusted.mongocluster.cosmos.azure.com,app.eastus.cloudapp.azure.com',
    ])('does not let an allowed seed authorize other hosts: %s', (hosts) => {
        expect(hasDocumentDBHost(hosts.split(','))).toBe(true);
        expect(evaluateEntraDestination(`mongodb://${hosts}/`).allowed).toBe(false);
        expect(getOidcAllowedHosts(`mongodb://${hosts}/`)).toEqual([]);
    });

    it('admits a custom suffix only when used, alongside validated built-in seeds', () => {
        expect(
            evaluateEntraDestination(
                'mongodb://a.mongocluster.cosmos.azure.com,b.database.example.com/',
                ' .DATABASE.EXAMPLE.COM ',
            ),
        ).toMatchObject({
            allowed: true,
            destinationClass: 'customSuffix',
            customSuffixUsed: 'database.example.com',
            allowedHostPatterns: ['*.mongocluster.cosmos.azure.com', '*.database.example.com'],
        });
        expect(
            evaluateEntraDestination('mongodb://a.mongocluster.cosmos.azure.com/', 'database.example.com')
                .customSuffixUsed,
        ).toBeUndefined();
        expect(
            evaluateEntraDestination('mongodb://a.database.example.com,evil.example/', 'database.example.com')
                .allowedHostPatterns,
        ).toEqual([]);
    });

    it.each([
        undefined,
        null,
        1,
        [],
        ['example.com'],
        {},
        '',
        '.',
        'com',
        '*.example.com',
        '..example.com',
        'https://example.com',
        'example.com.',
        'example.com:10255',
        'example.com/path',
        'example..com',
        '_example.com',
        '-example.com',
        'example-.com',
        'éxample.com',
        'K.example.com',
        '127.0.0.1',
        '[::1]',
        `${'x'.repeat(64)}.example`,
        `${'x'.repeat(63)}.${'x'.repeat(63)}.${'x'.repeat(63)}.${'x'.repeat(63)}`,
        'azure.com',
        'azure.us',
        'azure.cn',
        'cosmos.azure.com',
        'cosmos.azure.us',
        'cosmos.azure.cn',
        ...BUILT_IN_ENTRA_DESTINATION_SUFFIXES,
        'cloudapp.azure.com',
        'eastus.cloudapp.azure.com',
        'cloudapp.example.com',
        'example.cloudapp',
        'cloudapp.usgovcloudapi.net',
        'usgovcloudapi.net',
        'cloudapp.chinacloudapi.cn',
        'chinacloudapi.cn',
    ])('ignores unsafe custom suffix %s', (value) => {
        expect(normalizeCustomHostnameSuffix(value)).toBeUndefined();
        expect(evaluateEntraDestination('mongodb://evil.example/', value).allowed).toBe(false);
        expect(evaluateEntraDestination('mongodb://a.mongocluster.cosmos.azure.com/', value).allowed).toBe(true);
    });

    it.each(['newform.cosmos.azure.com', 'private.mongocluster.cosmos.azure.com', 'cloudapplication.example.com'])(
        'retains narrower custom service suffixes: %s',
        (suffix) => {
            expect(normalizeCustomHostnameSuffix(suffix)).toBe(suffix);
            expect(evaluateEntraDestination(`mongodb://cluster.${suffix}/`, suffix).allowed).toBe(true);
            expect(evaluateEntraDestination(`mongodb://${suffix}/`, suffix).allowed).toBe(
                suffix.endsWith('.mongocluster.cosmos.azure.com'),
            );
        },
    );

    it.each([
        ['app.eastus.cloudapp.azure.com', 'otherAzure', true, false],
        ['app.usgovvirginia.cloudapp.usgovcloudapi.net', 'otherAzure', true, false],
        ['app.chinaeast.cloudapp.chinacloudapi.cn', 'otherAzure', true, false],
        ['mongocluster.cosmos.azure.us', 'otherAzure', true, true],
        ['documentdb.windows.net', 'otherAzure', true, true],
        ['node.region.documentdb.windows.net', 'otherAzure', true, true],
        ['node.region.mongocluster.windows.net', 'otherAzure', true, true],
        ['windows.net', 'otherAzure', true, false],
        ['documentdb.notwindows.net', 'other', false, true],
        ['documentdb.windows.net.evil.example', 'other', false, true],
        ['my-documentdb.windows.net', 'otherAzure', true, false],
        ['documentdbexample.windows.net', 'otherAzure', true, false],
        ['documentdb.example', 'other', false, true],
        ['cluster.mongocluster.cosmos.azure.tk', 'other', false, true],
        ['evil.example', 'other', false, false],
        ['my-mongocluster.example', 'other', false, false],
    ])('returns bounded rejection evidence for %s', (host, destinationClass, microsoftCloudDomain, serviceLabel) => {
        expect(evaluateEntraDestination(`mongodb://${host}/`)).toMatchObject({
            allowed: false,
            allowedHostPatterns: [],
            destinationClass,
            rejection: { microsoftCloudDomain, serviceLabel },
        });
    });

    it('uses only rejected seeds for rejection classification', () => {
        expect(evaluateEntraDestination('mongodb://a.mongocluster.cosmos.azure.com,evil.example/')).toMatchObject({
            destinationClass: 'other',
            rejection: { microsoftCloudDomain: false, serviceLabel: false },
        });
    });

    it('creates a localized safe error without leaking credentials or full input', () => {
        const decision = evaluateEntraDestination(
            'mongodb://sensitive:secret@EVIL.example:10255,second.example/?appName=secret',
        );
        const error = new EntraDestinationRejectedError(decision);
        expect(error.message).toBe("Microsoft Entra ID isn't allowed for this server.");
        expect(error.firstHost).toBe('evil.example');
        expect(error.additionalHostCount).toBe(1);
        expect(JSON.stringify(error)).not.toMatch(/sensitive|secret|10255|mongodb:/);
        expect(isEntraDestinationRejectedError(error)).toBe(true);
        expect(isEntraDestinationRejectedError(new Error(error.message))).toBe(false);
        expect(isEntraDestinationRejectedError({ name: error.name })).toBe(false);
        expect(isEntraDestinationRejectedError(null)).toBe(false);
        expect(new EntraDestinationRejectedError(evaluateEntraDestination('invalid secret')).firstHost).toBe('');
        expect(new EntraDestinationRejectedError(evaluateEntraDestination('')).additionalHostCount).toBe(0);
        expect(
            new EntraDestinationRejectedError({
                firstHost: 'username:password@evil.example',
                hostCount: 1,
            }).firstHost,
        ).toBe('');
    });

    it.each(['127.0.0.1', '[::1]', 'cluster.mongocluster.cosmos.azure.com.'])(
        'retains a safe display hostname for the rejected destination %s',
        (host) => {
            const decision = evaluateEntraDestination(`mongodb://${host}:10255/`);
            expect(decision.allowed).toBe(false);
            expect(new EntraDestinationRejectedError(decision).firstHost).toBe(host);
        },
    );
});

describe('getAzureCloudFromHosts', () => {
    it.each([
        ['azure.com', 'AzureCloud'],
        ['azure.us', 'AzureUSGovernment'],
        ['azure.cn', 'AzureChinaCloud'],
    ])('classifies %s hosts', (suffix, cloud) => {
        expect(getAzureCloudFromHosts(`mongodb://a.${suffix}:10255,b.${suffix}:10255/`)).toEqual({
            cloud,
            hasOtherHosts: false,
        });
        expect(getAzureCloudFromHosts(`mongodb+srv://CLUSTER.${suffix}/`)).toEqual({ cloud, hasOtherHosts: false });
    });

    it.each([
        'mongodb://a.mongocluster.cosmos.azure.us,b.documentdb.private.example/',
        'mongodb://b.documentdb.private.example,a.mongocluster.cosmos.azure.us/',
        'mongodb://a.mongocluster.cosmos.azure.us,10.0.0.4:10260/',
        'mongodb://a.mongocluster.cosmos.azure.us,[::1]:10260/',
    ])('keeps the recognized cloud when other hosts are present: %s', (connectionString) => {
        expect(getAzureCloudFromHosts(connectionString)).toEqual({
            cloud: 'AzureUSGovernment',
            hasOtherHosts: true,
        });
    });

    it.each([
        'mongodb://a.azure.com,b.azure.us/',
        'mongodb://a.azure.cn,b.azure.com/',
        'mongodb://a.azure.com,b.azure.us,private.example.com/',
    ])('reports hosts in more than one cloud as conflicting: %s', (connectionString) => {
        expect(getAzureCloudFromHosts(connectionString).cloud).toBe('conflicting');
    });

    it.each([
        'mongodb://private.example.com/',
        'mongodb://node.azure.us.evil.com/',
        'mongodb://node.azure.xyz/',
        'mongodb://127.0.0.1/',
    ])('does not classify unrecognized hosts: %s', (connectionString) => {
        expect(getAzureCloudFromHosts(connectionString)).toEqual({ cloud: undefined, hasOtherHosts: true });
    });

    it.each(['not a connection string', ''])('does not classify invalid input: %s', (connectionString) => {
        expect(getAzureCloudFromHosts(connectionString)).toEqual({ cloud: undefined, hasOtherHosts: false });
    });
});
