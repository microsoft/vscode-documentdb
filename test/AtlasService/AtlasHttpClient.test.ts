/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { AtlasAuthManager } from '../../src/plugins/service-mongo-atlas/utils/AtlasAuthManager';
import { AtlasCredentialCache } from '../../src/plugins/service-mongo-atlas/utils/AtlasCredentialCache';
import { AtlasHttpClient } from '../../src/plugins/service-mongo-atlas/utils/AtlasHttpClient';

const globalAny: any = global;

type FetchFn = (url: string, init?: any) => Promise<any>;

suite('AtlasHttpClient', () => {
    const orgId = 'org-http';
    let originalFetch: unknown;
    let originalGetAuthHeader: typeof AtlasAuthManager.getAuthorizationHeader;

    setup(() => {
        originalFetch = globalAny.fetch;
        originalGetAuthHeader = AtlasAuthManager.getAuthorizationHeader.bind(
            AtlasAuthManager,
        ) as unknown as typeof AtlasAuthManager.getAuthorizationHeader;
        delete globalAny.fetch;
        AtlasCredentialCache.clearAtlasCredentials(orgId);
    });

    teardown(() => {
        if (originalFetch) {
            globalAny.fetch = originalFetch;
        } else {
            delete globalAny.fetch;
        }
        AtlasAuthManager.getAuthorizationHeader = originalGetAuthHeader as any;
    });

    test('throws when no credentials', async () => {
        await assert.rejects(() => AtlasHttpClient.get(orgId, '/groups'), /No Atlas credentials/);
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
        globalAny.fetch = fetchSpy;

        await AtlasHttpClient.get(orgId, '/groups');
        assert.ok(called, 'Expected getAuthorizationHeader to be called');
        const headers = fetchSpyCalls[0][1].headers;
        assert.strictEqual(headers.Authorization, 'Bearer tokenX');
    });

    test('oauth flow throws when missing bearer', async () => {
        AtlasCredentialCache.setAtlasOAuthCredentials(orgId, 'cid', 'sec');
        AtlasAuthManager.getAuthorizationHeader = (async () => 'Invalid') as any;
        await assert.rejects(() => AtlasHttpClient.get(orgId, '/groups'), /Failed to obtain valid OAuth token/);
    });

    test('digest flow uses digest-fetch client and throws on non-ok', async () => {
        AtlasCredentialCache.setAtlasDigestCredentials(orgId, 'pub', 'priv');
        globalAny.fetch = async () => ({ ok: false, status: 401, text: async () => 'Unauthorized' });
        await assert.rejects(() => AtlasHttpClient.get(orgId, '/groups'));
    });
});
