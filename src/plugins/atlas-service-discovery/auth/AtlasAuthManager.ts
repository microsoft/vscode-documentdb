/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { CredentialCache, type AtlasCredentials } from '../../../documentdb/CredentialCache';

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
     * @param mongoClusterId - The credential id for the Atlas instance
     * @returns Authorization header value or undefined if no valid credentials
     */
    public static async getAuthorizationHeader(mongoClusterId: string): Promise<string | undefined> {
        const credentials = CredentialCache.getAtlasCredentials(mongoClusterId);
        if (!credentials) {
            return undefined;
        }

        switch (credentials.authType) {
            case 'oauth':
                return await this.getOAuthAuthorizationHeader(mongoClusterId, credentials);
            case 'digest':
                return this.getDigestAuthorizationHeader(credentials);
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
    public static async requestOAuthToken(
        clientId: string,
        clientSecret: string,
    ): Promise<AtlasOAuthTokenResponse> {
        const authHeader = this.getOAuthBasicAuthHeader(clientId, clientSecret);

        const response = await fetch(this.ATLAS_OAUTH_TOKEN_URL, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache',
                'Authorization': authHeader,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'grant_type=client_credentials',
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                l10n.t('Failed to obtain OAuth token: {0} {1}', response.status.toString(), errorText),
            );
        }

        return response.json() as Promise<AtlasOAuthTokenResponse>;
    }

    /**
     * Clears Atlas authentication state for the given cluster.
     *
     * @param mongoClusterId - The credential id for the Atlas instance
     */
    public static clearAuthentication(mongoClusterId: string): void {
        CredentialCache.clearAtlasCredentials(mongoClusterId);
    }

    /**
     * Gets or refreshes OAuth authorization header.
     * Automatically handles token expiry and renewal.
     */
    private static async getOAuthAuthorizationHeader(
        mongoClusterId: string,
        credentials: AtlasCredentials,
    ): Promise<string> {
        if (!credentials.oauth) {
            throw new Error(l10n.t('OAuth credentials not found for cluster {0}', mongoClusterId));
        }

        const { clientId, clientSecret } = credentials.oauth;

        // Check if we have a valid cached token
        if (CredentialCache.isAtlasOAuthTokenValid(mongoClusterId)) {
            const cachedToken = credentials.oauth.accessToken;
            if (cachedToken) {
                return `Bearer ${cachedToken}`;
            }
        }

        // Request new token
        const tokenResponse = await this.requestOAuthToken(clientId, clientSecret);

        // Update cache
        CredentialCache.updateAtlasOAuthToken(
            mongoClusterId,
            tokenResponse.access_token,
            tokenResponse.expires_in,
        );

        return `Bearer ${tokenResponse.access_token}`;
    }

    /**
     * Gets HTTP Digest authorization information.
     * Note: Actual digest authentication requires the server challenge,
     * so this returns the credentials for the HTTP client to use.
     */
    private static getDigestAuthorizationHeader(credentials: AtlasCredentials): string {
        if (!credentials.digest) {
            throw new Error(l10n.t('Digest credentials not found'));
        }

        // For digest auth, we return the credentials in a format that can be used
        // by the HTTP client library to generate the proper digest header
        const { publicKey, privateKey } = credentials.digest;
        return `Digest:${publicKey}:${privateKey}`;
    }

    /**
     * Creates HTTP headers for Atlas API requests with proper authentication.
     *
     * @param mongoClusterId - The credential id for the Atlas instance
     * @param additionalHeaders - Additional headers to include
     * @returns Headers object ready for fetch requests
     */
    public static async createAtlasHeaders(
        mongoClusterId: string,
        additionalHeaders: Record<string, string> = {},
    ): Promise<Record<string, string>> {
        const authHeader = await this.getAuthorizationHeader(mongoClusterId);
        
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.atlas.2023-02-01+json',
            ...additionalHeaders,
        };

        if (authHeader) {
            if (authHeader.startsWith('Digest:')) {
                // For digest auth, we'll need to handle this differently
                // The actual implementation would depend on the HTTP client
                const [, publicKey, privateKey] = authHeader.split(':');
                // This is a placeholder - real implementation would use a digest-capable HTTP client
                headers['X-Atlas-Digest-Auth'] = `${publicKey}:${privateKey}`;
            } else {
                headers['Authorization'] = authHeader;
            }
        }

        return headers;
    }
}