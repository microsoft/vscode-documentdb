/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Atlas Management API v2 response types
 */

export interface AtlasApiResponse<T> {
    links?: AtlasLink[];
    results: T[];
    totalCount?: number;
}

export interface AtlasLink {
    href: string;
    rel: string;
}

export interface AtlasProject {
    id: string;
    name: string;
    orgId: string;
    created: string;
    clusterCount: number;
    links?: AtlasLink[];
}

export interface AtlasCluster {
    id?: string;
    name: string;
    clusterType: string;
    mongoDBVersion: string;
    connectionStrings?: {
        standard?: string;
        standardSrv?: string;
        private?: string;
        privateSrv?: string;
    };
    providerSettings: {
        providerName: string;
        instanceSizeName: string;
        regionName: string;
    };
    stateName: string;
    links?: AtlasLink[];
}

export interface AtlasDatabaseUser {
    username: string;
    databaseName: string;
    roles: Array<{
        roleName: string;
        databaseName: string;
        collectionName?: string;
    }>;
    scopes?: Array<{
        name: string;
        type: string;
    }>;
    links?: AtlasLink[];
}

export interface AtlasAccessListEntry {
    ipAddress?: string;
    cidrBlock?: string;
    comment?: string;
    deleteAfterDate?: string;
    links?: AtlasLink[];
}

/**
 * Authentication interfaces
 */
export interface OAuthCredentials {
    clientId: string;
    clientSecret: string;
    scopes?: string[];
}

export interface DigestCredentials {
    publicKey: string;
    privateKey: string;
}

export interface OAuthTokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
    scope?: string;
}

/**
 * API client configuration
 */
export interface AtlasApiClientConfig {
    baseUrl?: string;
    timeout?: number;
    maxRetries?: number;
    retryDelayMs?: number;
}

/**
 * HTTP client interfaces
 */
export interface HttpResponse<T = unknown> {
    data: T;
    status: number;
    headers: Record<string, string>;
}

export interface HttpRequestOptions {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    url: string;
    headers?: Record<string, string>;
    data?: unknown;
    timeout?: number;
}

/**
 * Error types
 */
export class AtlasApiError extends Error {
    constructor(
        message: string,
        public readonly status?: number,
        public readonly code?: string,
        public readonly details?: unknown,
    ) {
        super(message);
        this.name = 'AtlasApiError';
    }
}

export class AtlasAuthenticationError extends AtlasApiError {
    constructor(message: string, details?: unknown) {
        super(message, 401, 'AUTHENTICATION_FAILED', details);
        this.name = 'AtlasAuthenticationError';
    }
}

export class AtlasRateLimitError extends AtlasApiError {
    constructor(
        message: string,
        public readonly retryAfterSeconds?: number,
    ) {
        super(message, 429, 'RATE_LIMITED');
        this.name = 'AtlasRateLimitError';
    }
}