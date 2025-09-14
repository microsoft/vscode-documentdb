/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AtlasAuthManager } from '../utils/AtlasAuthManager';
import { AtlasCredentialCache } from '../utils/AtlasCredentialCache';
import { AtlasHttpClient } from '../utils/AtlasHttpClient';

type FetchFn = (url: string, init?: any) => Promise<any>;

describe('AtlasHttpClient (Jest)', () => {
    const orgId = 'org-http';
    let originalFetch: any;
    let originalGetAuthHeader: typeof AtlasAuthManager.getAuthorizationHeader;

    beforeEach(() => {
        originalFetch = global.fetch;
        originalGetAuthHeader = AtlasAuthManager.getAuthorizationHeader.bind(AtlasAuthManager);
        // @ts-expect-error override
        delete global.fetch;
        AtlasCredentialCache.clearAtlasCredentials(orgId);
    });

    afterEach(() => {
        if (originalFetch) {
            global.fetch = originalFetch;
        } else {
            // @ts-expect-error restore
            delete global.fetch;
        }
        AtlasAuthManager.getAuthorizationHeader = originalGetAuthHeader as any;
    });

    test('throws when no credentials', async () => {
        await expect(AtlasHttpClient.get(orgId, '/groups')).rejects.toThrow(/No Atlas credentials/);
    });

    test('uses OAuth flow and sets Authorization header', async () => {
        AtlasCredentialCache.setAtlasOAuthCredentials(orgId, 'cid', 'sec');
        let called = false;
        AtlasAuthManager.getAuthorizationHeader = (async () => {
            called = true;
            return 'Bearer tokenX';
        }) as any;
        const fetchSpyCalls: any[] = [];
        const fetchSpy: FetchFn = async (_url, init) => {
            fetchSpyCalls.push([_url, init]);
            return { ok: true, status: 200, json: async () => ({ ok: true }) } as any;
        };
        global.fetch = fetchSpy as any;

        await AtlasHttpClient.get(orgId, '/groups');
        expect(called).toBe(true);
        const headers = fetchSpyCalls[0][1].headers;
        expect(headers.Authorization).toBe('Bearer tokenX');
    });

    test('oauth flow throws when missing bearer', async () => {
        AtlasCredentialCache.setAtlasOAuthCredentials(orgId, 'cid', 'sec');
        AtlasAuthManager.getAuthorizationHeader = (async () => 'Invalid') as any;
        await expect(AtlasHttpClient.get(orgId, '/groups')).rejects.toThrow(/Failed to obtain valid OAuth token/);
    });

    test('digest flow uses digest-fetch client and throws on non-ok', async () => {
        AtlasCredentialCache.setAtlasDigestCredentials(orgId, 'pub', 'priv');
        global.fetch = (async () => ({ ok: false, status: 401, text: async () => 'Unauthorized' })) as any;
        await expect(AtlasHttpClient.get(orgId, '/groups')).rejects.toThrow();
    });
});
