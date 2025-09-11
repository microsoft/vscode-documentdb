/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type AtlasCredentials, AtlasCredentialCache } from './AtlasCredentialCache';

/**
 * Response from Atlas OAuth token request
 */
export interface AtlasOAuthTokenResponse {
    access_token: string;
    expires_in: number;
    token_type: string;
}

/**
 * Atlas authentication manager that handles both OAuth 2.0 and HTTP Digest authentication
 * for MongoDB Atlas Service Discovery API requests.
 */
export class AtlasAuthManager {
    private static readonly ATLAS_OAUTH_TOKEN_URL = 'https://cloud.mongodb.com/api/oauth/token';

    /**
     * Creates an authorization header for Atlas API requests.
     * Handles both OAuth 2.0 Bearer tokens and HTTP Digest authentication.
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @returns Authorization header value or undefined if no valid credentials
     */
    public static async getAuthorizationHeader(orgId: string): Promise<string | undefined> {
        const credentials = AtlasCredentialCache.getAtlasCredentials(orgId);
        if (!credentials) {
            return undefined;
        }

        switch (credentials.authType) {
            case 'oauth':
                return await this.getOAuthAuthorizationHeader(orgId, credentials);
            // Don't need to set the digest header here as it is handled by the HTTP client directly
            default:
                throw new Error(l10n.t('Unsupported Atlas authentication type: {0}', credentials.authType));
        }
    }

    /**
     * Gets Basic Authorization header for OAuth client credentials.
     * Used for requesting access tokens from the OAuth endpoint.
     *
     * @param clientId - OAuth client ID
     * @param clientSecret - OAuth client secret
     * @returns Base64 encoded Basic auth header value
     */
    public static getOAuthBasicAuthHeader(clientId: string, clientSecret: string): string {
        const credentials = `${clientId}:${clientSecret}`;
        const base64Credentials = Buffer.from(credentials, 'utf8').toString('base64');
        return `Basic ${base64Credentials}`;
    }

    /**
     * Requests a new OAuth access token from MongoDB Atlas.
     *
     * @param clientId - OAuth client ID
     * @param clientSecret - OAuth client secret
     * @returns Promise resolving to token response
     */
    public static async requestOAuthToken(clientId: string, clientSecret: string): Promise<AtlasOAuthTokenResponse> {
        const authHeader = this.getOAuthBasicAuthHeader(clientId, clientSecret);

        const response = await fetch(this.ATLAS_OAUTH_TOKEN_URL, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Cache-Control': 'no-cache',
                Authorization: authHeader,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'grant_type=client_credentials',
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(l10n.t('Failed to obtain OAuth token: {0} {1}', response.status.toString(), errorText));
        }

        return response.json() as Promise<AtlasOAuthTokenResponse>;
    }

    /**
     * Clears Atlas authentication state for the given organization.
     *
     * @param orgId - The organization id for the Atlas credential instance
     */
    public static clearAuthentication(orgId: string): void {
        AtlasCredentialCache.clearAtlasCredentials(orgId);
    }

    /**
     * Gets or refreshes OAuth authorization header.
     * Automatically handles token expiry and renewal.
     */
    private static async getOAuthAuthorizationHeader(orgId: string, credentials: AtlasCredentials): Promise<string> {
        if (!credentials.oauth) {
            throw new Error(l10n.t('OAuth credentials not found for organization {0}', orgId));
        }

        const { clientId, clientSecret } = credentials.oauth;

        // Check if we have a valid cached token
        if (AtlasCredentialCache.isAtlasOAuthTokenValid(orgId)) {
            const cachedToken = credentials.oauth.accessToken;
            if (cachedToken) {
                return `Bearer ${cachedToken}`;
            }
        }

        // Request new token
        const tokenResponse = await this.requestOAuthToken(clientId, clientSecret);

        // Update cache
        AtlasCredentialCache.updateAtlasOAuthToken(orgId, tokenResponse.access_token, tokenResponse.expires_in);

        return `Bearer ${tokenResponse.access_token}`;
    }
}
