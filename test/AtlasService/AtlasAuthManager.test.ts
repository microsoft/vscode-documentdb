/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { AtlasAuthManager } from '../../src/plugins/service-mongo-atlas/utils/AtlasAuthManager';
import { AtlasCredentialCache } from '../../src/plugins/service-mongo-atlas/utils/AtlasCredentialCache';

// Mock global fetch
const globalAny: any = global;

type FetchFn = (url: string, init?: any) => Promise<any>;

suite('AtlasAuthManager', () => {
    const orgId = 'authOrg';
    const clientId = 'client';
    const clientSecret = 'secret';
    let originalFetch: unknown;

    setup(() => {
        originalFetch = globalAny.fetch;
        delete globalAny.fetch;
    });

    teardown(() => {
        AtlasCredentialCache.clearAtlasCredentials(orgId);
        if (originalFetch) {
            globalAny.fetch = originalFetch;
        } else {
            delete globalAny.fetch;
        }
    });

    test('getOAuthBasicAuthHeader encodes credentials', () => {
        const hdr = AtlasAuthManager.getOAuthBasicAuthHeader('id', 'sec');
        assert.strictEqual(hdr, 'Basic aWQ6c2Vj');
    });

    test('requestOAuthToken success stores nothing automatically', async () => {
        const mockFetch: FetchFn = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ access_token: 'tok', expires_in: 100, token_type: 'Bearer' }),
        });
        globalAny.fetch = mockFetch;
        const resp = await AtlasAuthManager.requestOAuthToken(clientId, clientSecret);
        assert.strictEqual(resp.access_token, 'tok');
    });

    test('requestOAuthToken failure throws with status and text', async () => {
        const mockFetch: FetchFn = async () => ({ ok: false, status: 400, text: async () => 'bad request' });
        globalAny.fetch = mockFetch;
        await assert.rejects(
            () => AtlasAuthManager.requestOAuthToken(clientId, clientSecret),
            /400/,
            'Should include status code 400',
        );
    });

    test('getAuthorizationHeader returns bearer token using cache', async () => {
        AtlasCredentialCache.setAtlasOAuthCredentials(orgId, clientId, clientSecret);
        // add cached token
        AtlasCredentialCache.updateAtlasOAuthToken(orgId, 'cachedToken', 3600);
        const hdr = await AtlasAuthManager.getAuthorizationHeader(orgId);
        assert.strictEqual(hdr, 'Bearer cachedToken');
    });

    test('getAuthorizationHeader fetches new token when expired', async () => {
        AtlasCredentialCache.setAtlasOAuthCredentials(orgId, clientId, clientSecret);
        // expired token
        AtlasCredentialCache.updateAtlasOAuthToken(orgId, 'old', -1);
        const mockFetch: FetchFn = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ access_token: 'newToken', expires_in: 50, token_type: 'Bearer' }),
        });
        globalAny.fetch = mockFetch;
        const hdr = await AtlasAuthManager.getAuthorizationHeader(orgId);
        assert.strictEqual(hdr, 'Bearer newToken');
    });

    test('getAuthorizationHeader undefined when no credentials', async () => {
        const hdr = await AtlasAuthManager.getAuthorizationHeader('missing');
        assert.strictEqual(hdr, undefined);
    });
});
