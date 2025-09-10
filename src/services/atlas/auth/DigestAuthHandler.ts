/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
 
import DigestFetch from 'digest-fetch';
import { type AtlasAuthConfig, DEFAULT_ATLAS_AUTH_CONFIG } from '../types/AtlasAuthConfig';
import { type AtlasAuthHeader, type AtlasAuthResult } from '../types/AtlasAuthResult';
import { type AtlasDigestCredentials } from '../types/AtlasCredentials';

/**
 * Handles HTTP Digest Authentication for MongoDB Atlas API.
 * 
 * This handler uses the digest-fetch library to properly implement
 * HTTP Digest authentication as required by the MongoDB Atlas Management API.
 */
export class DigestAuthHandler {
    private readonly config: Required<AtlasAuthConfig>;
    private digestClient: DigestFetch | undefined;

    constructor(config: AtlasAuthConfig = {}) {
        this.config = { ...DEFAULT_ATLAS_AUTH_CONFIG, ...config };
    }

    /**
     * Authenticates using HTTP Digest Authentication
     * @param credentials Digest authentication credentials
     * @returns Authentication result - for Digest auth, this creates a configured client
     */
    async authenticate(credentials: AtlasDigestCredentials): Promise<AtlasAuthResult> {
        try {
            // Create a new digest client with the credentials
            this.digestClient = new DigestFetch(credentials.publicKey, credentials.privateKey, {
                timeout: this.config.timeoutMs,
            });

            // Test the credentials by making a simple request
            await this.validateCredentials();

            return {
                success: true,
                // For Digest auth, we don't return a static header since it's request-specific
                // The getAuthenticatedFetch method should be used instead
            };
        } catch (error) {
            return {
                success: false,
                error: l10n.t('Digest authentication failed: {0}', (error as Error).message),
                requiresReauthentication: true,
            };
        }
    }

    /**
     * Creates an authenticated fetch function that can be used for HTTP requests
     * @returns A fetch function that automatically handles Digest authentication
     */
    getAuthenticatedFetch(): typeof fetch {
        if (!this.digestClient) {
            throw new Error(l10n.t('Digest client not initialized. Call authenticate() first.'));
        }

        // Return a bound fetch function that includes digest authentication
        return this.digestClient.fetch.bind(this.digestClient) as typeof fetch;
    }

    /**
     * For Digest auth, we can't provide a static header since it varies per request
     * This method is kept for interface compatibility but will throw an error
     */
    getAuthHeader(): AtlasAuthHeader {
        throw new Error(
            l10n.t(
                'Digest authentication does not support static headers. Use getAuthenticatedFetch() instead.'
            )
        );
    }

    /**
     * Checks if the digest client is initialized and ready
     */
    isAuthenticated(): boolean {
        return this.digestClient !== undefined;
    }

    /**
     * Clears the digest client, requiring re-authentication
     */
    clearAuthentication(): void {
        this.digestClient = undefined;
    }

    /**
     * Validates the credentials by making a test request to the Atlas API
     */
    private async validateCredentials(): Promise<void> {
        if (!this.digestClient) {
            throw new Error(l10n.t('Digest client not initialized'));
        }

        try {
            // Make a simple request to validate credentials
            // Using the root API endpoint which should be accessible with valid credentials
            const response = await this.digestClient.fetch(`${this.config.apiBaseUrl}`, {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                },
            }) as Response;

            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error(l10n.t('Invalid Atlas credentials'));
                } else if (response.status === 403) {
                    throw new Error(l10n.t('Atlas credentials do not have sufficient permissions'));
                } else {
                    throw new Error(
                        l10n.t('Credential validation failed with status {0}', response.status.toString())
                    );
                }
            }
        } catch (error) {
            if (error instanceof TypeError && error.message.includes('fetch')) {
                throw new Error(l10n.t('Network error during credential validation'));
            }
            // Re-throw if it's already our custom error
            if (error instanceof Error) {
                throw error;
            }
            // Handle unknown error types
            throw new Error(l10n.t('Unknown error during credential validation'));
        }
    }
}