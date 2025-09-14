/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { AtlasCredentialCache } from '../../src/plugins/service-mongo-atlas/utils/AtlasCredentialCache';

// Helper to access private store for cleanup without exposing implementation
function clear(orgId: string) {
    AtlasCredentialCache.clearAtlasCredentials(orgId);
}

suite('AtlasCredentialCache', () => {
    const orgId = 'OrgOne';
    const orgIdDifferentCase = 'orgone';

    teardown(() => {
        clear(orgId);
    });

    test('set and get OAuth credentials (case insensitive key)', () => {
        AtlasCredentialCache.setAtlasOAuthCredentials(orgId, 'clientId', 'clientSecret');
        const creds = AtlasCredentialCache.getAtlasCredentials(orgIdDifferentCase);
        assert.ok(creds, 'creds should be defined');
        assert.strictEqual(creds?.authType, 'oauth');
        assert.strictEqual(creds?.oauth?.clientId, 'clientId');
    });

    test('set and get Digest credentials', () => {
        AtlasCredentialCache.setAtlasDigestCredentials(orgId, 'public', 'private');
        const creds = AtlasCredentialCache.getAtlasCredentials(orgId);
        assert.strictEqual(creds?.authType, 'digest');
        assert.strictEqual(creds?.digest?.publicKey, 'public');
    });

    test('update token caches expiry and value', () => {
        AtlasCredentialCache.setAtlasOAuthCredentials(orgId, 'client', 'secret');
        // use a larger expiry to pass buffer check ( >60s )
        AtlasCredentialCache.updateAtlasOAuthToken(orgId, 'token123', 120);
        const creds = AtlasCredentialCache.getAtlasCredentials(orgId)!;
        assert.strictEqual(creds.oauth?.accessToken, 'token123');
        assert.ok((creds.oauth?.tokenExpiry ?? 0) > Date.now());
        assert.ok(AtlasCredentialCache.isAtlasOAuthTokenValid(orgId));
    });

    test('token validity false when missing token or expired', () => {
        AtlasCredentialCache.setAtlasOAuthCredentials(orgId, 'client', 'secret');
        assert.ok(!AtlasCredentialCache.isAtlasOAuthTokenValid(orgId));
        AtlasCredentialCache.updateAtlasOAuthToken(orgId, 'token123', -1); // expired
        assert.ok(!AtlasCredentialCache.isAtlasOAuthTokenValid(orgId));
    });

    test('clear credentials removes entry', () => {
        AtlasCredentialCache.setAtlasOAuthCredentials(orgId, 'client', 'secret');
        assert.ok(AtlasCredentialCache.getAtlasCredentials(orgId));
        AtlasCredentialCache.clearAtlasCredentials(orgId);
        assert.strictEqual(AtlasCredentialCache.getAtlasCredentials(orgId), undefined);
    });

    test('updateAtlasOAuthToken throws if oauth creds missing', () => {
        assert.throws(() => AtlasCredentialCache.updateAtlasOAuthToken(orgId, 'tkn'), /No Atlas OAuth credentials/);
    });
});
