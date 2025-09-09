/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OAuthAuthProvider } from '../auth/OAuthAuthProvider';
import { type AccessToken, type AuthRequest, type OAuthCredentials } from '../auth/types';

// Mock fetch globally
global.fetch = jest.fn();

describe('OAuthAuthProvider', () => {
    let provider: OAuthAuthProvider;
    const mockCredentials: OAuthCredentials = {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        tokenEndpoint: 'https://oauth.example.com/token',
        scope: 'test-scope',
    };

    const mockToken: AccessToken = {
        access_token: 'test-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        expires_at: Date.now() + 3600000,
    };

    beforeEach(() => {
        provider = new OAuthAuthProvider(mockCredentials);
        jest.clearAllMocks();
    });

    afterEach(() => {
        provider.clearCache();
    });

    describe('authenticateRequest', () => {
        it('should add Bearer token to request headers', async () => {
            // Mock successful token response
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => mockToken,
            });

            const request: AuthRequest = {
                method: 'GET',
                url: 'https://api.example.com/test',
                headers: { 'Custom-Header': 'value' },
            };

            const authenticatedRequest = await provider.authenticateRequest(request);

            expect(authenticatedRequest.headers['Authorization']).toBe('Bearer test-access-token');
            expect(authenticatedRequest.headers['Content-Type']).toBe('application/json');
            expect(authenticatedRequest.headers['Custom-Header']).toBe('value');
        });

        it('should preserve existing headers while adding auth', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => mockToken,
            });

            const request: AuthRequest = {
                method: 'POST',
                url: 'https://api.example.com/test',
                headers: {
                    'Accept': 'application/xml',
                    'X-Custom': 'test',
                },
            };

            const authenticatedRequest = await provider.authenticateRequest(request);

            expect(authenticatedRequest.headers['Authorization']).toBe('Bearer test-access-token');
            expect(authenticatedRequest.headers['Content-Type']).toBe('application/json');
            expect(authenticatedRequest.headers['Accept']).toBe('application/xml');
            expect(authenticatedRequest.headers['X-Custom']).toBe('test');
        });
    });

    describe('token retrieval and caching', () => {
        it('should retrieve and cache token on first request', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => mockToken,
            });

            const request: AuthRequest = {
                method: 'GET',
                url: 'https://api.example.com/test',
            };

            await provider.authenticateRequest(request);

            // Verify token was cached
            const cachedToken = provider.getCachedToken();
            expect(cachedToken).toBeDefined();
            expect(cachedToken!.access_token).toBe('test-access-token');

            // Verify fetch was called once
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        it('should reuse cached token for subsequent requests', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => mockToken,
            });

            const request: AuthRequest = {
                method: 'GET',
                url: 'https://api.example.com/test',
            };

            // First request
            await provider.authenticateRequest(request);
            
            // Second request
            await provider.authenticateRequest(request);

            // Verify fetch was called only once (token was cached)
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        it('should refresh token when cache indicates refresh needed', async () => {
            // Mock first token response (expires soon)
            const shortLivedToken: AccessToken = {
                access_token: 'short-lived-token',
                token_type: 'Bearer',
                expires_in: 30,
                expires_at: Date.now() + 30000, // 30 seconds
            };

            (fetch as jest.Mock)
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => shortLivedToken,
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => mockToken,
                });

            const request: AuthRequest = {
                method: 'GET',
                url: 'https://api.example.com/test',
            };

            // First request
            await provider.authenticateRequest(request);
            
            // Second request (should trigger refresh due to short expiry)
            await provider.authenticateRequest(request);

            // Verify fetch was called twice (initial + refresh)
            expect(fetch).toHaveBeenCalledTimes(2);
        });
    });

    describe('token request format', () => {
        it('should send correct OAuth request format', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => mockToken,
            });

            const request: AuthRequest = {
                method: 'GET',
                url: 'https://api.example.com/test',
            };

            await provider.authenticateRequest(request);

            expect(fetch).toHaveBeenCalledWith(
                mockCredentials.tokenEndpoint,
                expect.objectContaining({
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json',
                    },
                    body: 'grant_type=client_credentials&client_id=test-client-id&client_secret=test-client-secret&scope=test-scope',
                })
            );
        });

        it('should omit scope if not provided', async () => {
            const credentialsWithoutScope: OAuthCredentials = {
                clientId: 'test-client-id',
                clientSecret: 'test-client-secret',
                tokenEndpoint: 'https://oauth.example.com/token',
            };

            const providerWithoutScope = new OAuthAuthProvider(credentialsWithoutScope);

            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => mockToken,
            });

            const request: AuthRequest = {
                method: 'GET',
                url: 'https://api.example.com/test',
            };

            await providerWithoutScope.authenticateRequest(request);

            expect(fetch).toHaveBeenCalledWith(
                credentialsWithoutScope.tokenEndpoint,
                expect.objectContaining({
                    body: 'grant_type=client_credentials&client_id=test-client-id&client_secret=test-client-secret',
                })
            );
        });
    });

    describe('error handling', () => {
        it('should handle OAuth error responses', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                status: 400,
                json: async () => ({
                    error: 'invalid_client',
                    error_description: 'Client authentication failed',
                }),
            });

            const request: AuthRequest = {
                method: 'GET',
                url: 'https://api.example.com/test',
            };

            await expect(provider.authenticateRequest(request)).rejects.toThrow(
                /OAuth token retrieval failed.*Invalid client credentials/
            );
        });

        it('should handle network errors', async () => {
            (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

            const request: AuthRequest = {
                method: 'GET',
                url: 'https://api.example.com/test',
            };

            await expect(provider.authenticateRequest(request)).rejects.toThrow(
                /OAuth token retrieval failed.*Network error/
            );
        });

        it('should handle missing access_token in response', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ token_type: 'Bearer' }), // Missing access_token
            });

            const request: AuthRequest = {
                method: 'GET',
                url: 'https://api.example.com/test',
            };

            await expect(provider.authenticateRequest(request)).rejects.toThrow(
                /Invalid token response: missing access_token/
            );
        });

        it('should clear cache on authentication failure', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                status: 401,
                json: async () => ({ error: 'invalid_client' }),
            });

            const request: AuthRequest = {
                method: 'GET',
                url: 'https://api.example.com/test',
            };

            try {
                await provider.authenticateRequest(request);
            } catch {
                // Expected to fail
            }

            // Verify cache was cleared
            const cachedToken = provider.getCachedToken();
            expect(cachedToken).toBeUndefined();
        });
    });

    describe('validateCredentials', () => {
        it('should return true for valid credentials', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => mockToken,
            });

            const isValid = await provider.validateCredentials();
            expect(isValid).toBe(true);
        });

        it('should return false for invalid credentials', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: false,
                status: 401,
                json: async () => ({ error: 'invalid_client' }),
            });

            const isValid = await provider.validateCredentials();
            expect(isValid).toBe(false);
        });

        it('should return false on network error', async () => {
            (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

            const isValid = await provider.validateCredentials();
            expect(isValid).toBe(false);
        });
    });

    describe('clearCache', () => {
        it('should clear the token cache', async () => {
            (fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => mockToken,
            });

            // Get a token to populate cache
            const request: AuthRequest = {
                method: 'GET',
                url: 'https://api.example.com/test',
            };
            await provider.authenticateRequest(request);

            // Verify token is cached
            expect(provider.getCachedToken()).toBeDefined();

            // Clear cache
            provider.clearCache();

            // Verify cache is empty
            expect(provider.getCachedToken()).toBeUndefined();
        });
    });

    describe('getCacheStats', () => {
        it('should return cache statistics', async () => {
            const stats = provider.getCacheStats();
            expect(stats).toHaveProperty('size');
            expect(stats).toHaveProperty('keys');
            expect(typeof stats.size).toBe('number');
            expect(Array.isArray(stats.keys)).toBe(true);
        });
    });
});