/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { nonNullValue } from '../../../utils/nonNull';
import { AtlasAuthType, type AtlasCredentials } from '../types/AtlasCredentials';

/**
 * Manages secure storage of MongoDB Atlas credentials using VS Code's SecretStorage API.
 * 
 * This service provides secure, encrypted storage for Atlas authentication credentials
 * including OAuth 2.0 client credentials and HTTP Digest authentication keys.
 */
export class AtlasCredentialStorage {
    private static readonly STORAGE_KEY_PREFIX = 'vscode-documentdb.atlas';
    private static readonly CREDENTIALS_KEY = `${AtlasCredentialStorage.STORAGE_KEY_PREFIX}.credentials`;
    private static readonly AUTH_TYPE_KEY = `${AtlasCredentialStorage.STORAGE_KEY_PREFIX}.authType`;

    constructor(private readonly secretStorage: vscode.SecretStorage) {}

    /**
     * Stores Atlas credentials securely
     * @param credentials The credentials to store
     */
    async storeCredentials(credentials: AtlasCredentials): Promise<void> {
        try {
            // Store the auth type separately for quick type checking
            await this.secretStorage.store(AtlasCredentialStorage.AUTH_TYPE_KEY, credentials.type);
            
            // Store the credentials as JSON
            const credentialsJson = JSON.stringify(credentials);
            await this.secretStorage.store(AtlasCredentialStorage.CREDENTIALS_KEY, credentialsJson);
        } catch (error) {
            throw new Error(
                l10n.t('Failed to store Atlas credentials: {0}', (error as Error).message)
            );
        }
    }

    /**
     * Retrieves stored Atlas credentials
     * @returns The stored credentials or undefined if none exist
     */
    async getCredentials(): Promise<AtlasCredentials | undefined> {
        try {
            const credentialsJson = await this.secretStorage.get(AtlasCredentialStorage.CREDENTIALS_KEY);
            
            if (!credentialsJson) {
                return undefined;
            }

            const credentials = JSON.parse(credentialsJson) as AtlasCredentials;
            
            // Validate the parsed credentials have required properties
            this.validateCredentialsStructure(credentials);
            
            return credentials;
        } catch (error) {
            throw new Error(
                l10n.t('Failed to retrieve Atlas credentials: {0}', (error as Error).message)
            );
        }
    }

    /**
     * Retrieves the stored authentication type without loading full credentials
     * @returns The authentication type or undefined if none stored
     */
    async getAuthType(): Promise<AtlasAuthType | undefined> {
        try {
            const authType = await this.secretStorage.get(AtlasCredentialStorage.AUTH_TYPE_KEY);
            return authType as AtlasAuthType | undefined;
        } catch (error) {
            throw new Error(
                l10n.t('Failed to retrieve Atlas auth type: {0}', (error as Error).message)
            );
        }
    }

    /**
     * Checks if credentials are currently stored
     * @returns True if credentials exist, false otherwise
     */
    async hasCredentials(): Promise<boolean> {
        try {
            const authType = await this.getAuthType();
            return authType !== undefined;
        } catch {
            return false;
        }
    }

    /**
     * Clears all stored Atlas credentials and related data
     */
    async clearCredentials(): Promise<void> {
        try {
            await Promise.all([
                this.secretStorage.delete(AtlasCredentialStorage.CREDENTIALS_KEY),
                this.secretStorage.delete(AtlasCredentialStorage.AUTH_TYPE_KEY),
            ]);
        } catch (error) {
            throw new Error(
                l10n.t('Failed to clear Atlas credentials: {0}', (error as Error).message)
            );
        }
    }

    /**
     * Updates existing credentials (equivalent to storing new ones)
     * @param credentials The new credentials to store
     */
    async updateCredentials(credentials: AtlasCredentials): Promise<void> {
        await this.storeCredentials(credentials);
    }

    /**
     * Validates that parsed credentials have the expected structure
     */
    private validateCredentialsStructure(credentials: unknown): asserts credentials is AtlasCredentials {
        const creds = nonNullValue(credentials, 'credentials', 'AtlasCredentialStorage.ts');
        
        if (typeof creds !== 'object') {
            throw new Error(l10n.t('Invalid credentials format: expected object'));
        }

        const credObj = creds as Record<string, unknown>;
        
        if (!credObj.type || typeof credObj.type !== 'string') {
            throw new Error(l10n.t('Invalid credentials: missing or invalid type field'));
        }

        const authType = credObj.type as AtlasAuthType;
        
        switch (authType) {
            case AtlasAuthType.OAuth2:
                if (!credObj.clientId || typeof credObj.clientId !== 'string') {
                    throw new Error(l10n.t('Invalid OAuth2 credentials: missing clientId'));
                }
                if (!credObj.clientSecret || typeof credObj.clientSecret !== 'string') {
                    throw new Error(l10n.t('Invalid OAuth2 credentials: missing clientSecret'));
                }
                break;
                
            case AtlasAuthType.DigestAuth:
                if (!credObj.publicKey || typeof credObj.publicKey !== 'string') {
                    throw new Error(l10n.t('Invalid Digest credentials: missing publicKey'));
                }
                if (!credObj.privateKey || typeof credObj.privateKey !== 'string') {
                    throw new Error(l10n.t('Invalid Digest credentials: missing privateKey'));
                }
                break;
                
            default:
                throw new Error(l10n.t('Unsupported authentication type: {0}', authType));
        }
    }
}