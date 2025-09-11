/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { createHash } from 'crypto';
import { CredentialCache, type AtlasCredentials } from '../../../documentdb/CredentialCache';
import { AtlasAuthManager } from './AtlasAuthManager';

/**
 * HTTP client for MongoDB Atlas API that handles authentication
 */
export class AtlasHttpClient {
    private static readonly ATLAS_API_BASE_URL = 'https://cloud.mongodb.com/api/atlas/v2';

    /**
     * Makes an authenticated GET request to the Atlas API
     *
     * @param mongoClusterId - The credential id for the Atlas instance
     * @param endpoint - API endpoint path (e.g., '/groups')
     * @returns Response from Atlas API
     */
    public static async get(mongoClusterId: string, endpoint: string): Promise<Response> {
        return this.request(mongoClusterId, 'GET', endpoint);
    }

    /**
     * Makes an authenticated POST request to the Atlas API
     *
     * @param mongoClusterId - The credential id for the Atlas instance
     * @param endpoint - API endpoint path (e.g., '/groups')
     * @param body - Request body data
     * @returns Response from Atlas API
     */
    public static async post(mongoClusterId: string, endpoint: string, body?: unknown): Promise<Response> {
        return this.request(mongoClusterId, 'POST', endpoint, body);
    }

    /**
     * Makes an authenticated request to the Atlas API with proper authentication handling
     */
    private static async request(
        mongoClusterId: string,
        method: string,
        endpoint: string,
        body?: unknown,
    ): Promise<Response> {
        const credentials = CredentialCache.getAtlasCredentials(mongoClusterId);
        if (!credentials) {
            throw new Error(l10n.t('No Atlas credentials found for cluster {0}', mongoClusterId));
        }

        const url = `${this.ATLAS_API_BASE_URL}${endpoint}`;

        switch (credentials.authType) {
            case 'oauth':
                return this.makeOAuthRequest(mongoClusterId, method, url, body);
            case 'digest':
                return this.makeDigestRequest(credentials, method, url, body);
            default:
                throw new Error(l10n.t('Unsupported Atlas authentication type: {0}', credentials.authType));
        }
    }

    /**
     * Makes OAuth authenticated request
     */
    private static async makeOAuthRequest(
        mongoClusterId: string,
        method: string,
        url: string,
        body?: unknown,
    ): Promise<Response> {
        const authHeader = await AtlasAuthManager.getAuthorizationHeader(mongoClusterId);
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new Error(l10n.t('Failed to obtain valid OAuth token'));
        }

        const headers: Record<string, string> = {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.atlas.2023-02-01+json',
        };

        const requestInit: RequestInit = {
            method,
            headers,
        };

        if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            requestInit.body = JSON.stringify(body);
        }

        return fetch(url, requestInit);
    }

    /**
     * Makes HTTP Digest authenticated request.
     * This implementation uses a simplified approach for Node.js fetch.
     * In a production environment, you might want to use a library like 'node-fetch' with digest support.
     */
    private static async makeDigestRequest(
        credentials: AtlasCredentials,
        method: string,
        url: string,
        body?: unknown,
    ): Promise<Response> {
        if (!credentials.digest) {
            throw new Error(l10n.t('Digest credentials not found'));
        }

        const { publicKey, privateKey } = credentials.digest;

        // First, make an unauthenticated request to get the WWW-Authenticate header
        const initialHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.atlas.2024-08-05+json',
        };

        const initialRequestInit: RequestInit = {
            method,
            headers: initialHeaders,
        };

        if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            initialRequestInit.body = JSON.stringify(body);
        }

        // Make initial request to get challenge
        const initialResponse = await fetch(url, initialRequestInit);

        if (initialResponse.status === 401) {
            const wwwAuthenticate = initialResponse.headers.get('WWW-Authenticate');
            if (wwwAuthenticate && wwwAuthenticate.includes('Digest')) {
                // Parse digest challenge and create response
                const digestHeader = this.createDigestAuthHeader(
                    wwwAuthenticate,
                    publicKey,
                    privateKey,
                    method,
                    url,
                );

                const authenticatedHeaders = {
                    ...initialHeaders,
                    'Authorization': digestHeader,
                };

                const authenticatedRequestInit: RequestInit = {
                    method,
                    headers: authenticatedHeaders,
                };

                if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
                    authenticatedRequestInit.body = JSON.stringify(body);
                }

                return fetch(url, authenticatedRequestInit);
            }
        }

        // If we didn't get a digest challenge, return the original response
        return initialResponse;
    }

    /**
     * Creates HTTP Digest authentication header
     */
    private static createDigestAuthHeader(
        wwwAuthenticate: string,
        username: string,
        password: string,
        method: string,
        url: string,
    ): string {
        // Parse WWW-Authenticate header
        const challenge = this.parseDigestChallenge(wwwAuthenticate);
        
        if (!challenge.realm || !challenge.nonce) {
            throw new Error(l10n.t('Invalid digest challenge received'));
        }

        // Extract URI path from full URL
        const uri = new URL(url).pathname + new URL(url).search;

        // Create response hash
        const ha1 = this.md5Hash(`${username}:${challenge.realm}:${password}`);
        const ha2 = this.md5Hash(`${method}:${uri}`);
        
        let response: string;
        if (challenge.qop === 'auth' || challenge.qop === 'auth-int') {
            const cnonce = this.generateCnonce();
            const nc = '00000001';
            response = this.md5Hash(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${challenge.qop}:${ha2}`);
            
            return `Digest username="${username}", realm="${challenge.realm}", nonce="${challenge.nonce}", uri="${uri}", response="${response}", qop=${challenge.qop}, nc=${nc}, cnonce="${cnonce}"`;
        } else {
            response = this.md5Hash(`${ha1}:${challenge.nonce}:${ha2}`);
            return `Digest username="${username}", realm="${challenge.realm}", nonce="${challenge.nonce}", uri="${uri}", response="${response}"`;
        }
    }

    /**
     * Parses WWW-Authenticate digest challenge
     */
    private static parseDigestChallenge(wwwAuthenticate: string): Record<string, string> {
        const challenge: Record<string, string> = {};
        const regex = /(\w+)=(?:"([^"]+)"|([^,\s]+))/g;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(wwwAuthenticate)) !== null) {
            const key = match[1];
            const value = match[2] || match[3];
            challenge[key] = value;
        }

        return challenge;
    }

    /**
     * Generates MD5 hash
     */
    private static md5Hash(data: string): string {
        return createHash('md5').update(data).digest('hex');
    }

    /**
     * Generates client nonce for digest auth
     */
    private static generateCnonce(): string {
        return createHash('md5')
            .update(Math.random().toString())
            .digest('hex')
            .substring(0, 16);
    }
}