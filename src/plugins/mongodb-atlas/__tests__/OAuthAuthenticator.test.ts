/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OAuthAuthenticator } from '../client/auth/OAuthAuthenticator';
import { type OAuthCredentials, AtlasAuthenticationError } from '../client/types';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('OAuthAuthenticator', () => {
    const credentials: OAuthCredentials = {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        scopes: ['openid', 'read:projects'],
    };

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    describe('getAccessToken', () => {
        test('should obtain access token on first call', async () => {
            const authenticator = new OAuthAuthenticator(credentials);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    access_token: 'test-access-token',
                    token_type: 'Bearer',
                    expires_in: 3600,
                    scope: 'openid read:projects',
                }),
            });

            const token = await authenticator.getAccessToken();

            expect(token).toBe('test-access-token');
            expect(mockFetch).toHaveBeenCalledWith(
                'https://cloud.mongodb.com/api/oauth/token',
                expect.objectContaining({
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json',
                    },
                    body: 'grant_type=client_credentials&client_id=test-client-id&client_secret=test-client-secret&scope=openid+read%3Aprojects',
                }),
            );
        });

        test('should reuse cached token if valid', async () => {
            const authenticator = new OAuthAuthenticator(credentials);

            // First call - should fetch token
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    access_token: 'test-access-token',
                    token_type: 'Bearer',
                    expires_in: 3600,
                }),
            });

            const token1 = await authenticator.getAccessToken();
            const token2 = await authenticator.getAccessToken();

            expect(token1).toBe('test-access-token');
            expect(token2).toBe('test-access-token');
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        test('should refresh token when expired', async () => {
            jest.useFakeTimers();
            const authenticator = new OAuthAuthenticator(credentials);

            // First token request
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    access_token: 'first-token',
                    token_type: 'Bearer',
                    expires_in: 60, // 1 minute
                }),
            });

            const token1 = await authenticator.getAccessToken();
            expect(token1).toBe('first-token');

            // Advance time to expire the token (+ buffer)
            jest.advanceTimersByTime(61000);

            // Second token request after expiry
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    access_token: 'second-token',
                    token_type: 'Bearer',
                    expires_in: 3600,
                }),
            });

            const token2 = await authenticator.getAccessToken();
            expect(token2).toBe('second-token');
            expect(mockFetch).toHaveBeenCalledTimes(2);

            jest.useRealTimers();
        });

        test('should handle OAuth errors', async () => {
            const authenticator = new OAuthAuthenticator(credentials);

            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 400,
                statusText: 'Bad Request',
                json: async () => ({
                    error: 'invalid_client',
                    error_description: 'Client authentication failed',
                }),
            });

            await expect(authenticator.getAccessToken()).rejects.toThrow(AtlasAuthenticationError);
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        test('should handle network errors', async () => {
            const authenticator = new OAuthAuthenticator(credentials);

            mockFetch.mockRejectedValueOnce(new Error('Network error'));

            await expect(authenticator.getAccessToken()).rejects.toThrow(AtlasAuthenticationError);
        });

        test('should handle credentials without scopes', async () => {
            const credentialsNoScopes: OAuthCredentials = {
                clientId: 'test-client-id',
                clientSecret: 'test-client-secret',
            };

            const authenticator = new OAuthAuthenticator(credentialsNoScopes);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    access_token: 'test-access-token',
                    token_type: 'Bearer',
                    expires_in: 3600,
                }),
            });

            await authenticator.getAccessToken();

            expect(mockFetch).toHaveBeenCalledWith(
                'https://cloud.mongodb.com/api/oauth/token',
                expect.objectContaining({
                    body: 'grant_type=client_credentials&client_id=test-client-id&client_secret=test-client-secret',
                }),
            );
        });
    });

    describe('addAuthHeaders', () => {
        test('should add Bearer authorization header', async () => {
            const authenticator = new OAuthAuthenticator(credentials);

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    access_token: 'test-access-token',
                    token_type: 'Bearer',
                    expires_in: 3600,
                }),
            });

            const headers = { 'Content-Type': 'application/json' };
            const result = await authenticator.addAuthHeaders(headers);

            expect(result).toEqual({
                'Content-Type': 'application/json',
                'Authorization': 'Bearer test-access-token',
            });
        });
    });

    describe('clearToken', () => {
        test('should clear cached token', async () => {
            const authenticator = new OAuthAuthenticator(credentials);

            // First token request
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    access_token: 'first-token',
                    token_type: 'Bearer',
                    expires_in: 3600,
                }),
            });

            await authenticator.getAccessToken();
            expect(mockFetch).toHaveBeenCalledTimes(1);

            // Clear token
            authenticator.clearToken();

            // Second token request should fetch new token
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    access_token: 'second-token',
                    token_type: 'Bearer',
                    expires_in: 3600,
                }),
            });

            const token = await authenticator.getAccessToken();
            expect(token).toBe('second-token');
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });
    });
});