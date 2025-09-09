/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type OAuthCredentials, type OAuthTokenResponse, AtlasAuthenticationError } from '../types';

/**
 * OAuth2 Client Credentials flow authenticator for MongoDB Atlas
 */
export class OAuthAuthenticator {
    private accessToken?: string;
    private tokenExpiry?: Date;
    private readonly tokenEndpoint = 'https://cloud.mongodb.com/api/oauth/token';

    constructor(private readonly credentials: OAuthCredentials) {}

    /**
     * Get a valid access token, refreshing if necessary
     */
    public async getAccessToken(): Promise<string> {
        if (this.isTokenValid()) {
            return this.accessToken!;
        }

        await this.refreshToken();
        return this.accessToken!;
    }

    /**
     * Add OAuth authorization header to request headers
     */
    public async addAuthHeaders(headers: Record<string, string>): Promise<Record<string, string>> {
        const token = await this.getAccessToken();
        return {
            ...headers,
            Authorization: `Bearer ${token}`,
        };
    }

    /**
     * Clear cached token (useful for handling auth errors)
     */
    public clearToken(): void {
        this.accessToken = undefined;
        this.tokenExpiry = undefined;
    }

    private isTokenValid(): boolean {
        if (!this.accessToken || !this.tokenExpiry) {
            return false;
        }

        // Add 60 second buffer to ensure token doesn't expire during request
        const now = new Date();
        const expiryWithBuffer = new Date(this.tokenExpiry.getTime() - 60 * 1000);
        
        return now < expiryWithBuffer;
    }

    private async refreshToken(): Promise<void> {
        const scopes = this.credentials.scopes?.join(' ') || '';
        
        const body = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.credentials.clientId,
            client_secret: this.credentials.clientSecret,
            ...(scopes && { scope: scopes }),
        });

        try {
            const response = await fetch(this.tokenEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json',
                },
                body: body.toString(),
            });

            if (!response.ok) {
                const errorData = await this.parseErrorResponse(response);
                throw new AtlasAuthenticationError(
                    `OAuth token request failed: ${response.status} ${response.statusText}`,
                    errorData,
                );
            }

            const tokenResponse: OAuthTokenResponse = await response.json();
            
            this.accessToken = tokenResponse.access_token;
            this.tokenExpiry = new Date(Date.now() + tokenResponse.expires_in * 1000);
        } catch (error) {
            if (error instanceof AtlasAuthenticationError) {
                throw error;
            }
            
            throw new AtlasAuthenticationError(
                `Failed to obtain OAuth token: ${error instanceof Error ? error.message : 'Unknown error'}`,
                error,
            );
        }
    }

    private async parseErrorResponse(response: Response): Promise<unknown> {
        try {
            return await response.json();
        } catch {
            return {
                status: response.status,
                statusText: response.statusText,
            };
        }
    }
}