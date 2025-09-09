/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TokenCache } from '../auth/TokenCache';
import { type AccessToken } from '../auth/types';

describe('TokenCache', () => {
    let tokenCache: TokenCache;
    const testKey = 'test-key';
    const mockToken: AccessToken = {
        access_token: 'test-token',
        token_type: 'Bearer',
        expires_in: 3600,
        expires_at: Date.now() + 3600000, // 1 hour from now
    };

    beforeEach(() => {
        tokenCache = new TokenCache();
    });

    describe('setToken and getToken', () => {
        it('should store and retrieve a token', () => {
            tokenCache.setToken(testKey, mockToken);
            const retrieved = tokenCache.getToken(testKey);
            
            expect(retrieved).toEqual(mockToken);
        });

        it('should return undefined for non-existent token', () => {
            const retrieved = tokenCache.getToken('non-existent');
            expect(retrieved).toBeUndefined();
        });

        it('should calculate expires_at if not provided', () => {
            const tokenWithoutExpiresAt: AccessToken = {
                access_token: 'test-token',
                token_type: 'Bearer',
                expires_in: 3600,
                expires_at: 0, // Will be calculated
            };

            const beforeTime = Date.now();
            tokenCache.setToken(testKey, tokenWithoutExpiresAt);
            const retrieved = tokenCache.getToken(testKey);
            const afterTime = Date.now();

            expect(retrieved).toBeDefined();
            expect(retrieved!.expires_at).toBeGreaterThanOrEqual(beforeTime + 3600000);
            expect(retrieved!.expires_at).toBeLessThanOrEqual(afterTime + 3600000);
        });

        it('should return a copy of the token, not the original', () => {
            tokenCache.setToken(testKey, mockToken);
            const retrieved = tokenCache.getToken(testKey);
            
            expect(retrieved).not.toBe(mockToken);
            expect(retrieved).toEqual(mockToken);
        });
    });

    describe('expired token handling', () => {
        it('should remove and not return expired tokens', () => {
            const expiredToken: AccessToken = {
                access_token: 'expired-token',
                token_type: 'Bearer',
                expires_in: 3600,
                expires_at: Date.now() - 1000, // Expired 1 second ago
            };

            tokenCache.setToken(testKey, expiredToken);
            const retrieved = tokenCache.getToken(testKey);
            
            expect(retrieved).toBeUndefined();
            expect(tokenCache.size()).toBe(0);
        });

        it('should handle tokens without expires_at as non-expired', () => {
            const tokenWithoutExpiry: AccessToken = {
                access_token: 'no-expiry-token',
                token_type: 'Bearer',
                expires_in: 3600,
                expires_at: 0,
            };

            tokenCache.setToken(testKey, tokenWithoutExpiry);
            const retrieved = tokenCache.getToken(testKey);
            
            expect(retrieved).toBeDefined();
            expect(retrieved!.access_token).toBe('no-expiry-token');
        });
    });

    describe('shouldRefreshToken', () => {
        it('should return true for non-existent token', () => {
            expect(tokenCache.shouldRefreshToken('non-existent')).toBe(true);
        });

        it('should return true for token close to expiry', () => {
            const soonToExpireToken: AccessToken = {
                access_token: 'soon-to-expire',
                token_type: 'Bearer',
                expires_in: 30,
                expires_at: Date.now() + 30000, // 30 seconds from now
            };

            tokenCache.setToken(testKey, soonToExpireToken);
            expect(tokenCache.shouldRefreshToken(testKey)).toBe(true);
        });

        it('should return false for token with plenty of time left', () => {
            const freshToken: AccessToken = {
                access_token: 'fresh-token',
                token_type: 'Bearer',
                expires_in: 3600,
                expires_at: Date.now() + 3600000, // 1 hour from now
            };

            tokenCache.setToken(testKey, freshToken);
            expect(tokenCache.shouldRefreshToken(testKey)).toBe(false);
        });

        it('should return true for token without expires_at', () => {
            const tokenWithoutExpiry: AccessToken = {
                access_token: 'no-expiry',
                token_type: 'Bearer',
                expires_in: 3600,
                expires_at: 0, // This will get overwritten by setToken
            };

            // Manually set the token to bypass the calculation
            const cache = tokenCache as any;
            cache.cache.set(testKey, {
                ...tokenWithoutExpiry,
                expires_at: 0, // Keep it as 0 to test the logic
            });

            // Token without expires_at should be treated as should refresh (since we can't determine expiry)
            expect(tokenCache.shouldRefreshToken(testKey)).toBe(true);
        });
    });

    describe('removeToken', () => {
        it('should remove a token from cache', () => {
            tokenCache.setToken(testKey, mockToken);
            expect(tokenCache.getToken(testKey)).toBeDefined();
            
            tokenCache.removeToken(testKey);
            expect(tokenCache.getToken(testKey)).toBeUndefined();
            expect(tokenCache.size()).toBe(0);
        });

        it('should not throw when removing non-existent token', () => {
            expect(() => tokenCache.removeToken('non-existent')).not.toThrow();
        });
    });

    describe('clear', () => {
        it('should clear all tokens from cache', () => {
            tokenCache.setToken('key1', mockToken);
            tokenCache.setToken('key2', mockToken);
            expect(tokenCache.size()).toBe(2);
            
            tokenCache.clear();
            expect(tokenCache.size()).toBe(0);
            expect(tokenCache.getToken('key1')).toBeUndefined();
            expect(tokenCache.getToken('key2')).toBeUndefined();
        });
    });

    describe('size', () => {
        it('should return correct cache size', () => {
            expect(tokenCache.size()).toBe(0);
            
            tokenCache.setToken('key1', mockToken);
            expect(tokenCache.size()).toBe(1);
            
            tokenCache.setToken('key2', mockToken);
            expect(tokenCache.size()).toBe(2);
            
            tokenCache.removeToken('key1');
            expect(tokenCache.size()).toBe(1);
        });
    });

    describe('getKeys', () => {
        it('should return all cached token keys', () => {
            expect(tokenCache.getKeys()).toEqual([]);
            
            tokenCache.setToken('key1', mockToken);
            tokenCache.setToken('key2', mockToken);
            
            const keys = tokenCache.getKeys();
            expect(keys).toHaveLength(2);
            expect(keys).toContain('key1');
            expect(keys).toContain('key2');
        });
    });
});