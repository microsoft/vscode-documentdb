/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthProvider } from './AuthProvider';
import { TokenCache } from './TokenCache';
import { type AccessToken, type AuthRequest, type AuthenticatedRequest, type OAuthCredentials } from './types';

/**
 * OAuth 2.0 Client Credentials authentication provider for MongoDB Atlas.
 * Implements automatic token retrieval, caching, and refresh.
 */
export class OAuthAuthProvider extends AuthProvider {
    private readonly tokenCache = new TokenCache();
    private readonly cacheKey: string;

    constructor(private readonly credentials: OAuthCredentials) {
        super();
        this.cacheKey = `oauth:${credentials.clientId}`;
    }

    /**
     * Authenticates a request using OAuth 2.0 Bearer token.
     */
    async authenticateRequest(request: AuthRequest): Promise<AuthenticatedRequest> {
        const token = await this.getValidToken();
        
        return {
            ...request,
            headers: {
                ...request.headers,
                'Authorization': `${token.token_type} ${token.access_token}`,
                'Content-Type': 'application/json',
            },
        };
    }

    /**
     * Validates credentials by attempting to retrieve a token.
     */
    async validateCredentials(): Promise<boolean> {
        try {
            await this.getValidToken();
            return true;
        } catch (error) {
            // Log error for debugging but don't expose sensitive information
            console.error('OAuth credential validation failed:', (error as Error).message);
            return false;
        }
    }

    /**
     * Clears the token cache.
     */
    clearCache(): void {
        this.tokenCache.clear();
    }

    /**
     * Gets a valid access token, refreshing if necessary.
     */
    private async getValidToken(): Promise<AccessToken> {
        // Try to get cached token first
        let token = this.tokenCache.getToken(this.cacheKey);
        
        // Refresh token if it's expired or close to expiry
        if (!token || this.tokenCache.shouldRefreshToken(this.cacheKey)) {
            token = await this.refreshToken();
        }

        return token;
    }

    /**
     * Retrieves a new access token from the OAuth endpoint.
     */
    private async refreshToken(): Promise<AccessToken> {
        const requestBody = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.credentials.clientId,
            client_secret: this.credentials.clientSecret,
        });

        // Add scope if specified
        if (this.credentials.scope) {
            requestBody.append('scope', this.credentials.scope);
        }

        const requestOptions: RequestInit = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
            },
            body: requestBody.toString(),
        };

        try {
            const response = await fetch(
                this.credentials.tokenEndpoint,
                requestOptions,
            );

            if (!response.ok) {
                const error = await this.createOAuthError(response);
                throw error;
            }

            const tokenData = await response.json() as AccessToken;
            
            // Validate token response
            if (!tokenData.access_token) {
                throw new Error('Invalid token response: missing access_token');
            }

            // Set token type to Bearer if not specified
            if (!tokenData.token_type) {
                tokenData.token_type = 'Bearer';
            }

            // Calculate expiry timestamp
            if (tokenData.expires_in) {
                tokenData.expires_at = Date.now() + (tokenData.expires_in * 1000);
            }

            // Cache the token
            this.tokenCache.setToken(this.cacheKey, tokenData);

            return tokenData;
        } catch (error) {
            // Clear any cached token on error
            this.tokenCache.removeToken(this.cacheKey);
            
            if (error instanceof Error) {
                throw new Error(`OAuth token retrieval failed: ${error.message}`);
            }
            
            throw new Error('OAuth token retrieval failed: Unknown error');
        }
    }

    /**
     * Creates a detailed error from an OAuth response.
     */
    private async createOAuthError(response: Response): Promise<Error> {
        let errorDetails: string;
        
        try {
            const errorBody: { error?: string; error_description?: string } = await response.json() as { error?: string; error_description?: string };
            
            // Handle OAuth 2.0 error response format
            if (errorBody.error) {
                errorDetails = errorBody.error;
                if (errorBody.error_description) {
                    errorDetails += `: ${errorBody.error_description}`;
                }
            } else {
                errorDetails = JSON.stringify(errorBody);
            }
        } catch {
            errorDetails = await response.text() || response.statusText;
        }

        const message = this.createUserFriendlyOAuthErrorMessage(response.status, errorDetails);
        return new Error(message);
    }

    /**
     * Creates user-friendly error messages for OAuth failures.
     */
    private createUserFriendlyOAuthErrorMessage(status: number, details: string): string {
        switch (status) {
            case 400:
                if (details.includes('invalid_client')) {
                    return 'Invalid client credentials. Please check your Client ID and Client Secret.';
                }
                if (details.includes('invalid_grant')) {
                    return 'Invalid grant type or credentials. Please verify your OAuth configuration.';
                }
                if (details.includes('invalid_scope')) {
                    return 'Invalid scope requested. Please check the required permissions.';
                }
                return `Bad request: ${details}`;
            
            case 401:
                return 'Authentication failed. Please verify your Client ID and Client Secret.';
            
            case 403:
                return 'Access denied. Your client may not have permission to access this resource.';
            
            case 429:
                return 'Too many token requests. Please wait before trying again.';
            
            case 500:
            case 502:
            case 503:
            case 504:
                return 'OAuth server error. Please try again later.';
            
            default:
                return `OAuth authentication failed (${status}): ${details}`;
        }
    }

    /**
     * Gets the current cached token for testing purposes.
     */
    getCachedToken(): AccessToken | undefined {
        return this.tokenCache.getToken(this.cacheKey);
    }

    /**
     * Gets token cache statistics for monitoring/debugging.
     */
    getCacheStats(): { size: number; keys: string[] } {
        return {
            size: this.tokenCache.size(),
            keys: this.tokenCache.getKeys(),
        };
    }
}