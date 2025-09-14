/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AtlasAuthManager } from '../../src/plugins/service-mongo-atlas/utils/AtlasAuthManager';
import { AtlasCredentialCache } from '../../src/plugins/service-mongo-atlas/utils/AtlasCredentialCache';
import { AtlasHttpClient } from '../../src/plugins/service-mongo-atlas/utils/AtlasHttpClient';

// Mock digest-fetch module
jest.mock('digest-fetch', () => {
    return jest.fn().mockImplementation(() => ({
        fetch: jest.fn(async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({}) })),
    }));
});

// Mock AtlasAuthManager
jest.mock('../../src/plugins/service-mongo-atlas/utils/AtlasAuthManager');

const mockedAuthManager = AtlasAuthManager as jest.Mocked<typeof AtlasAuthManager>;
const globalAny: any = global;

describe('AtlasHttpClient', () => {
    const orgId = 'org-http';

    beforeEach(() => {
        jest.resetAllMocks();
        delete globalAny.fetch;
        AtlasCredentialCache.clearAtlasCredentials(orgId);
    });

    test('throws when no credentials', async () => {
        await expect(AtlasHttpClient.get(orgId, '/groups')).rejects.toThrow(/No Atlas credentials/);
    });

    test('uses OAuth flow and sets Authorization header', async () => {
        AtlasCredentialCache.setAtlasOAuthCredentials(orgId, 'cid', 'sec');
        mockedAuthManager.getAuthorizationHeader = jest.fn().mockResolvedValue('Bearer tokenX');
        const fetchSpy = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
        globalAny.fetch = fetchSpy;

        await AtlasHttpClient.get(orgId, '/groups');
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(mockedAuthManager.getAuthorizationHeader).toHaveBeenCalled();
        const headers = fetchSpy.mock.calls[0][1].headers;
        expect(headers.Authorization).toBe('Bearer tokenX');
    });

    test('oauth flow throws when missing bearer', async () => {
        AtlasCredentialCache.setAtlasOAuthCredentials(orgId, 'cid', 'sec');
        mockedAuthManager.getAuthorizationHeader = jest.fn().mockResolvedValue('Invalid');
        await expect(AtlasHttpClient.get(orgId, '/groups')).rejects.toThrow(/Failed to obtain valid OAuth token/);
    });

    test('digest flow uses digest-fetch client and throws on non-ok', async () => {
        AtlasCredentialCache.setAtlasDigestCredentials(orgId, 'pub', 'priv');
        // Override implementation to return failing response
        const digestFetchModule = jest.requireMock('digest-fetch');
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        digestFetchModule.mockImplementation(() => ({
            fetch: jest.fn(async () => ({ ok: false, status: 401, text: async () => 'Unauthorized' })),
        }));
        await expect(AtlasHttpClient.get(orgId, '/groups')).rejects.toThrow(/401/);
    });
});
