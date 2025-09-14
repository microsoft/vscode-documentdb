/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AtlasCredentialCache } from '../../src/plugins/service-mongo-atlas/utils/AtlasCredentialCache';

// Helper to access private store for cleanup without exposing implementation
function clear(orgId: string) {
    AtlasCredentialCache.clearAtlasCredentials(orgId);
}

describe('AtlasCredentialCache', () => {
    const orgId = 'OrgOne';
    const orgIdDifferentCase = 'orgone';

    afterEach(() => {
        clear(orgId);
    });

    test('set and get OAuth credentials (case insensitive key)', () => {
        AtlasCredentialCache.setAtlasOAuthCredentials(orgId, 'clientId', 'clientSecret');
        const creds = AtlasCredentialCache.getAtlasCredentials(orgIdDifferentCase);
        expect(creds).toBeDefined();
        expect(creds?.authType).toBe('oauth');
        expect(creds?.oauth?.clientId).toBe('clientId');
    });

    test('set and get Digest credentials', () => {
        AtlasCredentialCache.setAtlasDigestCredentials(orgId, 'public', 'private');
        const creds = AtlasCredentialCache.getAtlasCredentials(orgId);
        expect(creds?.authType).toBe('digest');
        expect(creds?.digest?.publicKey).toBe('public');
    });

    test('update token caches expiry and value', () => {
        AtlasCredentialCache.setAtlasOAuthCredentials(orgId, 'client', 'secret');
        // use a larger expiry to pass buffer check ( >60s )
        AtlasCredentialCache.updateAtlasOAuthToken(orgId, 'token123', 120);
        const creds = AtlasCredentialCache.getAtlasCredentials(orgId)!;
        expect(creds.oauth?.accessToken).toBe('token123');
        expect(creds.oauth?.tokenExpiry).toBeGreaterThan(Date.now());
        expect(AtlasCredentialCache.isAtlasOAuthTokenValid(orgId)).toBe(true);
    });

    test('token validity false when missing token or expired', () => {
        AtlasCredentialCache.setAtlasOAuthCredentials(orgId, 'client', 'secret');
        expect(AtlasCredentialCache.isAtlasOAuthTokenValid(orgId)).toBe(false);
        AtlasCredentialCache.updateAtlasOAuthToken(orgId, 'token123', -1); // expired
        expect(AtlasCredentialCache.isAtlasOAuthTokenValid(orgId)).toBe(false);
    });

    test('clear credentials removes entry', () => {
        AtlasCredentialCache.setAtlasOAuthCredentials(orgId, 'client', 'secret');
        expect(AtlasCredentialCache.getAtlasCredentials(orgId)).toBeDefined();
        AtlasCredentialCache.clearAtlasCredentials(orgId);
        expect(AtlasCredentialCache.getAtlasCredentials(orgId)).toBeUndefined();
    });

    test('updateAtlasOAuthToken throws if oauth creds missing', () => {
        expect(() => AtlasCredentialCache.updateAtlasOAuthToken(orgId, 'tkn')).toThrow(/No Atlas OAuth credentials/);
    });
});
