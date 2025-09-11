/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CredentialCache } from '../../../documentdb/CredentialCache';
import { AtlasAuthManager } from './AtlasAuthManager';

describe('AtlasAuthManager', () => {
    const testClusterId = 'test-atlas-cluster';
    const testClientId = 'test-client-id';
    const testClientSecret = 'test-client-secret';
    const testPublicKey = 'test-public-key';
    const testPrivateKey = 'test-private-key';

    beforeEach(() => {
        // Clear any existing credentials
        CredentialCache.clearAtlasCredentials(testClusterId);
    });

    afterEach(() => {
        // Clean up after each test
        CredentialCache.clearAtlasCredentials(testClusterId);
        delete (global as any).fetch; // Clean up mocked fetch
    });

    describe('OAuth 2.0 Authentication', () => {
        beforeEach(() => {
            CredentialCache.setAtlasOAuthCredentials(testClusterId, testClientId, testClientSecret);
        });

        test('should create correct Basic Auth header for OAuth', () => {
            const authHeader = AtlasAuthManager.getOAuthBasicAuthHeader(testClientId, testClientSecret);
            
            // Base64 encode expected credentials
            const expectedCredentials = Buffer.from(`${testClientId}:${testClientSecret}`, 'utf8').toString('base64');
            expect(authHeader).toBe(`Basic ${expectedCredentials}`);
        });

        test('should request OAuth token with correct parameters', async () => {
            const mockResponse = {
                ok: true,
                json: async () => ({
                    access_token: 'test-access-token',
                    expires_in: 3600,
                    token_type: 'Bearer',
                }),
            };

            const originalFetch = global.fetch;
            (global as any).fetch = jest.fn(async (url: string, options: any) => {
                expect(url).toBe('https://cloud.mongodb.com/api/oauth/token');
                expect(options.method).toBe('POST');
                expect(options.headers['Accept']).toBe('application/json');
                expect(options.headers['Cache-Control']).toBe('no-cache');
                expect(options.headers['Authorization']).toMatch(/^Basic /);
                expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
                expect(options.body).toBe('grant_type=client_credentials');
                return mockResponse;
            });

            try {
                const tokenResponse = await AtlasAuthManager.requestOAuthToken(testClientId, testClientSecret);
                expect(tokenResponse.access_token).toBe('test-access-token');
                expect(tokenResponse.expires_in).toBe(3600);
            } finally {
                global.fetch = originalFetch;
            }
        });

        test('should handle OAuth token request failure', async () => {
            const mockResponse = {
                ok: false,
                status: 401,
                text: async () => 'Unauthorized',
            };

            const originalFetch = global.fetch;
            (global as any).fetch = jest.fn(async () => mockResponse);

            try {
                await expect(
                    AtlasAuthManager.requestOAuthToken(testClientId, testClientSecret)
                ).rejects.toThrow(/Failed to obtain OAuth token: 401 Unauthorized/);
            } finally {
                global.fetch = originalFetch;
            }
        });

        test('should return Bearer token for valid OAuth credentials', async () => {
            const mockResponse = {
                ok: true,
                json: async () => ({
                    access_token: 'test-access-token',
                    expires_in: 3600,
                    token_type: 'Bearer',
                }),
            };

            const originalFetch = global.fetch;
            (global as any).fetch = jest.fn(async () => mockResponse);

            try {
                const authHeader = await AtlasAuthManager.getAuthorizationHeader(testClusterId);
                expect(authHeader).toBe('Bearer test-access-token');
            } finally {
                global.fetch = originalFetch;
            }
        });

        test('should reuse cached token when still valid', async () => {
            // First, cache a token
            CredentialCache.updateAtlasOAuthToken(testClusterId, 'cached-token', 3600);
            
            const fetchMock = jest.fn();
            const originalFetch = global.fetch;
            (global as any).fetch = fetchMock;

            try {
                const authHeader = await AtlasAuthManager.getAuthorizationHeader(testClusterId);
                expect(authHeader).toBe('Bearer cached-token');
                expect(fetchMock).not.toHaveBeenCalled();
            } finally {
                global.fetch = originalFetch;
            }
        });

        test('should refresh expired token', async () => {
            // Cache an expired token (set expiry to past)
            CredentialCache.updateAtlasOAuthToken(testClusterId, 'expired-token', -1000);
            
            const mockResponse = {
                ok: true,
                json: async () => ({
                    access_token: 'new-access-token',
                    expires_in: 3600,
                    token_type: 'Bearer',
                }),
            };

            const fetchMock = jest.fn(async () => mockResponse);
            const originalFetch = global.fetch;
            (global as any).fetch = fetchMock;

            try {
                const authHeader = await AtlasAuthManager.getAuthorizationHeader(testClusterId);
                expect(authHeader).toBe('Bearer new-access-token');
                expect(fetchMock).toHaveBeenCalledTimes(1);
            } finally {
                global.fetch = originalFetch;
            }
        });
    });

    describe('HTTP Digest Authentication', () => {
        beforeEach(() => {
            CredentialCache.setAtlasDigestCredentials(testClusterId, testPublicKey, testPrivateKey);
        });

        test('should return digest credentials for digest auth', async () => {
            const authHeader = await AtlasAuthManager.getAuthorizationHeader(testClusterId);
            expect(authHeader).toBe(`Digest:${testPublicKey}:${testPrivateKey}`);
        });

        test('should create Atlas headers with digest auth information', async () => {
            const headers = await AtlasAuthManager.createAtlasHeaders(testClusterId);
            
            expect(headers['Content-Type']).toBe('application/json');
            expect(headers['Accept']).toBe('application/vnd.atlas.2023-02-01+json');
            expect(headers['X-Atlas-Digest-Auth']).toBe(`${testPublicKey}:${testPrivateKey}`);
        });
    });

    describe('Credential Management', () => {
        test('should return undefined for non-existent credentials', async () => {
            const authHeader = await AtlasAuthManager.getAuthorizationHeader('non-existent-cluster');
            expect(authHeader).toBeUndefined();
        });

        test('should clear credentials successfully', () => {
            CredentialCache.setAtlasOAuthCredentials(testClusterId, testClientId, testClientSecret);
            
            expect(CredentialCache.getAtlasCredentials(testClusterId)).toBeDefined();
            
            AtlasAuthManager.clearAuthentication(testClusterId);
            
            expect(CredentialCache.getAtlasCredentials(testClusterId)).toBeUndefined();
        });

        test('should throw error for unsupported auth type', async () => {
            // Create credentials with invalid auth type by setting them directly
            CredentialCache.setAtlasOAuthCredentials(testClusterId, testClientId, testClientSecret);
            const credentials = CredentialCache.getCredentials(testClusterId);
            if (credentials && credentials.atlasCredentials) {
                credentials.atlasCredentials.authType = 'invalid' as any;
            }

            await expect(
                AtlasAuthManager.getAuthorizationHeader(testClusterId)
            ).rejects.toThrow(/Unsupported Atlas authentication type: invalid/);
        });
    });

    describe('Token Expiry Logic', () => {
        test('should correctly identify valid tokens', () => {
            CredentialCache.setAtlasOAuthCredentials(testClusterId, testClientId, testClientSecret);
            CredentialCache.updateAtlasOAuthToken(testClusterId, 'test-token', 3600);
            
            expect(CredentialCache.isAtlasOAuthTokenValid(testClusterId)).toBe(true);
        });

        test('should correctly identify expired tokens', () => {
            CredentialCache.setAtlasOAuthCredentials(testClusterId, testClientId, testClientSecret);
            CredentialCache.updateAtlasOAuthToken(testClusterId, 'test-token', -1000);
            
            expect(CredentialCache.isAtlasOAuthTokenValid(testClusterId)).toBe(false);
        });

        test('should return false for missing token', () => {
            CredentialCache.setAtlasOAuthCredentials(testClusterId, testClientId, testClientSecret);
            
            expect(CredentialCache.isAtlasOAuthTokenValid(testClusterId)).toBe(false);
        });
    });
});