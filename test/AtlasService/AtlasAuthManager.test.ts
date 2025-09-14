/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AtlasAuthManager } from '../../src/plugins/service-mongo-atlas/utils/AtlasAuthManager';
import { AtlasCredentialCache } from '../../src/plugins/service-mongo-atlas/utils/AtlasCredentialCache';

// Mock global fetch
const globalAny: any = global;

describe('AtlasAuthManager', () => {
    const orgId = 'authOrg';
    const clientId = 'client';
    const clientSecret = 'secret';

    beforeEach(() => {
        jest.resetAllMocks();
        delete globalAny.fetch;
    });

    afterEach(() => {
        AtlasCredentialCache.clearAtlasCredentials(orgId);
    });

    test('getOAuthBasicAuthHeader encodes credentials', () => {
        const hdr = AtlasAuthManager.getOAuthBasicAuthHeader('id', 'sec');
        expect(hdr).toBe('Basic aWQ6c2Vj');
    });

    test('requestOAuthToken success stores nothing automatically', async () => {
        globalAny.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ access_token: 'tok', expires_in: 100, token_type: 'Bearer' }),
        });
        const resp = await AtlasAuthManager.requestOAuthToken(clientId, clientSecret);
        expect(resp.access_token).toBe('tok');
        expect(globalAny.fetch).toHaveBeenCalled();
    });

    test('requestOAuthToken failure throws with status and text', async () => {
        globalAny.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 400,
            text: async () => 'bad request',
        });
        await expect(AtlasAuthManager.requestOAuthToken(clientId, clientSecret)).rejects.toThrow(/400/);
    });

    test('getAuthorizationHeader returns bearer token using cache', async () => {
        AtlasCredentialCache.setAtlasOAuthCredentials(orgId, clientId, clientSecret);
        // add cached token
        AtlasCredentialCache.updateAtlasOAuthToken(orgId, 'cachedToken', 3600);
        const hdr = await AtlasAuthManager.getAuthorizationHeader(orgId);
        expect(hdr).toBe('Bearer cachedToken');
    });

    test('getAuthorizationHeader fetches new token when expired', async () => {
        AtlasCredentialCache.setAtlasOAuthCredentials(orgId, clientId, clientSecret);
        // expired token
        AtlasCredentialCache.updateAtlasOAuthToken(orgId, 'old', -1);
        globalAny.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ access_token: 'newToken', expires_in: 50, token_type: 'Bearer' }),
        });
        const hdr = await AtlasAuthManager.getAuthorizationHeader(orgId);
        expect(hdr).toBe('Bearer newToken');
    });

    test('getAuthorizationHeader undefined when no credentials', async () => {
        const hdr = await AtlasAuthManager.getAuthorizationHeader('missing');
        expect(hdr).toBeUndefined();
    });
});
