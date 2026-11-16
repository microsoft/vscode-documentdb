/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
    DOCUMENTDB_ENTRA_SCOPE,
    DOCUMENTDB_TOKEN_RESOURCE,
    getCloudForTokenResource,
    getTokenResourceForCloud,
    parseTokenResource,
    toEntraScope,
} from './entraScopes';

describe('DocumentDB Entra scopes', () => {
    it('keeps the exact public resource and scope unchanged', () => {
        expect(DOCUMENTDB_TOKEN_RESOURCE).toBe('https://ossrdbms-aad.database.windows.net');
        expect(DOCUMENTDB_ENTRA_SCOPE).toBe('https://ossrdbms-aad.database.windows.net/.default');
    });

    it.each([
        ['AzureCloud', 'https://ossrdbms-aad.database.windows.net'],
        ['AzureUSGovernment', 'https://ossrdbms-aad.database.usgovcloudapi.net'],
        ['AzureChinaCloud', 'https://ossrdbms-aad.database.chinacloudapi.cn'],
    ] as const)('maps %s to its resource and back', (cloud, resource) => {
        expect(getTokenResourceForCloud(cloud)).toBe(resource);
        expect(getCloudForTokenResource(resource)).toBe(cloud);
        expect(getCloudForTokenResource(`${resource}/`)).toBe(cloud);
    });

    it('normalizes the trailing slash and hostname case', () => {
        expect(toEntraScope(`${DOCUMENTDB_TOKEN_RESOURCE}/`)).toBe(DOCUMENTDB_ENTRA_SCOPE);
        expect(toEntraScope(DOCUMENTDB_TOKEN_RESOURCE)).toBe(DOCUMENTDB_ENTRA_SCOPE);
        expect(parseTokenResource(' https://RESOURCE.EXAMPLE.COM/ ')).toBe('https://resource.example.com');
    });

    it.each([
        undefined,
        null,
        42,
        '',
        'not a URL',
        'http://resource.example.com',
        'https://resource.example.com/path',
        'https://resource.example.com/path/..',
        'https://resource.example.com//',
        'https://resource.example.com?query=true',
        'https://resource.example.com?',
        'https://resource.example.com#fragment',
        'https://resource.example.com#',
        'https://resource.example.com:443',
        'https://resource.example.com:8443',
        'https://user:password@resource.example.com',
        'https://@resource.example.com',
        'https://resource.example.com\\path',
    ])('rejects invalid token resource %s', (value) => {
        expect(parseTokenResource(value)).toBeUndefined();
    });

    it('does not classify unknown or invalid resources', () => {
        expect(getCloudForTokenResource('https://resource.example.com')).toBeUndefined();
        expect(getCloudForTokenResource('http://ossrdbms-aad.database.windows.net')).toBeUndefined();
    });
});
