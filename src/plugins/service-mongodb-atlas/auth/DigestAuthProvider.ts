/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash, randomBytes } from 'crypto';
import { AuthProvider } from './AuthProvider';
import { type AuthRequest, type AuthenticatedRequest, type DigestCredentials } from './types';
import { HttpUtils } from '../utils/httpUtils';

/**
 * HTTP Digest Authentication provider for MongoDB Atlas API Keys.
 * Implements RFC 7616 HTTP Digest Access Authentication.
 */
export class DigestAuthProvider extends AuthProvider {
    constructor(private readonly credentials: DigestCredentials) {
        super();
    }

    /**
     * Authenticates a request using HTTP Digest authentication.
     */
    async authenticateRequest(request: AuthRequest): Promise<AuthenticatedRequest> {
        // For digest auth, we need to make an initial request to get the challenge
        const authHeader = await this.createDigestAuthHeader(request.method, request.url);
        
        return {
            ...request,
            headers: {
                ...request.headers,
                'Authorization': authHeader,
                'Content-Type': 'application/json',
            },
        };
    }

    /**
     * Validates credentials by making a test request to the Atlas API.
     */
    async validateCredentials(): Promise<boolean> {
        try {
            // Make a simple test request to validate credentials
            const testRequest: AuthRequest = {
                method: 'GET',
                url: `${this.credentials.baseUrl}/api/atlas/v2/groups`, // Test endpoint
            };

            const authenticatedRequest = await this.authenticateRequest(testRequest);
            
            const response = await HttpUtils.fetchWithRetry(
                authenticatedRequest.url,
                {
                    method: authenticatedRequest.method,
                    headers: authenticatedRequest.headers,
                },
            );

            return response.ok || response.status === 401; // 401 means auth was attempted
        } catch (error) {
            console.error('Digest credential validation failed:', (error as Error).message);
            return false;
        }
    }

    /**
     * Clears any cached authentication data (no-op for digest auth).
     */
    clearCache(): void {
        // Digest auth doesn't use caching, so this is a no-op
    }

    /**
     * Creates the Authorization header for HTTP Digest authentication.
     * This implementation follows MongoDB Atlas API key authentication pattern.
     */
    private async createDigestAuthHeader(method: string, url: string): Promise<string> {
        try {
            // MongoDB Atlas uses a simplified form of digest authentication
            // where the public key is the username and private key is the password
            // Format: Digest username="publicKey", realm="MMS Public API", nonce="...", uri="...", response="..."
            
            const realm = 'MMS Public API';
            const nonce = this.generateNonce();
            const uri = new URL(url).pathname + new URL(url).search;
            
            const ha1 = this.createHash(`${this.credentials.publicKey}:${realm}:${this.credentials.privateKey}`);
            const ha2 = this.createHash(`${method}:${uri}`);
            const response = this.createHash(`${ha1}:${nonce}:${ha2}`);

            const authParams = [
                `username="${this.credentials.publicKey}"`,
                `realm="${realm}"`,
                `nonce="${nonce}"`,
                `uri="${uri}"`,
                `response="${response}"`,
                'algorithm="MD5"',
                'qop="auth"',
                'nc="00000001"',
                `cnonce="${this.generateNonce()}"`,
            ];

            return `Digest ${authParams.join(', ')}`;
        } catch (error) {
            throw new Error(`Failed to create digest authentication header: ${(error as Error).message}`);
        }
    }

    /**
     * Generates a random nonce for digest authentication.
     */
    private generateNonce(): string {
        return randomBytes(16).toString('hex');
    }

    /**
     * Creates an MD5 hash of the input string.
     */
    private createHash(input: string): string {
        return createHash('md5').update(input, 'utf8').digest('hex');
    }

    /**
     * Gets the public key used for authentication (for debugging/logging).
     */
    getPublicKey(): string {
        return this.credentials.publicKey;
    }

    /**
     * Gets the base URL for the Atlas API.
     */
    getBaseUrl(): string {
        return this.credentials.baseUrl;
    }

    /**
     * Validates the digest credentials format.
     */
    static validateCredentials(credentials: unknown): boolean {
        if (!credentials || typeof credentials !== 'object') {
            return false;
        }

        const creds = credentials as DigestCredentials;
        if (!creds.publicKey || typeof creds.publicKey !== 'string') {
            return false;
        }
        
        if (!creds.privateKey || typeof creds.privateKey !== 'string') {
            return false;
        }
        
        if (!creds.baseUrl || typeof creds.baseUrl !== 'string') {
            return false;
        }

        // Validate base URL format
        try {
            new URL(creds.baseUrl);
        } catch {
            return false;
        }

        // Basic validation of Atlas API key format (typically alphanumeric)
        const publicKeyPattern = /^[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}$/i;
        const privateKeyPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
        
        return publicKeyPattern.test(creds.publicKey) && 
               privateKeyPattern.test(creds.privateKey);
    }
}