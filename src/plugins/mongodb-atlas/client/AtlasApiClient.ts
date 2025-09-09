/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OAuthAuthenticator } from './auth/OAuthAuthenticator';
import { DigestAuthenticator } from './auth/DigestAuthenticator';
import {
    type AtlasApiClientConfig,
    type OAuthCredentials,
    type DigestCredentials,
    type HttpRequestOptions,
    type AtlasApiResponse,
    type AtlasProject,
    type AtlasCluster,
    type AtlasDatabaseUser,
    type AtlasAccessListEntry,
    AtlasApiError,
    AtlasRateLimitError,
    AtlasAuthenticationError,
} from './types';

/**
 * MongoDB Atlas Management API v2 Client
 * Supports OAuth2 Client Credentials and HTTP Digest authentication
 */
export class AtlasApiClient {
    private readonly baseUrl: string;
    private readonly timeout: number;
    private readonly maxRetries: number;
    private readonly retryDelayMs: number;
    private oauthAuth?: OAuthAuthenticator;
    private digestAuth?: DigestAuthenticator;

    constructor(
        credentials: OAuthCredentials | DigestCredentials,
        config: AtlasApiClientConfig = {},
    ) {
        this.baseUrl = config.baseUrl || 'https://cloud.mongodb.com/api/atlas/v2';
        this.timeout = config.timeout || 30000;
        this.maxRetries = config.maxRetries || 3;
        this.retryDelayMs = config.retryDelayMs || 1000;

        // Determine authentication type based on credentials
        if ('clientId' in credentials) {
            this.oauthAuth = new OAuthAuthenticator(credentials);
        } else if ('publicKey' in credentials) {
            this.digestAuth = new DigestAuthenticator(credentials);
        } else {
            throw new AtlasApiError('Invalid credentials provided');
        }
    }

    /**
     * List all projects (groups) accessible to the authenticated user
     */
    public async listProjects(): Promise<AtlasApiResponse<AtlasProject>> {
        return this.request<AtlasApiResponse<AtlasProject>>({
            method: 'GET',
            url: '/groups',
        });
    }

    /**
     * List all clusters in a project
     */
    public async listClusters(projectId: string): Promise<AtlasApiResponse<AtlasCluster>> {
        return this.request<AtlasApiResponse<AtlasCluster>>({
            method: 'GET',
            url: `/groups/${encodeURIComponent(projectId)}/clusters`,
        });
    }

    /**
     * Get detailed information about a specific cluster including connection strings
     */
    public async getCluster(projectId: string, clusterName: string): Promise<AtlasCluster> {
        return this.request<AtlasCluster>({
            method: 'GET',
            url: `/groups/${encodeURIComponent(projectId)}/clusters/${encodeURIComponent(clusterName)}`,
        });
    }

    /**
     * List database users for a project
     */
    public async listDatabaseUsers(projectId: string): Promise<AtlasApiResponse<AtlasDatabaseUser>> {
        return this.request<AtlasApiResponse<AtlasDatabaseUser>>({
            method: 'GET',
            url: `/groups/${encodeURIComponent(projectId)}/databaseUsers`,
        });
    }

    /**
     * List IP access list entries for a project
     */
    public async listAccessListEntries(projectId: string): Promise<AtlasApiResponse<AtlasAccessListEntry>> {
        return this.request<AtlasApiResponse<AtlasAccessListEntry>>({
            method: 'GET',
            url: `/groups/${encodeURIComponent(projectId)}/accessList`,
        });
    }

    /**
     * Add IP access list entry to a project
     */
    public async addAccessListEntry(
        projectId: string,
        entry: Omit<AtlasAccessListEntry, 'links'>,
    ): Promise<AtlasApiResponse<AtlasAccessListEntry>> {
        return this.request<AtlasApiResponse<AtlasAccessListEntry>>({
            method: 'POST',
            url: `/groups/${encodeURIComponent(projectId)}/accessList`,
            data: [entry], // Atlas expects an array
        });
    }

    /**
     * Delete IP access list entry from a project
     */
    public async deleteAccessListEntry(projectId: string, entryId: string): Promise<void> {
        await this.request<void>({
            method: 'DELETE',
            url: `/groups/${encodeURIComponent(projectId)}/accessList/${encodeURIComponent(entryId)}`,
        });
    }

    /**
     * Generic paginated request handler
     */
    public async requestWithPagination<T>(
        options: HttpRequestOptions,
        pageSize = 100,
    ): Promise<T[]> {
        const allResults: T[] = [];
        let nextUrl: string | undefined = `${options.url}?itemsPerPage=${pageSize}`;

        while (nextUrl) {
            const response = await this.request<AtlasApiResponse<T>>({
                ...options,
                url: nextUrl,
            });

            allResults.push(...response.results);

            // Find next page link
            nextUrl = response.links?.find((link) => link.rel === 'next')?.href;
        }

        return allResults;
    }

    /**
     * Core HTTP request method with authentication, retries, and error handling
     */
    private async request<T>(options: HttpRequestOptions): Promise<T> {
        const url = options.url.startsWith('http') ? options.url : `${this.baseUrl}${options.url}`;
        
        let lastError: Error | undefined;
        
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                return await this.executeRequest<T>({ ...options, url });
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                
                // Don't retry authentication errors
                if (error instanceof AtlasAuthenticationError) {
                    throw error;
                }
                
                // Handle rate limiting
                if (error instanceof AtlasRateLimitError) {
                    if (attempt < this.maxRetries) {
                        const delay = error.retryAfterSeconds ? error.retryAfterSeconds * 1000 : this.calculateBackoffDelay(attempt);
                        await this.sleep(delay);
                        continue;
                    }
                    throw error;
                }
                
                // Retry on other errors with exponential backoff
                if (attempt < this.maxRetries) {
                    await this.sleep(this.calculateBackoffDelay(attempt));
                    continue;
                }
            }
        }
        
        throw lastError;
    }

    private async executeRequest<T>(options: HttpRequestOptions): Promise<T> {
        let headers: Record<string, string> = {
            'Accept': 'application/vnd.atlas.2023-01-01+json',
            'Content-Type': 'application/json',
            ...options.headers,
        };

        // Add authentication headers
        if (this.oauthAuth) {
            headers = await this.oauthAuth.addAuthHeaders(headers);
        } else if (this.digestAuth) {
            // For digest auth, we might need to handle 401 challenge
            headers = await this.digestAuth.addAuthHeaders(headers, options.method, options.url);
        }

        const requestInit: RequestInit = {
            method: options.method,
            headers,
            signal: AbortSignal.timeout(this.timeout),
        };

        if (options.data && options.method !== 'GET') {
            requestInit.body = JSON.stringify(options.data);
        }

        const response = await fetch(options.url, requestInit);
        
        // Handle digest auth challenge
        if (response.status === 401 && this.digestAuth) {
            const wwwAuth = response.headers.get('WWW-Authenticate');
            if (wwwAuth && wwwAuth.startsWith('Digest')) {
                return this.handleDigestChallenge<T>(options, wwwAuth);
            }
        }

        return this.handleResponse<T>(response);
    }

    private async handleDigestChallenge<T>(options: HttpRequestOptions, challengeHeader: string): Promise<T> {
        if (!this.digestAuth) {
            throw new AtlasAuthenticationError('Digest challenge received but no digest authenticator available');
        }

        let headers: Record<string, string> = {
            'Accept': 'application/vnd.atlas.2023-01-01+json',
            'Content-Type': 'application/json',
            ...options.headers,
        };

        headers = await this.digestAuth.addAuthHeaders(headers, options.method, options.url, challengeHeader);

        const requestInit: RequestInit = {
            method: options.method,
            headers,
            signal: AbortSignal.timeout(this.timeout),
        };

        if (options.data && options.method !== 'GET') {
            requestInit.body = JSON.stringify(options.data);
        }

        const response = await fetch(options.url, requestInit);
        return this.handleResponse<T>(response);
    }

    private async handleResponse<T>(response: Response): Promise<T> {
        // Handle rate limiting
        if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : undefined;
            
            throw new AtlasRateLimitError(
                'Rate limit exceeded',
                retryAfterSeconds,
            );
        }

        // Handle authentication errors
        if (response.status === 401) {
            throw new AtlasAuthenticationError(
                `Authentication failed: ${response.status} ${response.statusText}`,
            );
        }

        // Handle other client/server errors
        if (!response.ok) {
            const errorData = await this.parseErrorResponse(response);
            throw new AtlasApiError(
                `API request failed: ${response.status} ${response.statusText}`,
                response.status,
                'API_ERROR',
                errorData,
            );
        }

        // Handle successful responses
        if (response.status === 204) {
            return undefined as T; // No content
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return response.json();
        }

        return response.text() as T;
    }

    private async parseErrorResponse(response: Response): Promise<unknown> {
        try {
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            }
            return await response.text();
        } catch {
            return {
                status: response.status,
                statusText: response.statusText,
            };
        }
    }

    private calculateBackoffDelay(attempt: number): number {
        // Exponential backoff with jitter: base delay * 2^attempt + random jitter
        const baseDelay = this.retryDelayMs;
        const exponentialDelay = baseDelay * Math.pow(2, attempt);
        const jitter = Math.random() * baseDelay;
        
        return Math.min(exponentialDelay + jitter, 30000); // Max 30 seconds
    }

    private async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}