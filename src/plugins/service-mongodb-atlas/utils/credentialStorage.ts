/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { getSecretStorageKey } from '../../../utils/getSecretStorageKey';
import { type DigestCredentials, type OAuthCredentials } from '../auth/types';

/**
 * Service name for MongoDB Atlas credentials in secret storage
 */
const ATLAS_SERVICE_NAME = 'mongodb-atlas';

/**
 * Credential types supported by the storage utility
 */
export enum CredentialType {
    OAuth = 'oauth',
    Digest = 'digest',
}

/**
 * Stored credential data with metadata
 */
interface StoredCredential {
    type: CredentialType;
    data: OAuthCredentials | DigestCredentials;
    createdAt: number;
    lastUsed: number;
}

/**
 * Secure credential storage utility for MongoDB Atlas authentication.
 * Uses VS Code's secret storage API to securely store and retrieve credentials.
 */
export class CredentialStorage {
    constructor(private readonly secretStorage: vscode.SecretStorage) {}

    /**
     * Stores OAuth credentials securely.
     * 
     * @param credentialId Unique identifier for the credentials
     * @param credentials OAuth credentials to store
     */
    async storeOAuthCredentials(credentialId: string, credentials: OAuthCredentials): Promise<void> {
        const storedCredential: StoredCredential = {
            type: CredentialType.OAuth,
            data: credentials,
            createdAt: Date.now(),
            lastUsed: Date.now(),
        };

        const key = getSecretStorageKey(ATLAS_SERVICE_NAME, `${CredentialType.OAuth}.${credentialId}`);
        await this.secretStorage.store(key, JSON.stringify(storedCredential));
    }

    /**
     * Stores Digest credentials securely.
     * 
     * @param credentialId Unique identifier for the credentials
     * @param credentials Digest credentials to store
     */
    async storeDigestCredentials(credentialId: string, credentials: DigestCredentials): Promise<void> {
        const storedCredential: StoredCredential = {
            type: CredentialType.Digest,
            data: credentials,
            createdAt: Date.now(),
            lastUsed: Date.now(),
        };

        const key = getSecretStorageKey(ATLAS_SERVICE_NAME, `${CredentialType.Digest}.${credentialId}`);
        await this.secretStorage.store(key, JSON.stringify(storedCredential));
    }

    /**
     * Retrieves OAuth credentials from storage.
     * 
     * @param credentialId Unique identifier for the credentials
     * @returns OAuth credentials if found, undefined otherwise
     */
    async getOAuthCredentials(credentialId: string): Promise<OAuthCredentials | undefined> {
        const key = getSecretStorageKey(ATLAS_SERVICE_NAME, `${CredentialType.OAuth}.${credentialId}`);
        const stored = await this.secretStorage.get(key);
        
        if (!stored) {
            return undefined;
        }

        try {
            const storedCredential: StoredCredential = JSON.parse(stored) as StoredCredential;
            
            if (storedCredential.type !== CredentialType.OAuth) {
                console.warn(`Credential type mismatch for ${credentialId}: expected OAuth, got ${storedCredential.type}`);
                return undefined;
            }

            // Update last used timestamp
            await this.updateLastUsed(credentialId, CredentialType.OAuth);

            return storedCredential.data as OAuthCredentials;
        } catch (error) {
            console.error(`Failed to parse stored OAuth credentials for ${credentialId}:`, error);
            return undefined;
        }
    }

    /**
     * Retrieves Digest credentials from storage.
     * 
     * @param credentialId Unique identifier for the credentials
     * @returns Digest credentials if found, undefined otherwise
     */
    async getDigestCredentials(credentialId: string): Promise<DigestCredentials | undefined> {
        const key = getSecretStorageKey(ATLAS_SERVICE_NAME, `${CredentialType.Digest}.${credentialId}`);
        const stored = await this.secretStorage.get(key);
        
        if (!stored) {
            return undefined;
        }

        try {
            const storedCredential: StoredCredential = JSON.parse(stored) as StoredCredential;
            
            if (storedCredential.type !== CredentialType.Digest) {
                console.warn(`Credential type mismatch for ${credentialId}: expected Digest, got ${storedCredential.type}`);
                return undefined;
            }

            // Update last used timestamp
            await this.updateLastUsed(credentialId, CredentialType.Digest);

            return storedCredential.data as DigestCredentials;
        } catch (error) {
            console.error(`Failed to parse stored Digest credentials for ${credentialId}:`, error);
            return undefined;
        }
    }

    /**
     * Checks if credentials exist for the given ID and type.
     * 
     * @param credentialId Unique identifier for the credentials
     * @param type Credential type to check
     * @returns True if credentials exist, false otherwise
     */
    async hasCredentials(credentialId: string, type: CredentialType): Promise<boolean> {
        const key = getSecretStorageKey(ATLAS_SERVICE_NAME, `${type}.${credentialId}`);
        const stored = await this.secretStorage.get(key);
        return !!stored;
    }

    /**
     * Deletes credentials from storage.
     * 
     * @param credentialId Unique identifier for the credentials
     * @param type Credential type to delete
     */
    async deleteCredentials(credentialId: string, type: CredentialType): Promise<void> {
        const key = getSecretStorageKey(ATLAS_SERVICE_NAME, `${type}.${credentialId}`);
        await this.secretStorage.delete(key);
    }

    /**
     * Lists all stored credential IDs of a specific type.
     * 
     * @param _type Credential type to list (unused due to VS Code API limitations)
     * @returns Array of credential IDs
     */
    async listCredentials(_type: CredentialType): Promise<string[]> {
        // VS Code doesn't provide a way to list all keys, so we'll use a different approach
        // This is a limitation of the current VS Code secret storage API
        // In practice, the calling code should track credential IDs separately
        
        console.warn('VS Code secret storage does not support key enumeration. Use credential tracking in your plugin.');
        return [];
    }

    /**
     * Updates the last used timestamp for credentials.
     * 
     * @param credentialId Unique identifier for the credentials
     * @param type Credential type
     */
    private async updateLastUsed(credentialId: string, type: CredentialType): Promise<void> {
        const key = getSecretStorageKey(ATLAS_SERVICE_NAME, `${type}.${credentialId}`);
        const stored = await this.secretStorage.get(key);
        
        if (!stored) {
            return;
        }

        try {
            const storedCredential: StoredCredential = JSON.parse(stored) as StoredCredential;
            storedCredential.lastUsed = Date.now();
            await this.secretStorage.store(key, JSON.stringify(storedCredential));
        } catch (error) {
            console.error(`Failed to update last used timestamp for ${credentialId}:`, error);
            // Don't throw here as this is not critical for functionality
        }
    }

    /**
     * Validates credential data structure.
     * 
     * @param credentials Credentials to validate
     * @param type Expected credential type
     * @returns True if valid, false otherwise
     */
    static validateCredentials(credentials: unknown, type: CredentialType): boolean {
        if (!credentials || typeof credentials !== 'object') {
            return false;
        }

        switch (type) {
            case CredentialType.OAuth: {
                const oauth = credentials as OAuthCredentials;
                return !!(oauth.clientId && oauth.clientSecret && oauth.tokenEndpoint);
            }

            case CredentialType.Digest: {
                const digest = credentials as DigestCredentials;
                return !!(digest.publicKey && digest.privateKey && digest.baseUrl);
            }

            default:
                return false;
        }
    }

    /**
     * Creates a credential ID from connection information.
     * 
     * @param baseUrl The base URL for the Atlas API
     * @param publicKey The public key or client ID
     * @returns A unique credential ID
     */
    static createCredentialId(baseUrl: string, publicKey: string): string {
        // Create a stable ID based on the base URL and public key
        const normalized = `${baseUrl.toLowerCase()}-${publicKey.toLowerCase()}`;
        return normalized.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
    }
}