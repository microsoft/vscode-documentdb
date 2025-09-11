/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaseInsensitiveMap } from '../utils/CaseInsensitiveMap';
import { type EmulatorConfiguration } from '../utils/emulatorConfiguration';
import { AuthMethodId } from './auth/AuthMethod';
import { addAuthenticationDataToConnectionString } from './utils/connectionStringHelpers';

export interface ClustersCredentials {
    mongoClusterId: string;
    connectionStringWithPassword?: string;
    connectionString: string;
    connectionUser: string;
    connectionPassword?: string;

    authMechanism?: AuthMethodId;
    // Optional, as it's only relevant for local workspace connections
    emulatorConfiguration?: EmulatorConfiguration;
    
    // Atlas-specific credentials
    atlasCredentials?: AtlasCredentials;
}

export interface AtlasCredentials {
    /** Authentication type for Atlas */
    authType: 'oauth' | 'digest';
    
    /** OAuth 2.0 credentials */
    oauth?: {
        clientId: string;
        clientSecret: string;
        // Token cache
        accessToken?: string;
        tokenExpiry?: number; // Unix timestamp
    };
    
    /** HTTP Digest credentials */
    digest?: {
        publicKey: string;
        privateKey: string;
    };
}

export class CredentialCache {
    // the id of the cluster === the tree item id -> cluster credentials
    // Some SDKs for azure differ the case on some resources ("DocumentDb" vs "DocumentDB")
    private static _store: CaseInsensitiveMap<ClustersCredentials> = new CaseInsensitiveMap();

    public static getConnectionStringWithPassword(mongoClusterId: string): string {
        return CredentialCache._store.get(mongoClusterId)?.connectionStringWithPassword as string;
    }

    public static hasCredentials(mongoClusterId: string): boolean {
        return CredentialCache._store.has(mongoClusterId) as boolean;
    }

    public static getEmulatorConfiguration(mongoClusterId: string): EmulatorConfiguration | undefined {
        return CredentialCache._store.get(mongoClusterId)?.emulatorConfiguration;
    }

    public static getCredentials(mongoClusterId: string): ClustersCredentials | undefined {
        return CredentialCache._store.get(mongoClusterId);
    }

    public static deleteCredentials(mongoClusterId: string): void {
        CredentialCache._store.delete(mongoClusterId);
    }

    /**
     * Sets the credentials for a given connection string and stores them in the credential cache.
     *
     * @deprecated Use {@link CredentialCache.setAuthCredentials} instead and provide an explicit AuthMethod.
     *
     * @param id - The credential id. It's supposed to be the same as the tree item id of the mongo cluster item to simplify the lookup.
     * @param connectionString - The connection string to which the credentials will be added.
     * @param username - The username to be used for authentication.
     * @param password - The password to be used for authentication.
     * @param emulatorConfiguration - The emulator configuration object (optional).
     */
    public static setCredentials(
        mongoClusterId: string,
        connectionString: string,
        username: string,
        password: string,
        emulatorConfiguration?: EmulatorConfiguration,
    ): void {
        console.warn(
            'CredentialCache.setCredentials is deprecated. Please migrate to CredentialCache.setAuthCredentials and provide an explicit AuthMethod.',
        );

        const connectionStringWithPassword = addAuthenticationDataToConnectionString(
            connectionString,
            username,
            password,
        );

        const credentials: ClustersCredentials = {
            mongoClusterId: mongoClusterId,
            connectionStringWithPassword: connectionStringWithPassword,
            connectionString: connectionString,
            connectionUser: username,
            emulatorConfiguration: emulatorConfiguration,
        };

        CredentialCache._store.set(mongoClusterId, credentials);
    }

    /**
     * New implementation of setCredentials that adds support for authentication methods (authMechanism).
     * Introduced during the Entra ID integration to support Entra/Microsoft identity and other authentication flows.
     * This stores authentication-aware credentials for a given cluster in the cache.
     *
     * NOTE: The original `setCredentials` remains for compatibility but will be deprecated in a future change.
     *
     * @param mongoClusterId - The credential id. It's supposed to be the same as the tree item id of the mongo cluster item to simplify the lookup.
     * @param authMethod - The authentication method/mechanism to be used (e.g. SCRAM, X509, Azure/Entra flows).
     * @param connectionString - The connection string to which optional credentials will be added.
     * @param username - The username to be used for authentication (optional for some auth methods).
     * @param password - The password to be used for authentication (optional for some auth methods).
     * @param emulatorConfiguration - The emulator configuration object (optional, only relevant for local workspace connections).
     */
    public static setAuthCredentials(
        mongoClusterId: string,
        authMethod: AuthMethodId,
        connectionString: string,
        username: string = '',
        password: string = '',
        emulatorConfiguration?: EmulatorConfiguration,
    ): void {
        const connectionStringWithPassword = addAuthenticationDataToConnectionString(
            connectionString,
            username,
            password,
        );

        const credentials: ClustersCredentials = {
            mongoClusterId: mongoClusterId,
            connectionStringWithPassword: connectionStringWithPassword,
            connectionString: connectionString,
            connectionUser: username,
            emulatorConfiguration: emulatorConfiguration,
            authMechanism: authMethod,
        };

        CredentialCache._store.set(mongoClusterId, credentials);
    }

    /**
     * Sets MongoDB Atlas OAuth 2.0 credentials for service discovery.
     * 
     * @param mongoClusterId - The credential id for the Atlas instance
     * @param clientId - OAuth client ID
     * @param clientSecret - OAuth client secret (stored securely)
     */
    public static setAtlasOAuthCredentials(
        mongoClusterId: string,
        clientId: string,
        clientSecret: string,
    ): void {
        const existingCredentials = CredentialCache._store.get(mongoClusterId);
        
        const credentials: ClustersCredentials = {
            mongoClusterId: mongoClusterId,
            connectionString: '', // Not used for Atlas discovery
            connectionUser: '',
            authMechanism: AuthMethodId.AtlasOAuth,
            atlasCredentials: {
                authType: 'oauth',
                oauth: {
                    clientId,
                    clientSecret,
                },
            },
            ...existingCredentials,
        };

        CredentialCache._store.set(mongoClusterId, credentials);
    }

    /**
     * Sets MongoDB Atlas HTTP Digest credentials for service discovery.
     * 
     * @param mongoClusterId - The credential id for the Atlas instance
     * @param publicKey - Atlas API public key
     * @param privateKey - Atlas API private key (stored securely)
     */
    public static setAtlasDigestCredentials(
        mongoClusterId: string,
        publicKey: string,
        privateKey: string,
    ): void {
        const existingCredentials = CredentialCache._store.get(mongoClusterId);
        
        const credentials: ClustersCredentials = {
            mongoClusterId: mongoClusterId,
            connectionString: '', // Not used for Atlas discovery
            connectionUser: '',
            authMechanism: AuthMethodId.AtlasDigest,
            atlasCredentials: {
                authType: 'digest',
                digest: {
                    publicKey,
                    privateKey,
                },
            },
            ...existingCredentials,
        };

        CredentialCache._store.set(mongoClusterId, credentials);
    }

    /**
     * Updates the OAuth access token cache for Atlas credentials.
     * 
     * @param mongoClusterId - The credential id for the Atlas instance
     * @param accessToken - The access token received from OAuth
     * @param expiresInSeconds - Token lifetime in seconds (typically 3600)
     */
    public static updateAtlasOAuthToken(
        mongoClusterId: string,
        accessToken: string,
        expiresInSeconds: number,
    ): void {
        const credentials = CredentialCache._store.get(mongoClusterId);
        if (!credentials?.atlasCredentials?.oauth) {
            throw new Error(`No Atlas OAuth credentials found for id ${mongoClusterId}`);
        }

        const tokenExpiry = Date.now() + (expiresInSeconds * 1000);
        
        credentials.atlasCredentials.oauth.accessToken = accessToken;
        credentials.atlasCredentials.oauth.tokenExpiry = tokenExpiry;

        CredentialCache._store.set(mongoClusterId, credentials);
    }

    /**
     * Gets Atlas credentials for a given cluster ID.
     * 
     * @param mongoClusterId - The credential id for the Atlas instance
     * @returns Atlas credentials or undefined if not found
     */
    public static getAtlasCredentials(mongoClusterId: string): AtlasCredentials | undefined {
        return CredentialCache._store.get(mongoClusterId)?.atlasCredentials;
    }

    /**
     * Checks if the OAuth token is still valid (not expired).
     * 
     * @param mongoClusterId - The credential id for the Atlas instance
     * @returns True if token exists and is valid, false otherwise
     */
    public static isAtlasOAuthTokenValid(mongoClusterId: string): boolean {
        const credentials = CredentialCache._store.get(mongoClusterId);
        const oauth = credentials?.atlasCredentials?.oauth;
        
        if (!oauth?.accessToken || !oauth.tokenExpiry) {
            return false;
        }

        // Add 60 second buffer to avoid edge cases
        return Date.now() < (oauth.tokenExpiry - 60000);
    }

    /**
     * Clears Atlas authentication state and removes credentials.
     * 
     * @param mongoClusterId - The credential id for the Atlas instance
     */
    public static clearAtlasCredentials(mongoClusterId: string): void {
        const credentials = CredentialCache._store.get(mongoClusterId);
        if (credentials) {
            credentials.atlasCredentials = undefined;
            if (credentials.authMechanism === AuthMethodId.AtlasOAuth || 
                credentials.authMechanism === AuthMethodId.AtlasDigest) {
                credentials.authMechanism = undefined;
            }
            CredentialCache._store.set(mongoClusterId, credentials);
        }
    }
}
