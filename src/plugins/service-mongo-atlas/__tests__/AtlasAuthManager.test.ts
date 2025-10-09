/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AtlasAuthManager } from '../utils/AtlasAuthManager';
import { AtlasCredentialCache } from '../utils/AtlasCredentialCache';

type FetchFn = (url: string, init?: any) => Promise<any>;

describe('AtlasAuthManager (Jest)', () => {
    const orgId = 'authOrg';
    const clientId = 'client';
    const clientSecret = 'secret';
    let originalFetch: any;

    beforeEach(() => {
        originalFetch = global.fetch;
        // ensure we start with a clean slate
        // @ts-expect-error override for test
        delete global.fetch;
    });

    afterEach(() => {
        AtlasCredentialCache.clearAtlasCredentials(orgId);
        if (originalFetch) {
            global.fetch = originalFetch;
        } else {
            // @ts-expect-error restore
            delete global.fetch;
        }
    });

    test('getOAuthBasicAuthHeader encodes credentials', () => {
        const hdr = AtlasAuthManager.getOAuthBasicAuthHeader('id', 'sec');
        expect(hdr).toBe('Basic aWQ6c2Vj');
    });

    test('requestOAuthToken success stores nothing automatically', async () => {
        const mockFetch: FetchFn = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ access_token: 'tok', expires_in: 100, token_type: 'Bearer' }),
        });
        global.fetch = mockFetch as any;
        const resp = await AtlasAuthManager.requestOAuthToken(clientId, clientSecret);
        expect(resp.access_token).toBe('tok');
    });

    test('requestOAuthToken failure throws with status and text', async () => {
        const mockFetch: FetchFn = async () => ({ ok: false, status: 400, text: async () => 'bad request' });
        global.fetch = mockFetch as any;
        await expect(AtlasAuthManager.requestOAuthToken(clientId, clientSecret)).rejects.toThrow(/400/);
    });

    test('getAuthorizationHeader returns bearer token using cache', async () => {
        AtlasCredentialCache.setAtlasOAuthCredentials(orgId, clientId, clientSecret);
        AtlasCredentialCache.updateAtlasOAuthToken(orgId, 'cachedToken', 3600);
        const hdr = await AtlasAuthManager.getAuthorizationHeader(orgId);
        expect(hdr).toBe('Bearer cachedToken');
    });

    test('getAuthorizationHeader fetches new token when expired', async () => {
        AtlasCredentialCache.setAtlasOAuthCredentials(orgId, clientId, clientSecret);
        AtlasCredentialCache.updateAtlasOAuthToken(orgId, 'old', -1);
        const mockFetch: FetchFn = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ access_token: 'newToken', expires_in: 50, token_type: 'Bearer' }),
        });
        global.fetch = mockFetch as any;
        const hdr = await AtlasAuthManager.getAuthorizationHeader(orgId);
        expect(hdr).toBe('Bearer newToken');
    });

    test('getAuthorizationHeader undefined when no credentials', async () => {
        const hdr = await AtlasAuthManager.getAuthorizationHeader('missing');
        expect(hdr).toBeUndefined();
    });
});
