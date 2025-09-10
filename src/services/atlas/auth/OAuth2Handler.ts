/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { nonNullValue } from '../../../utils/nonNull';
import { type AtlasAuthConfig, DEFAULT_ATLAS_AUTH_CONFIG } from '../types/AtlasAuthConfig';
import { type AtlasAuthHeader, type AtlasAuthResult, type TokenRefreshResult } from '../types/AtlasAuthResult';
import { type AtlasOAuth2Credentials, type AtlasOAuth2Token } from '../types/AtlasCredentials';

/**
 * Handles OAuth 2.0 Client Credentials flow for MongoDB Atlas API authentication.
 * 
 * This handler manages token acquisition, caching, and automatic refresh for
 * OAuth 2.0 authentication with the MongoDB Atlas Management API.
 */
export class OAuth2Handler {
    private tokenCache: AtlasOAuth2Token | undefined;
    private readonly config: Required<AtlasAuthConfig>;

    constructor(config: AtlasAuthConfig = {}) {
        this.config = { ...DEFAULT_ATLAS_AUTH_CONFIG, ...config };
    }

    /**
     * Authenticates using OAuth 2.0 Client Credentials and returns auth header
     * @param credentials OAuth 2.0 credentials
     * @returns Authentication result with header or error
     */
    async authenticate(credentials: AtlasOAuth2Credentials): Promise<AtlasAuthResult> {
        try {
            // Check if we have a valid cached token
            if (this.tokenCache && this.isTokenValid(this.tokenCache)) {
                return {
                    success: true,
                    authHeader: this.createAuthHeader(this.tokenCache.accessToken),
                };
            }

            // Attempt to refresh if we have an expired token and auto-refresh is enabled
            if (this.tokenCache && this.config.autoRefreshToken) {
                const refreshResult = await this.refreshToken(credentials);
                if (refreshResult.success && refreshResult.newToken) {
                    return {
                        success: true,
                        authHeader: this.createAuthHeader(refreshResult.newToken),
                    };
                }
            }

            // Acquire a new token
            const token = await this.acquireToken(credentials);
            this.tokenCache = token;

            return {
                success: true,
                authHeader: this.createAuthHeader(token.accessToken),
            };
        } catch (error) {
            return {
                success: false,
                error: l10n.t('OAuth2 authentication failed: {0}', (error as Error).message),
                requiresReauthentication: true,
            };
        }
    }

    /**
     * Clears the cached token, forcing re-authentication on next request
     */
    clearToken(): void {
        this.tokenCache = undefined;
    }

    /**
     * Checks if the current cached token is valid and not expired
     * @returns True if token is valid, false otherwise
     */
    hasValidToken(): boolean {
        return this.tokenCache !== undefined && this.isTokenValid(this.tokenCache);
    }

    /**
     * Gets the current token expiry time
     * @returns Token expiry date or undefined if no token
     */
    getTokenExpiry(): Date | undefined {
        return this.tokenCache?.expiresAt;
    }

    /**
     * Manually refreshes the token using stored credentials
     * @param credentials OAuth 2.0 credentials for refresh
     * @returns Token refresh result
     */
    async refreshToken(credentials: AtlasOAuth2Credentials): Promise<TokenRefreshResult> {
        try {
            const token = await this.acquireToken(credentials);
            this.tokenCache = token;

            return {
                success: true,
                newToken: token.accessToken,
                expiresAt: token.expiresAt,
            };
        } catch (error) {
            return {
                success: false,
                error: l10n.t('Token refresh failed: {0}', (error as Error).message),
            };
        }
    }

    /**
     * Acquires a new access token using OAuth 2.0 Client Credentials flow
     */
    private async acquireToken(credentials: AtlasOAuth2Credentials): Promise<AtlasOAuth2Token> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

        try {
            const response = await fetch(this.config.tokenEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify({
                    username: credentials.clientId,
                    password: credentials.clientSecret,
                }),
                signal: controller.signal,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                    l10n.t('Token request failed with status {0}: {1}', response.status, errorText)
                );
            }

            const tokenData = await response.json() as unknown;
            return this.parseTokenResponse(tokenData);
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error(l10n.t('Token request timed out after {0}ms', this.config.timeoutMs));
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Parses the OAuth 2.0 token response from the Atlas API
     */
    private parseTokenResponse(tokenData: unknown): AtlasOAuth2Token {
        const data = nonNullValue(tokenData, 'tokenData', 'OAuth2Handler.ts');

        if (typeof data !== 'object') {
            throw new Error(l10n.t('Invalid token response format'));
        }

        const tokenObj = data as Record<string, unknown>;

        const accessToken = tokenObj.access_token;
        if (typeof accessToken !== 'string') {
            throw new Error(l10n.t('Missing or invalid access_token in response'));
        }

        const tokenType = (tokenObj.token_type as string) || 'Bearer';
        const expiresIn = (tokenObj.expires_in as number) || 3600; // Default 1 hour

        return {
            accessToken,
            tokenType,
            expiresIn,
            expiresAt: new Date(Date.now() + expiresIn * 1000),
        };
    }

    /**
     * Checks if a token is still valid (not expired with buffer)
     */
    private isTokenValid(token: AtlasOAuth2Token): boolean {
        const now = new Date();
        const expiryWithBuffer = new Date(
            token.expiresAt.getTime() - this.config.refreshThresholdSeconds * 1000
        );
        return now < expiryWithBuffer;
    }

    /**
     * Creates an Authorization header from an access token
     */
    private createAuthHeader(accessToken: string): AtlasAuthHeader {
        return {
            Authorization: `Bearer ${accessToken}`,
        };
    }
}