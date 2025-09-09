/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AuthRequest, type AuthenticatedRequest, type DigestCredentials, type OAuthCredentials } from './types';

/**
 * Abstract base class for MongoDB Atlas authentication providers.
 * Provides a pluggable interface for different authentication mechanisms.
 */
export abstract class AuthProvider {
    /**
     * Authenticates a request by adding appropriate authorization headers.
     * 
     * @param request The request to authenticate
     * @returns Promise resolving to the authenticated request with authorization headers
     * @throws Error if authentication fails or credentials are invalid
     */
    abstract authenticateRequest(request: AuthRequest): Promise<AuthenticatedRequest>;

    /**
     * Validates that the provider's credentials are valid and can authenticate requests.
     * 
     * @returns Promise resolving to true if credentials are valid, false otherwise
     */
    abstract validateCredentials(): Promise<boolean>;

    /**
     * Clears any cached authentication data (tokens, credentials, etc.).
     * Should be called when switching contexts or on authentication failures.
     */
    abstract clearCache(): void;
}

/**
 * Authentication provider factory for creating appropriate providers based on credential type.
 */
export class AuthProviderFactory {
    /**
     * Creates an OAuth-based authentication provider for MongoDB Atlas.
     * 
     * @param credentials OAuth 2.0 credentials
     * @returns OAuth authentication provider instance
     */
    static createOAuthProvider(credentials: OAuthCredentials): AuthProvider {
        // Dynamic import to avoid circular dependencies
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { OAuthAuthProvider } = require('./OAuthAuthProvider') as { OAuthAuthProvider: new (creds: OAuthCredentials) => AuthProvider };
        return new OAuthAuthProvider(credentials);
    }

    /**
     * Creates a Digest-based authentication provider for MongoDB Atlas.
     * 
     * @param credentials HTTP Digest credentials
     * @returns Digest authentication provider instance
     */
    static createDigestProvider(credentials: DigestCredentials): AuthProvider {
        // Dynamic import to avoid circular dependencies
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { DigestAuthProvider } = require('./DigestAuthProvider') as { DigestAuthProvider: new (creds: DigestCredentials) => AuthProvider };
        return new DigestAuthProvider(credentials);
    }
}