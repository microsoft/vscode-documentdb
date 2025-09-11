/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import DigestClient from 'digest-fetch';
import { AtlasAuthManager } from './AtlasAuthManager';
import { type AtlasCredentials, AtlasCredentialCache } from './AtlasCredentialCache';

// Type definitions for digest-fetch since the library has incomplete types
interface DigestFetchClient {
    fetch(url: string, options?: RequestInit): Promise<Response>;
}

/**
 * HTTP client for MongoDB Atlas API that handles authentication
 */
export class AtlasHttpClient {
    private static readonly ATLAS_API_BASE_URL = 'https://cloud.mongodb.com/api/atlas/v2';

    /**
     * Makes an authenticated GET request to the Atlas API
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @param endpoint - API endpoint path (e.g., '/groups')
     * @returns Response from Atlas API
     */
    public static async get(orgId: string, endpoint: string): Promise<Response> {
        return this.request(orgId, 'GET', endpoint);
    }

    /**
     * Makes an authenticated POST request to the Atlas API
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @param endpoint - API endpoint path (e.g., '/groups')
     * @param body - Request body data
     * @returns Response from Atlas API
     */
    public static async post(orgId: string, endpoint: string, body?: unknown): Promise<Response> {
        return this.request(orgId, 'POST', endpoint, body);
    }

    /**
     * Makes an authenticated DELETE request to the Atlas API
     *
     * @param orgId - The organization id for the Atlas credential instance
     * @param endpoint - API endpoint path (e.g., '/groups/{id}')
     * @returns Response from Atlas API
     */
    public static async delete(orgId: string, endpoint: string): Promise<Response> {
        return this.request(orgId, 'DELETE', endpoint);
    }

    /**
     * Makes an authenticated request to the Atlas API with proper authentication handling
     */
    private static async request(orgId: string, method: string, endpoint: string, body?: unknown): Promise<Response> {
        const credentials = AtlasCredentialCache.getAtlasCredentials(orgId);
        if (!credentials) {
            throw new Error(l10n.t('No Atlas credentials found for organization {0}', orgId));
        }

        const url = `${this.ATLAS_API_BASE_URL}${endpoint}`;

        switch (credentials.authType) {
            case 'oauth':
                return this.makeOAuthRequest(orgId, method, url, body);
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
        orgId: string,
        method: string,
        url: string,
        body?: unknown,
    ): Promise<Response> {
        const authHeader = await AtlasAuthManager.getAuthorizationHeader(orgId);
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new Error(l10n.t('Failed to obtain valid OAuth token'));
        }

        const headers: Record<string, string> = {
            Authorization: authHeader,
            'Content-Type': 'application/json',
            Accept: 'application/vnd.atlas.2023-02-01+json',
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
     * This implementation uses digest-fetch library for HTTP Digest authentication.
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const client = new DigestClient(publicKey, privateKey) as DigestFetchClient;

        const requestInit: RequestInit = {
            method,
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/vnd.atlas.2024-08-05+json',
            },
        };

        if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            requestInit.body = JSON.stringify(body);
        }

        // Make digest authenticated request
        const response = await client.fetch(url, requestInit);

        if (!response.ok) {
            const errorText: string = await response.text();
            throw new Error(`Request failed with status ${response.status}: ${errorText}`);
        }

        return response;
    }
}
