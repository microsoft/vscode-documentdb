/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';

import { getAzureCloudFromHosts, getOidcAllowedHosts, normalizeCustomHostnameSuffix } from './oidcAllowedHosts';

describe('getOidcAllowedHosts', () => {
    it('allows only the Azure suffix for a public-cloud host, not the full host', () => {
        const result = getOidcAllowedHosts('mongodb://asdf.xyz.mongocluster.cosmos.azure.com:10255/?ssl=true');
        // The allowlist must stay broad enough to match the host (the driver
        // checks host.endsWith('.azure.com')) but must NOT echo the full host.
        expect(result).toEqual(['*.azure.com']);
    });

    it('extends to sovereign-cloud TLDs', () => {
        expect(getOidcAllowedHosts('mongodb://cluster.mongocluster.cosmos.azure.us:10255/')).toEqual(['*.azure.us']);
        expect(getOidcAllowedHosts('mongodb://cluster.mongocluster.cosmos.azure.cn:10255/')).toEqual(['*.azure.cn']);
    });

    it('handles mongodb+srv:// seedlist connection strings', () => {
        // SRV hosts carry no port and the resolved nodes stay under the same
        // Azure suffix, so *.azure.com still covers them.
        expect(getOidcAllowedHosts('mongodb+srv://cluster.mongocluster.cosmos.azure.com/?tls=true')).toEqual([
            '*.azure.com',
        ]);
    });

    it('does not widen the allowlist to an attacker-supplied host', () => {
        // A connection string the user was tricked into pasting must not be able
        // to authorize token delivery to a non-Azure host.
        expect(getOidcAllowedHosts('mongodb://evil.com:10255/')).toEqual(['*.azure.com']);
        // Lookalike where "azure" is not the registrable second level.
        expect(getOidcAllowedHosts('mongodb://node.azure.com.evil.com:10255/')).toEqual(['*.azure.com']);
        expect(getOidcAllowedHosts('mongodb://node.azure.us.evil.com:10255/')).toEqual(['*.azure.com']);
    });

    it('does not trust an azure second-level label under an unknown top-level domain', () => {
        expect(getOidcAllowedHosts('mongodb://db.azure.tk:10255/')).toEqual(['*.azure.com']);
        expect(getOidcAllowedHosts('mongodb://db.azure.io:10255/')).toEqual(['*.azure.com']);
        expect(getOidcAllowedHosts('mongodb://db.azure.co:10255/')).toEqual(['*.azure.com']);
        expect(getOidcAllowedHosts('mongodb://db.azure.xyz:10255/')).toEqual(['*.azure.com']);
    });

    it('does not let one known-cloud host carry an unknown-TLD host into the allowlist', () => {
        expect(
            getOidcAllowedHosts('mongodb://a.mongocluster.cosmos.azure.com:10255,b.azure.tk:10255/?replicaSet=rs0'),
        ).toEqual(['*.azure.com']);
    });

    it('collapses multiple same-cloud hosts to a single suffix entry', () => {
        const result = getOidcAllowedHosts(
            'mongodb://a.mongocluster.cosmos.azure.com:10255,b.mongocluster.cosmos.azure.com:10255/?replicaSet=rs0',
        );
        expect(result).toEqual(['*.azure.com']);
    });

    it('ignores ports when classifying the host', () => {
        expect(getOidcAllowedHosts('mongodb://cluster.azure.com:27017/')).toEqual(['*.azure.com']);
    });

    it('falls back to the safe default when the connection string cannot be parsed', () => {
        expect(getOidcAllowedHosts('not a connection string')).toEqual(['*.azure.com']);
        expect(getOidcAllowedHosts('')).toEqual(['*.azure.com']);
    });

    it('trusts a custom suffix only when configured and matching a hostname boundary', () => {
        const connectionString = 'mongodb://cluster.database.example.com:10255/';
        expect(getOidcAllowedHosts(connectionString)).toEqual(['*.azure.com']);
        expect(getOidcAllowedHosts(connectionString, '.database.example.com')).toEqual(['*.database.example.com']);
        expect(getOidcAllowedHosts(connectionString, '.other.example.com')).toEqual(['*.azure.com']);
        expect(getOidcAllowedHosts('mongodb://notdatabase.example.com/', '.database.example.com')).toEqual([
            '*.azure.com',
        ]);
        expect(getOidcAllowedHosts('mongodb://database.example.com.evil.com/', '.database.example.com')).toEqual([
            '*.azure.com',
        ]);
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
            expect(getOidcAllowedHosts(`mongodb://attacker.${normalized}/`, suffix)).toEqual(['*.azure.com']);
        },
    );

    it.each(['example.com', 'database.co.uk', 'service.com.cn'])('accepts the narrower custom suffix %s', (suffix) => {
        expect(normalizeCustomHostnameSuffix(` .${suffix.toUpperCase()} `)).toBe(suffix);
        expect(getOidcAllowedHosts(`mongodb://cluster.${suffix}/`, suffix)).toEqual([`*.${suffix}`]);
    });
});

describe('getAzureCloudFromHosts', () => {
    it.each([
        ['azure.com', 'AzureCloud'],
        ['azure.us', 'AzureUSGovernment'],
        ['azure.cn', 'AzureChinaCloud'],
    ])('classifies %s only when every host agrees', (suffix, cloud) => {
        expect(getAzureCloudFromHosts(`mongodb://a.${suffix}:10255,b.${suffix}:10255/`)).toBe(cloud);
        expect(getAzureCloudFromHosts(`mongodb+srv://CLUSTER.${suffix}/`)).toBe(cloud);
    });

    it.each([
        'mongodb://a.azure.com,b.azure.us/',
        'mongodb://a.azure.cn,b.azure.com/',
        'mongodb://a.azure.com,private.example.com/',
        'mongodb://private.example.com/',
        'mongodb://node.azure.us.evil.com/',
        'mongodb://node.azure.xyz/',
        'mongodb://127.0.0.1/',
        'not a connection string',
        '',
    ])('does not classify mixed, unknown, or invalid hosts: %s', (connectionString) => {
        expect(getAzureCloudFromHosts(connectionString)).toBeUndefined();
    });
});
