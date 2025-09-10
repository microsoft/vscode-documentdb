/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { DigestAuthHandler } from './auth/DigestAuthHandler';
import { OAuth2Handler } from './auth/OAuth2Handler';
import { AtlasCredentialStorage } from './storage/AtlasCredentialStorage';
import { type AtlasAuthConfig } from './types/AtlasAuthConfig';
import { type AtlasAuthResult } from './types/AtlasAuthResult';
import { AtlasAuthType, type AtlasCredentials, type AtlasDigestCredentials, type CredentialValidationResult } from './types/AtlasCredentials';
import { AtlasHttpClient } from './utils/httpClient';

/**
 * Main service for MongoDB Atlas authentication management.
 * 
 * This service provides a unified interface for:
 * - Storing and managing Atlas credentials securely
 * - Authenticating using OAuth 2.0 or HTTP Digest authentication
 * - Providing authentication headers for API requests
 * - Automatic token refresh and credential lifecycle management
 */
export class AtlasAuthService implements vscode.Disposable {
    private readonly credentialStorage: AtlasCredentialStorage;
    private readonly oAuth2Handler: OAuth2Handler;
    private readonly digestAuthHandler: DigestAuthHandler;
    private readonly httpClient: AtlasHttpClient;

    private currentCredentials: AtlasCredentials | undefined;

    constructor(
        context: vscode.ExtensionContext,
        config: AtlasAuthConfig = {}
    ) {
        this.credentialStorage = new AtlasCredentialStorage(context.secrets);
        this.oAuth2Handler = new OAuth2Handler(config);
        this.digestAuthHandler = new DigestAuthHandler(config);
        this.httpClient = new AtlasHttpClient(config);
    }

    dispose(): void {
        // Clear any sensitive data from memory
        this.currentCredentials = undefined;
        this.oAuth2Handler.clearToken();
        this.digestAuthHandler.clearAuthentication();
    }

    /**
     * Stores new Atlas credentials and authenticates with them
     * @param credentials The credentials to store and use
     * @returns Authentication result
     */
    async setCredentials(credentials: AtlasCredentials): Promise<AtlasAuthResult> {
        try {
            // Store credentials securely
            await this.credentialStorage.storeCredentials(credentials);
            this.currentCredentials = credentials;

            // Authenticate with the new credentials
            return await this.authenticate();
        } catch (error) {
            return {
                success: false,
                error: l10n.t('Failed to set credentials: {0}', (error as Error).message),
            };
        }
    }

    /**
     * Loads stored credentials and authenticates if available
     * @returns Authentication result or null if no credentials stored
     */
    async loadStoredCredentials(): Promise<AtlasAuthResult | null> {
        try {
            const storedCredentials = await this.credentialStorage.getCredentials();
            if (!storedCredentials) {
                return null;
            }

            this.currentCredentials = storedCredentials;
            return await this.authenticate();
        } catch (error) {
            return {
                success: false,
                error: l10n.t('Failed to load stored credentials: {0}', (error as Error).message),
            };
        }
    }

    /**
     * Gets an authentication header for API requests
     * @returns Authentication header or error result
     */
    async getAuthHeader(): Promise<AtlasAuthResult> {
        if (!this.currentCredentials) {
            const loadResult = await this.loadStoredCredentials();
            if (!loadResult) {
                return {
                    success: false,
                    error: l10n.t('No Atlas credentials configured. Please set credentials first.'),
                    requiresReauthentication: true,
                };
            }
            if (!loadResult.success) {
                return loadResult;
            }
        }

        return await this.authenticate();
    }

    /**
     * Gets an authenticated fetch function for making HTTP requests
     * This is primarily for Digest authentication which requires per-request authentication
     * @returns Authenticated fetch function or throws error
     */
    async getAuthenticatedFetch(): Promise<typeof fetch> {
        if (!this.currentCredentials) {
            const loadResult = await this.loadStoredCredentials();
            if (!loadResult?.success) {
                throw new Error(l10n.t('Authentication required. Please set credentials first.'));
            }
        }

        if (this.currentCredentials!.type === AtlasAuthType.DigestAuth) {
            const authResult = await this.digestAuthHandler.authenticate(this.currentCredentials as AtlasDigestCredentials);
            if (!authResult.success) {
                throw new Error(authResult.error || l10n.t('Digest authentication failed'));
            }
            return this.digestAuthHandler.getAuthenticatedFetch();
        } else {
            // For OAuth2, we can return a fetch wrapper that includes the auth header
            const authResult = await this.getAuthHeader();
            if (!authResult.success || !authResult.authHeader) {
                throw new Error(authResult.error || l10n.t('OAuth2 authentication failed'));
            }
            
            const authHeader = authResult.authHeader;
            return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
                const url = typeof input === 'string' ? input : input.toString();
                return await this.httpClient.makeAuthenticatedRequest(
                    url,
                    init,
                    authHeader
                );
            };
        }
    }

    /**
     * Validates the current credentials by attempting authentication
     * @returns Validation result
     */
    async validateCredentials(): Promise<CredentialValidationResult> {
        try {
            const authResult = await this.getAuthHeader();
            return {
                isValid: authResult.success,
                error: authResult.error,
            };
        } catch (error) {
            return {
                isValid: false,
                error: (error as Error).message,
            };
        }
    }

    /**
     * Clears all stored credentials and authentication state
     */
    async clearCredentials(): Promise<void> {
        await this.credentialStorage.clearCredentials();
        this.currentCredentials = undefined;
        this.oAuth2Handler.clearToken();
        this.digestAuthHandler.clearAuthentication();
    }

    /**
     * Updates existing credentials
     * @param credentials The new credentials
     * @returns Authentication result
     */
    async updateCredentials(credentials: AtlasCredentials): Promise<AtlasAuthResult> {
        // Clear old authentication state first
        this.oAuth2Handler.clearToken();
        this.digestAuthHandler.clearAuthentication();
        
        return await this.setCredentials(credentials);
    }

    /**
     * Checks if credentials are currently stored
     * @returns True if credentials exist, false otherwise
     */
    async hasCredentials(): Promise<boolean> {
        return await this.credentialStorage.hasCredentials();
    }

    /**
     * Gets the type of currently stored credentials
     * @returns Authentication type or undefined if none stored
     */
    async getStoredAuthType(): Promise<AtlasAuthType | undefined> {
        return await this.credentialStorage.getAuthType();
    }

    /**
     * Creates an Atlas HTTP client that can be used for API requests
     * @returns HTTP client configured for Atlas API
     */
    getHttpClient(): AtlasHttpClient {
        return this.httpClient;
    }

    /**
     * Authenticates using the current credentials
     */
    private async authenticate(): Promise<AtlasAuthResult> {
        if (!this.currentCredentials) {
            return {
                success: false,
                error: l10n.t('No credentials available for authentication'),
                requiresReauthentication: true,
            };
        }

        try {
            switch (this.currentCredentials.type) {
                case AtlasAuthType.OAuth2:
                    return await this.oAuth2Handler.authenticate(this.currentCredentials);
                
                case AtlasAuthType.DigestAuth: {
                    // For Digest auth, we authenticate but don't return a static header
                    const digestResult = await this.digestAuthHandler.authenticate(this.currentCredentials);
                    return digestResult;
                }
                
                default:
                    return {
                        success: false,
                        error: l10n.t('Unsupported authentication type'),
                    };
            }
        } catch (error) {
            return {
                success: false,
                error: l10n.t('Authentication failed: {0}', (error as Error).message),
                requiresReauthentication: true,
            };
        }
    }
}