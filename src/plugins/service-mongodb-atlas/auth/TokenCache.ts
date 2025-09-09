/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AccessToken } from './types';

/**
 * In-memory cache for OAuth access tokens with automatic expiry management.
 * Provides thread-safe operations for token storage and retrieval.
 */
export class TokenCache {
    private static readonly EXPIRY_BUFFER_SECONDS = 60; // Refresh 1 minute before expiry
    private readonly cache = new Map<string, AccessToken>();

    /**
     * Stores an access token in the cache.
     * 
     * @param key Unique identifier for the token (e.g., client_id or user identifier)
     * @param token The access token to store
     */
    setToken(key: string, token: AccessToken): void {
        // Calculate absolute expiry time if not already set
        if (!token.expires_at && token.expires_in) {
            token.expires_at = Date.now() + (token.expires_in * 1000);
        }
        
        this.cache.set(key, { ...token });
    }

    /**
     * Retrieves a valid access token from the cache.
     * 
     * @param key Unique identifier for the token
     * @returns The access token if valid and not expired, undefined otherwise
     */
    getToken(key: string): AccessToken | undefined {
        const token = this.cache.get(key);
        if (!token) {
            return undefined;
        }

        if (this.isTokenExpired(token)) {
            this.cache.delete(key);
            return undefined;
        }

        return { ...token };
    }

    /**
     * Checks if a token needs to be refreshed (close to expiry).
     * 
     * @param key Unique identifier for the token
     * @returns True if the token should be refreshed, false otherwise
     */
    shouldRefreshToken(key: string): boolean {
        const token = this.cache.get(key);
        if (!token || !token.expires_at) {
            return true;
        }

        const bufferTime = TokenCache.EXPIRY_BUFFER_SECONDS * 1000;
        return Date.now() >= (token.expires_at - bufferTime);
    }

    /**
     * Removes a token from the cache.
     * 
     * @param key Unique identifier for the token
     */
    removeToken(key: string): void {
        this.cache.delete(key);
    }

    /**
     * Clears all tokens from the cache.
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Gets the count of cached tokens.
     * 
     * @returns Number of tokens currently in cache
     */
    size(): number {
        return this.cache.size;
    }

    /**
     * Checks if a token is expired.
     * 
     * @param token The token to check
     * @returns True if the token is expired, false otherwise
     */
    private isTokenExpired(token: AccessToken): boolean {
        if (!token.expires_at) {
            return false; // Treat tokens without expiry as non-expired
        }
        
        return Date.now() >= token.expires_at;
    }

    /**
     * Gets all cached token keys (for testing/debugging).
     * 
     * @returns Array of cached token keys
     */
    getKeys(): string[] {
        return Array.from(this.cache.keys());
    }
}