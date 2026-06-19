/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getOidcAllowedHosts } from './oidcAllowedHosts';

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

    it('does not widen the allowlist to an attacker-supplied host', () => {
        // A connection string the user was tricked into pasting must not be able
        // to authorize token delivery to a non-Azure host.
        expect(getOidcAllowedHosts('mongodb://evil.com:10255/')).toEqual(['*.azure.com']);
        // Lookalike where "azure" is not the registrable second level.
        expect(getOidcAllowedHosts('mongodb://node.azure.com.evil.com:10255/')).toEqual(['*.azure.com']);
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
});
