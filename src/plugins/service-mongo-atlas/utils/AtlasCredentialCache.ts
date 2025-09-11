/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CaseInsensitiveMap } from '../../../utils/CaseInsensitiveMap';

export interface AtlasCredentials {
    /** Authentication type for Atlas */
    authType: 'oauth' | 'digest';

    /** The unique identifier for the Atlas credential instance === the organization Id */
    orgId: string;

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

export interface AtlasOrganizationCredentials {
    /** The authentication credentials for the organization */
    credentials: AtlasCredentials;
}

export class AtlasCredentialCache {
    // the id of the organization === the orgId -> the atlas credentials
    private static _store: CaseInsensitiveMap<AtlasCredentials> = new CaseInsensitiveMap();

    /**
     * Sets MongoDB Atlas OAuth 2.0 credentials for service discovery.
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @param clientId - OAuth client ID
     * @param clientSecret - OAuth client secret
     */
    public static setAtlasOAuthCredentials(orgId: string, clientId: string, clientSecret: string): void {
        const credentials: AtlasCredentials = {
            orgId,
            authType: 'oauth',
            oauth: {
                clientId,
                clientSecret,
            },
        };

        AtlasCredentialCache._store.set(orgId, credentials);
    }

    /**
     * Sets MongoDB Atlas HTTP Digest credentials for service discovery.
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @param publicKey - Atlas API public key
     * @param privateKey - Atlas API private key
     */
    public static setAtlasDigestCredentials(orgId: string, publicKey: string, privateKey: string): void {
        const credentials: AtlasCredentials = {
            orgId,
            authType: 'digest',
            digest: {
                publicKey,
                privateKey,
            },
        };

        AtlasCredentialCache._store.set(orgId, credentials);
    }

    /**
     * Updates the OAuth access token cache for Atlas credentials.
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @param accessToken - The access token received from OAuth
     * @param expiresInSeconds - Token lifetime in seconds
     */
    public static updateAtlasOAuthToken(orgId: string, accessToken: string, expiresInSeconds: number = 3600): void {
        const credentials = AtlasCredentialCache._store.get(orgId);
        if (!credentials?.oauth) {
            throw new Error(`No Atlas OAuth credentials found for organization ${orgId}`);
        }

        const tokenExpiry = Date.now() + expiresInSeconds * 1000;
        credentials.oauth.accessToken = accessToken;
        credentials.oauth.tokenExpiry = tokenExpiry;

        AtlasCredentialCache._store.set(orgId, credentials);
    }

    /**
     * Gets Atlas credentials for a given cluster ID.
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @returns Atlas credentials or undefined if not found
     */
    public static getAtlasCredentials(orgId: string): AtlasCredentials | undefined {
        return AtlasCredentialCache._store.get(orgId);
    }

    /**
     * Checks if the OAuth token is still valid (not expired).
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @returns True if token exists and is valid, false otherwise
     */
    public static isAtlasOAuthTokenValid(orgId: string): boolean {
        const credentials = AtlasCredentialCache._store.get(orgId);
        const oauth = credentials?.oauth;

        if (!oauth?.accessToken || !oauth.tokenExpiry) {
            return false;
        }

        // Add 60 second buffer to avoid edge cases
        return Date.now() < oauth.tokenExpiry - 60000;
    }

    /**
     * Clears Atlas authentication state and removes credentials.
     *
     * @param orgId - The organization id for the Atlas credential instance
     */
    public static clearAtlasCredentials(orgId: string): void {
        const credentials = AtlasCredentialCache._store.get(orgId);
        if (credentials) {
            AtlasCredentialCache._store.delete(orgId);
        }
    }
}
